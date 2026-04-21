import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";

const db = new Database("mock.db", { create: true });

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    nickname      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS lobbies (
    id                     TEXT PRIMARY KEY,
    creator_id             TEXT NOT NULL REFERENCES users(id),
    time_minutes           INTEGER NOT NULL DEFAULT 5,
    time_increment_seconds INTEGER NOT NULL DEFAULT 0,
    is_rated               INTEGER NOT NULL DEFAULT 0,
    state                  TEXT NOT NULL DEFAULT 'gathering',
    created_at             INTEGER DEFAULT (unixepoch())
  );

  -- team: 0 или 1; position: 0 или 1 (место в команде)
  CREATE TABLE IF NOT EXISTS lobby_players (
    lobby_id TEXT    NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    user_id  TEXT    NOT NULL REFERENCES users(id),
    team     INTEGER NOT NULL CHECK (team IN (0, 1)),
    position INTEGER NOT NULL CHECK (position IN (0, 1)),
    PRIMARY KEY (lobby_id, team, position),
    UNIQUE (lobby_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS games (
    id                     TEXT PRIMARY KEY,
    time_minutes           INTEGER NOT NULL DEFAULT 5,
    time_increment_seconds INTEGER NOT NULL DEFAULT 0,
    created_at             INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS game_players (
    game_id  TEXT    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id  TEXT    NOT NULL REFERENCES users(id),
    team     INTEGER NOT NULL CHECK (team IN (0, 1)),
    position INTEGER NOT NULL CHECK (position IN (0, 1)),
    PRIMARY KEY (game_id, team, position),
    UNIQUE (game_id, user_id)
  );
`);

// --- Types ---

export interface User {
  id: string;
  email: string;
  nickname: string;
  password_hash: string;
  created_at: number;
}

/** teams[team][position] — ник или null если слот пуст */
export type Teams = [[string | null, string | null], [string | null, string | null]];

export interface LobbyConnectData {
  lobby_id: string;
  time_minutes: number;
  time_increment_seconds: number;
  teams: Teams;
  is_rated: boolean;
  can_modify: boolean;
  state: "gathering" | "searching";
}

export interface JoinGameData {
  game_id: string;
  time_minutes: number;
  time_increment_seconds: number;
  teams: Teams;
  your_team: 0 | 1;
  your_position: 0 | 1;
}

// --- Prepared statements ---

const stmtUserByEmail    = db.query<User, [string]>("SELECT * FROM users WHERE email = ?");
const stmtUserById       = db.query<User, [string]>("SELECT * FROM users WHERE id = ?");
const stmtUserByNickname = db.query<User, [string]>("SELECT * FROM users WHERE nickname = ?");

// --- Auth ---

export function findUserByEmail(email: string):       User | null { return stmtUserByEmail.get(email); }
export function findUserById(id: string):             User | null { return stmtUserById.get(id); }
export function findUserByNickname(nick: string):     User | null { return stmtUserByNickname.get(nick); }

export async function createUser(email: string, nickname: string, password: string): Promise<User> {
  const id = randomUUID();
  const hash = await Bun.password.hash(password);
  db.prepare("INSERT INTO users (id, email, nickname, password_hash) VALUES (?, ?, ?, ?)").run(id, email, nickname, hash);
  return stmtUserById.get(id)!;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash);
}

// --- User state ---

export function getUserState(userId: string): "idle" | "in_lobby" | "in_game" {
  if (db.prepare("SELECT 1 FROM game_players  WHERE user_id = ?").get(userId)) return "in_game";
  if (db.prepare("SELECT 1 FROM lobby_players WHERE user_id = ?").get(userId)) return "in_lobby";
  return "idle";
}

// --- Lobby helpers ---

function buildTeams(lobbyId: string): Teams {
  const rows = db.prepare<{ team: number; position: number; nickname: string }, [string]>(`
    SELECT lp.team, lp.position, u.nickname
    FROM lobby_players lp
    JOIN users u ON u.id = lp.user_id
    WHERE lp.lobby_id = ?
  `).all(lobbyId);

  const teams: Teams = [[null, null], [null, null]];
  for (const r of rows) teams[r.team as 0 | 1][r.position as 0 | 1] = r.nickname;
  return teams;
}

function fetchLobby(lobbyId: string, userId: string): LobbyConnectData | null {
  const lobby = db.prepare<{
    id: string; creator_id: string; time_minutes: number;
    time_increment_seconds: number; is_rated: number; state: string;
  }, [string]>("SELECT * FROM lobbies WHERE id = ?").get(lobbyId);

  if (!lobby) return null;

  return {
    lobby_id: lobby.id,
    time_minutes: lobby.time_minutes,
    time_increment_seconds: lobby.time_increment_seconds,
    teams: buildTeams(lobby.id),
    is_rated: Boolean(lobby.is_rated),
    can_modify: lobby.creator_id === userId,
    state: lobby.state as "gathering" | "searching",
  };
}

export function getLobbyForUser(userId: string): LobbyConnectData | null {
  const row = db.prepare<{ lobby_id: string }, [string]>(
    "SELECT lobby_id FROM lobby_players WHERE user_id = ?"
  ).get(userId);
  return row ? fetchLobby(row.lobby_id, userId) : null;
}

export function getLobbyPlayerIds(lobbyId: string): string[] {
  return db.prepare<{ user_id: string }, [string]>(
    "SELECT user_id FROM lobby_players WHERE lobby_id = ?"
  ).all(lobbyId).map(r => r.user_id);
}

// --- Lobby actions ---

export function createLobby(userId: string, timeMinutes: number, timeIncrSeconds: number): LobbyConnectData {
  const id = randomUUID();
  db.prepare("INSERT INTO lobbies (id, creator_id, time_minutes, time_increment_seconds) VALUES (?, ?, ?, ?)")
    .run(id, userId, timeMinutes, timeIncrSeconds);
  // Создатель → команда 0, позиция 0
  db.prepare("INSERT INTO lobby_players (lobby_id, user_id, team, position) VALUES (?, ?, 0, 0)")
    .run(id, userId);
  return fetchLobby(id, userId)!;
}

export function joinLobby(lobbyId: string, userId: string): LobbyConnectData | null {
  const taken = db.prepare<{ team: number; position: number }, [string]>(
    "SELECT team, position FROM lobby_players WHERE lobby_id = ?"
  ).all(lobbyId);

  const all: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1]];
  const takenSet = new Set(taken.map(r => `${r.team},${r.position}`));
  const slot = all.find(([t, p]) => !takenSet.has(`${t},${p}`));

  if (!slot) return null;

  db.prepare("INSERT INTO lobby_players (lobby_id, user_id, team, position) VALUES (?, ?, ?, ?)")
    .run(lobbyId, userId, slot[0], slot[1]);

  return fetchLobby(lobbyId, userId);
}

export function updateLobbyTime(lobbyId: string, timeMinutes: number, timeIncrSeconds: number): void {
  db.prepare("UPDATE lobbies SET time_minutes = ?, time_increment_seconds = ? WHERE id = ?")
    .run(timeMinutes, timeIncrSeconds, lobbyId);
}

export function updateLobbyRanked(lobbyId: string, isRated: boolean): void {
  db.prepare("UPDATE lobbies SET is_rated = ? WHERE id = ?").run(isRated ? 1 : 0, lobbyId);
}

// --- Game ---

export function createGame(lobbyId: string): { gameId: string; playerIds: string[] } {
  const gameId = randomUUID();

  const lobby = db.prepare<{ time_minutes: number; time_increment_seconds: number }, [string]>(
    "SELECT time_minutes, time_increment_seconds FROM lobbies WHERE id = ?"
  ).get(lobbyId)!;

  db.prepare("INSERT INTO games (id, time_minutes, time_increment_seconds) VALUES (?, ?, ?)")
    .run(gameId, lobby.time_minutes, lobby.time_increment_seconds);

  const players = db.prepare<{ user_id: string; team: number; position: number }, [string]>(
    "SELECT user_id, team, position FROM lobby_players WHERE lobby_id = ?"
  ).all(lobbyId);

  for (const p of players) {
    db.prepare("INSERT INTO game_players (game_id, user_id, team, position) VALUES (?, ?, ?, ?)")
      .run(gameId, p.user_id, p.team, p.position);
  }

  db.prepare("DELETE FROM lobbies WHERE id = ?").run(lobbyId);

  return { gameId, playerIds: players.map(p => p.user_id) };
}

export function getGameForUser(userId: string): JoinGameData | null {
  const row = db.prepare<{ game_id: string; team: number; position: number }, [string]>(
    "SELECT game_id, team, position FROM game_players WHERE user_id = ?"
  ).get(userId);

  if (!row) return null;

  const game = db.prepare<{ id: string; time_minutes: number; time_increment_seconds: number }, [string]>(
    "SELECT * FROM games WHERE id = ?"
  ).get(row.game_id)!;

  const allPlayers = db.prepare<{ team: number; position: number; nickname: string }, [string]>(`
    SELECT gp.team, gp.position, u.nickname
    FROM game_players gp
    JOIN users u ON u.id = gp.user_id
    WHERE gp.game_id = ?
  `).all(game.id);

  const teams: Teams = [[null, null], [null, null]];
  for (const p of allPlayers) teams[p.team as 0 | 1][p.position as 0 | 1] = p.nickname;

  return {
    game_id: game.id,
    time_minutes: game.time_minutes,
    time_increment_seconds: game.time_increment_seconds,
    teams,
    your_team:     row.team     as 0 | 1,
    your_position: row.position as 0 | 1,
  };
}

// --- Users search ---

export function searchUsers(nickname?: string | null): { id: string; nickname: string }[] {
  if (nickname) {
    return db.prepare<{ id: string; nickname: string }, [string]>(
      "SELECT id, nickname FROM users WHERE nickname LIKE ?"
    ).all(`%${nickname}%`);
  }
  return db.prepare<{ id: string; nickname: string }, []>("SELECT id, nickname FROM users").all();
}
