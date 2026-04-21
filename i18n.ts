export const msg = {
  // ── HTTP / общие ──────────────────────────────────────────
  notFound:               "api.error.not_found",
  unauthorized:           "api.error.unauthorized",
  wsUpgradeFailed:        "api.error.ws_upgrade_failed",

  // ── Auth ──────────────────────────────────────────────────
  loginFieldsRequired:    "api.auth.login.fields_required",
  invalidCredentials:     "api.auth.login.invalid_credentials",

  registerFieldsRequired: "api.auth.register.fields_required",
  passwordMismatch:       "api.auth.register.password_mismatch",
  credentialsTaken:       "api.auth.register.credentials_taken",
  registeredOk:           "api.auth.register.success",

  loggedOut:              "api.auth.logout.success",
  loggedOutAll:           "api.auth.logout_all.success",

  refreshTokenRequired:   "api.auth.refresh.token_required",
  invalidRefreshToken:    "api.auth.refresh.invalid_token",

  // ── WebSocket / общие ─────────────────────────────────────
  wsInvalidJson:          "api.ws.error.invalid_json",
  wsUnknownEvent:         (type: number) => `api.ws.error.unknown_event:${type}`,

  // ── WebSocket / состояния ─────────────────────────────────
  wsNotIdle:              "api.ws.error.not_idle",
  wsNotInIdleState:       "api.ws.error.not_in_idle_state",
  wsNotInLobby:           "api.ws.error.not_in_lobby",
  wsNotCreator:           "api.ws.error.not_creator",

  // ── WebSocket / инвайты ───────────────────────────────────
  wsNoPendingInvite:      "api.ws.error.no_pending_invite",
  wsLobbyFullOrGone:      "api.ws.error.lobby_full_or_gone",
  wsUserNotFound:         "api.ws.error.user_not_found",
  wsSelfInvite:           "api.ws.error.self_invite",
  wsUserUnavailable:      "api.ws.error.user_unavailable",
} as const;
