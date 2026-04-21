# BugChess Backend Mock

Mock-сервер для тестирования работоспособности клиентского приложения на Vue 3, реализующего Шведские шахматы (Bughouse Chess).

**Ключевые принципы:**
- Управление состояниями пользователя (idle / in_lobby / in_game)
- Взаимодействие преимущественно через события WebSocket
- Оптимистичное обновление данных на клиенте — сервер присылает только дельты, не полный стейт

## Технологии

Используй Bun вместо Node.js:

- `bun <file>` вместо `node <file>` или `ts-node <file>`
- `bun install` вместо `npm install`
- `bun run <script>` вместо `npm run <script>`
- `bunx <package>` вместо `npx <package>`
- Bun автоматически загружает `.env` — не используй `dotenv`

## Bun API

- `Bun.serve()` поддерживает WebSocket — не используй `express` или `ws`
- `bun:sqlite` для SQLite — не используй `better-sqlite3`
- `Bun.file` вместо `node:fs` readFile/writeFile

## WebSocket события

Схема любого события: `{ type: number, data?: any }`

Типы объявлены через enum `WsEvent` в `ws-events.ts`. При добавлении нового события:
1. Добавить значение в `WsEvent`
2. Отправлять через `wsMsg(WsEvent.XXX, data)`

| type | Константа      | Описание                  |
|------|----------------|---------------------------|
| 0    | IDLE           | Пользователь простаивает  |
| 1    | LOBBY_CONNECT  | Вход в лобби              |
| 2    | ERROR          | Ошибка                    |

## Структура эндпоинтов

Документация: `http://localhost:3000/docs`

| Метод | Путь                     | Описание                                  |
|-------|--------------------------|-------------------------------------------|
| POST  | `/auth/login`            | Вход (email + password)                   |
| POST  | `/auth/register`         | Регистрация                               |
| POST  | `/auth/logout`           | Выход                                     |
| POST  | `/auth/logout_all`       | Выход со всех устройств                   |
| POST  | `/auth/refresh`          | Обновление токена                         |
| GET   | `/users/me`              | Текущий пользователь (требует Bearer)     |
| GET   | `/users/active?nickname=`| Поиск пользователей по нику               |
| WS    | `/ws?token=`             | WebSocket (token = userId / access_token) |
| GET   | `/docs`                  | Scalar API docs                           |
| GET   | `/openapi.json`          | OpenAPI 3.1 spec                          |
