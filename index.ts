import type { Server, ServerWebSocket } from "bun";
import {
  findUserByEmail, findUserById, findUserByNickname, createUser, verifyPassword,
  getUserState, getLobbyForUser, getLobbyPlayerIds,
  createLobby, joinLobby, updateLobbyTime, updateLobbyRanked,
  createGame, getGameForUser,
  searchUsers,
} from "./db";
import { WsEvent, wsMsg } from "./ws-events";
import { spec } from "./openapi";
import { msg } from "./i18n";

const PORT = 3000;

type WsData = { userId: string | null };

// Connected clients indexed by userId
const clients = new Map<string, ServerWebSocket<WsData>>();

// Pending invites: invitedUserId → { lobbyId, fromNickname }
const pendingInvites = new Map<string, { lobbyId: string; fromNickname: string }>();

// --- HTTP helpers ---

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function notFound():               Response { return json({ error: msg.notFound }, 404); }
function badRequest(text: string): Response { return json({ error: text }, 400); }
function unauthorized():           Response { return json({ error: msg.unauthorized }, 401); }
function conflict(text: string):   Response { return json({ error: text }, 409); }

function resolveUserId(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7) || null;
}

// --- Auth ---

async function handleAuth(method: string, pathname: string, req: Request): Promise<Response> {
  const action = pathname.replace(/^\/auth\/?/, "");

  switch (action) {
    case "login": {
      if (method !== "POST") return notFound();
      const body = (await req.json().catch(() => null)) as Record<string, string> | null;
      if (!body?.email || !body?.password) return badRequest(msg.loginFieldsRequired);

      const user = findUserByEmail(body.email);
      if (!user || !(await verifyPassword(body.password, user.password_hash))) {
        return json({ error: msg.invalidCredentials }, 401);
      }
      return json({ access_token: user.id, refresh_token: `refresh_${user.id}` });
    }

    case "register": {
      if (method !== "POST") return notFound();
      const body = (await req.json().catch(() => null)) as Record<string, string> | null;
      if (!body?.email || !body?.nickname || !body?.password || !body?.confirm_password) {
        return badRequest(msg.registerFieldsRequired);
      }
      if (body.password !== body.confirm_password) return badRequest(msg.passwordMismatch);

      try {
        await createUser(body.email, body.nickname, body.password);
      } catch {
        return conflict(msg.credentialsTaken);
      }
      return json({ message: msg.registeredOk }, 201);
    }

    case "logout": {
      if (method !== "POST") return notFound();
      return json({ message: msg.loggedOut });
    }

    case "logout_all": {
      if (method !== "POST") return notFound();
      return json({ message: msg.loggedOutAll });
    }

    case "refresh": {
      if (method !== "POST") return notFound();
      const body = (await req.json().catch(() => null)) as Record<string, string> | null;
      if (!body?.refresh_token) return badRequest(msg.refreshTokenRequired);

      const userId = body.refresh_token.replace(/^refresh_/, "");
      const user = findUserById(userId);
      if (!user) return json({ error: msg.invalidRefreshToken }, 401);

      return json({ access_token: user.id, refresh_token: `refresh_${user.id}` });
    }

    default:
      return notFound();
  }
}

// --- Users ---

async function handleUsers(method: string, pathname: string, req: Request): Promise<Response> {
  const action = pathname.replace(/^\/users\/?/, "");

  switch (action) {
    case "me": {
      if (method !== "GET") return notFound();
      const userId = resolveUserId(req);
      if (!userId) return unauthorized();

      const user = findUserById(userId);
      if (!user) return unauthorized();

      return json({ id: user.id, email: user.email, nickname: user.nickname });
    }

    case "active": {
      if (method !== "GET") return notFound();
      const nickname = new URL(req.url).searchParams.get("nickname");
      return json(searchUsers(nickname));
    }

    default:
      return notFound();
  }
}

// --- WebSocket helpers ---

function wsSend(userId: string, type: WsEvent, data?: unknown): void {
  clients.get(userId)?.send(wsMsg(type, data));
}

/** Рассылает обновлённое состояние лобби всем участникам.
 *  У каждого игрока свой can_modify, поэтому данные формируются индивидуально. */
function broadcastLobby(lobbyId: string): void {
  for (const uid of getLobbyPlayerIds(lobbyId)) {
    const data = getLobbyForUser(uid);
    if (data) wsSend(uid, WsEvent.CONNECT_LOBBY, data);
  }
}

// --- WebSocket lifecycle ---

function onWsOpen(ws: ServerWebSocket<WsData>): void {
  const { userId } = ws.data;

  if (!userId) {
    ws.send(wsMsg(WsEvent.ERROR, { message: msg.unauthorized }));
    ws.close();
    return;
  }

  clients.set(userId, ws);

  const state = getUserState(userId);

  if (state === "in_lobby") {
    const data = getLobbyForUser(userId);
    if (data) { ws.send(wsMsg(WsEvent.CONNECT_LOBBY, data)); return; }
  }

  if (state === "in_game") {
    const data = getGameForUser(userId);
    if (data) { ws.send(wsMsg(WsEvent.JOIN_GAME, data)); return; }
  }

  ws.send(wsMsg(WsEvent.PONG)); // idle — просто pong
}

function onWsClose(ws: ServerWebSocket<WsData>): void {
  if (ws.data.userId) clients.delete(ws.data.userId);
}

// --- WebSocket messages ---

