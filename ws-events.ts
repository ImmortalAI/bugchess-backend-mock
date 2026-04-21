export enum WsEvent {
  // ── Server → Client ──────────────────────────────────
  PONG           = 0,   // ответ на ping; также шлётся при idle-подключении
  CONNECT_LOBBY  = 1,   // вход в лобби (при подключении или после принятия инвайта)
  JOIN_GAME      = 2,   // вход в игру (при подключении или после START_MM)
  INVITE_RECEIVE = 3,   // входящее приглашение в лобби

  // ── Client → Server ──────────────────────────────────
  PING           = 4,   // keepalive
  CREATE_LOBBY   = 5,   // создать лобби (только из состояния idle)
  LOBBY_TIME     = 6,   // изменить время партии (только создатель)
  LOBBY_RANKED   = 7,   // переключить рейтинговый режим (только создатель)
  LOBBY_INVITE   = 8,   // пригласить игрока по нику (только создатель)
  START_MM       = 9,   // запустить матч (только создатель; мок — без поиска)
  INVITE_ACCEPT  = 10,  // принять приглашение (только из состояния idle)
  INVITE_REJECT  = 11,  // отклонить приглашение (только из состояния idle)

  // ── Server → Client (ошибки) ─────────────────────────
  ERROR          = 99,
}

export interface WsMessage<T = undefined> {
  type: WsEvent;
  data?: T;
}

export function wsMsg<T>(type: WsEvent, data?: T): string {
  return JSON.stringify({ type, data } satisfies WsMessage<T>);
}
