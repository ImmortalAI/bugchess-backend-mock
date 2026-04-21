export const spec = {
  openapi: "3.1.0",
  info: {
    title: "BugChess Mock API",
    version: "0.1.0",
    description: "Mock-сервер для тестирования клиентского приложения Шведских шахмат (Bughouse Chess).",
  },
  servers: [{ url: "http://localhost:3000" }],

  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
      },
      Tokens: {
        type: "object",
        properties: {
          access_token:  { type: "string" },
          refresh_token: { type: "string" },
        },
      },
      User: {
        type: "object",
        properties: {
          id:       { type: "string", format: "uuid" },
          email:    { type: "string", format: "email" },
          nickname: { type: "string" },
        },
      },
    },
  },

  paths: {
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Вход",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email:    { type: "string", format: "email" },
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Tokens" } } } },
          "400": { description: "Bad Request" },
          "401": { description: "Invalid credentials" },
        },
      },
    },

    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Регистрация",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "nickname", "password", "confirm_password"],
                properties: {
                  email:            { type: "string", format: "email" },
                  nickname:         { type: "string" },
                  password:         { type: "string" },
                  confirm_password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Registered successfully" },
          "400": { description: "Validation error" },
          "409": { description: "Email or nickname already taken" },
        },
      },
    },

    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Выход",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Logged out" } },
      },
    },

    "/auth/logout_all": {
      post: {
        tags: ["Auth"],
        summary: "Выход со всех устройств",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Logged out from all devices" } },
      },
    },

    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Обновление токена",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["refresh_token"],
                properties: { refresh_token: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Tokens" } } } },
          "401": { description: "Invalid refresh token" },
        },
      },
    },

    "/users/me": {
      get: {
        tags: ["Users"],
        summary: "Текущий пользователь",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
          "401": { description: "Unauthorized" },
        },
      },
    },

    "/users/active": {
      get: {
        tags: ["Users"],
        summary: "Активные пользователи",
        parameters: [
          {
            name: "nickname",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Фильтр по нику (подстрока)",
          },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id:       { type: "string", format: "uuid" },
                      nickname: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    "/ws": {
      get: {
        tags: ["WebSocket"],
        summary: "WebSocket-соединение",
        description: [
          "Подключение: `ws://localhost:3000/ws?token=<userId>`",
          "",
          "**Схема всех событий:** `{ type: number, data?: any }`",
          "",
          "| type | Событие       | data                                     |",
          "|------|---------------|------------------------------------------|",
          "| 0    | IDLE          | —                                        |",
          "| 1    | LOBBY_CONNECT | LobbyConnectData                         |",
          "| 2    | ERROR         | `{ message: string }`                    |",
          "",
          "**LobbyConnectData:**",
          "```json",
          "{",
          '  "lobby_id": "string",',
          '  "time_minutes": 5,',
          '  "time_increment_seconds": 3,',
          '  "players": ["alice", null, "bob", null],',
          '  "is_rated": false,',
          '  "can_modify": true,',
          '  "state": "gathering | searching"',
          "}",
          "```",
        ].join("\n"),
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "userId (access_token)",
          },
        ],
        responses: {
          "101": { description: "Switching Protocols" },
          "400": { description: "Upgrade failed or unauthorized" },
        },
      },
    },
  },
};