function onWsMessage(ws: ServerWebSocket<WsData>, raw: string | Buffer): void {
  const { userId } = ws.data;
  if (!userId) return;

  let parsed: { type: WsEvent; data?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    ws.send(wsMsg(WsEvent.ERROR, { message: msg.wsInvalidJson }));
    return;
  }

  const { type, data: d } = parsed;

  const err = (message: string) => ws.send(wsMsg(WsEvent.ERROR, { message }));

  switch (type) {

    // ── Keepalive ────────────────────────────────────────────
    case WsEvent.PING: {
      ws.send(wsMsg(WsEvent.PONG));
      break;
    }

    // ── Idle actions ─────────────────────────────────────────
    case WsEvent.CREATE_LOBBY: {
      if (getUserState(userId) !== "idle") { err(msg.wsNotIdle); break; }

      const timeMinutes     = Number(d?.time_minutes ?? 5);
      const timeIncrSeconds = Number(d?.time_increment_seconds ?? 0);

      const lobby = createLobby(userId, timeMinutes, timeIncrSeconds);
      ws.send(wsMsg(WsEvent.CONNECT_LOBBY, lobby));
      break;
    }

    case WsEvent.INVITE_ACCEPT: {
      if (getUserState(userId) !== "idle") { err(msg.wsNotInIdleState); break; }

      const invite = pendingInvites.get(userId);
      if (!invite) { err(msg.wsNoPendingInvite); break; }
      pendingInvites.delete(userId);

      const lobby = joinLobby(invite.lobbyId, userId);
      if (!lobby) { err(msg.wsLobbyFullOrGone); break; }

      // Новому игроку — его вид лобби
      ws.send(wsMsg(WsEvent.CONNECT_LOBBY, lobby));
      // Остальным участникам — обновлённый состав
      broadcastLobby(invite.lobbyId);
      break;
    }

    case WsEvent.INVITE_REJECT: {
      pendingInvites.delete(userId);
      break;
    }

    // ── Lobby actions ─────────────────────────────────────────
    case WsEvent.LOBBY_TIME: {
      const lobby = getLobbyForUser(userId);
      if (!lobby)           { err(msg.wsNotInLobby); break; }
      if (!lobby.can_modify){ err(msg.wsNotCreator); break; }

      const timeMinutes     = Number(d?.time_minutes     ?? lobby.time_minutes);
      const timeIncrSeconds = Number(d?.time_increment_seconds ?? lobby.time_increment_seconds);
      updateLobbyTime(lobby.lobby_id, timeMinutes, timeIncrSeconds);
      broadcastLobby(lobby.lobby_id);
      break;
    }

    case WsEvent.LOBBY_RANKED: {
      const lobby = getLobbyForUser(userId);
      if (!lobby)           { err(msg.wsNotInLobby); break; }
      if (!lobby.can_modify){ err(msg.wsNotCreator); break; }

      updateLobbyRanked(lobby.lobby_id, Boolean(d?.is_rated));
      broadcastLobby(lobby.lobby_id);
      break;
    }

    case WsEvent.LOBBY_INVITE: {
      const lobby = getLobbyForUser(userId);
      if (!lobby)           { err(msg.wsNotInLobby); break; }
      if (!lobby.can_modify){ err(msg.wsNotCreator); break; }

      const nickname = String(d?.nickname ?? "");
      const target   = findUserByNickname(nickname);
      if (!target)                              { err(msg.wsUserNotFound); break; }
      if (target.id === userId)                 { err(msg.wsSelfInvite); break; }
      if (getUserState(target.id) !== "idle")   { err(msg.wsUserUnavailable); break; }

      const sender = findUserById(userId)!;
      pendingInvites.set(target.id, { lobbyId: lobby.lobby_id, fromNickname: sender.nickname });
      wsSend(target.id, WsEvent.INVITE_RECEIVE, { from: sender.nickname, lobby_id: lobby.lobby_id });
      break;
    }

    case WsEvent.START_MM: {
      const lobby = getLobbyForUser(userId);
      if (!lobby)           { err(msg.wsNotInLobby); break; }
      if (!lobby.can_modify){ err(msg.wsNotCreator); break; }

      const { playerIds } = createGame(lobby.lobby_id);

      for (const pid of playerIds) {
        const gameData = getGameForUser(pid);
        if (gameData) wsSend(pid, WsEvent.JOIN_GAME, gameData);
      }
      break;
    }

    default:
      err(msg.wsUnknownEvent(type));
  }
}

// --- Server ---

Bun.serve<WsData>({
  port: PORT,

  async fetch(req: Request, server: Server<WsData>) {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method.toUpperCase();

    if (pathname === "/ws") {
      const token  = url.searchParams.get("token");
      const userId = token ? findUserById(token)?.id ?? null : null;
      const upgraded = server.upgrade(req, { data: { userId } });
      return upgraded ? undefined : new Response(msg.wsUpgradeFailed, { status: 400 });
    }

    if (pathname === "/openapi.json") {
      return new Response(JSON.stringify(spec), { headers: { "Content-Type": "application/json" } });
    }

    if (pathname === "/docs") {
      return new Response(
        `<!doctype html><html><head><title>BugChess API</title><meta charset="utf-8"/></head><body>
        <script id="api-reference" data-url="/openapi.json"></script>
        <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
        </body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }

    if (pathname.startsWith("/auth"))  return handleAuth(method, pathname, req);
    if (pathname.startsWith("/users")) return handleUsers(method, pathname, req);

    return notFound();
  },

  websocket: {
    open:    onWsOpen,
    message: onWsMessage,
    close:   onWsClose,
  },
});

console.log(`Mock server:  http://localhost:${PORT}`);
console.log(`API docs:     http://localhost:${PORT}/docs`);
console.log(`WebSocket:    ws://localhost:${PORT}/ws?token=<userId>`);
