# Lichess Board Bot

[![CI](https://github.com/simokhin/lichess-board-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/simokhin/lichess-board-bot/actions/workflows/ci.yml)

A Telegram bot that bridges a [lichess.org](https://lichess.org) game to a physical chess board.
Play on a real board while your opponent plays online: send your moves to the bot as plain text,
and it forwards them to lichess via the [Board API](https://lichess.org/api#tag/Board); your
opponent's moves come back as Telegram messages.

## Features

- Auto-connects to your active game as soon as it starts — on lichess or via `/newgame` — and
  picks up a game already in progress if the bot was offline when it began (or via `/sync`).
- Send moves in SAN (`e4`, `Nf3`, `O-O`, `0-0`) or UCI (`e2e4`, `e7e8q`).
- Board diagram, clock, draws, and resigning — see the command table below.
- Reconnects automatically if the connection to a game drops mid-play.
- Single active game, single owner chat — built for personal, local use.

## Limitations

- **Bullet and Blitz aren't supported.** Lichess's real-time seek only accepts Rapid speed or
  slower — fitting, since bullet isn't very playable with a physical board anyway.
- **`/newgame` can't start a game against the computer** (a Lichess API restriction). Starting one
  from lichess.org or the app yourself works fine — the bot plays it like any other game.
- One game and one Telegram chat at a time.

## Setup

You'll need Node.js 18+. Then, in a terminal, inside this folder:

1. `npm install`
2. `npm run setup` — a guided setup that gets both tokens and writes `.env` for you, verifying
   each token as you enter it. (Prefer doing it by hand? Copy `.env.example` to `.env` instead.)
3. `npm run dev`
4. In Telegram, open a chat with your new bot and send `/start`.

<details>
<summary>What each .env value is, if you're filling it in manually</summary>

- `TELEGRAM_BOT_TOKEN` — create a bot via [@BotFather](https://t.me/BotFather): send it `/newbot`
  and follow the prompts. It replies with a token.
- `LICHESS_TOKEN` — create a personal access token at
  [lichess.org/account/oauth/token](https://lichess.org/account/oauth/token) with the
  **`board:play`** scope checked.
- `TELEGRAM_ALLOWED_CHAT_ID` *(optional)* — restrict the bot to a single chat. Leave blank
  initially; send `/start` to the bot and it will reply with your chat id.
- `DEBUG_LICHESS` *(optional)* — set to `1` to log every Lichess API request, response, and
  stream message to the console.

</details>

## Usage

Send `/start`, then either start a game the normal way on lichess.org/the app, or use `/newgame`
to seek an opponent or challenge a friend. Once a game is running, send moves as plain text —
opponent moves, clock updates, draw offers, and results arrive as bot messages.

| Command | Description |
| --- | --- |
| `/newgame` | Start a game via quick pairing or by challenging a friend |
| `/status` | Show the board, whose turn it is, and the clock |
| `/sync` | Reconnect to a game already in progress, if it was ever missed |
| `/resign` | Resign the current game |
| `/draw` | Offer a draw, or accept one already offered |
| `/nodraw` | Decline an offered draw |

## Keeping it running

`npm run dev` stops the moment you close the terminal. To keep the bot running (and have it
recover from a crash or reboot), use a process manager like [pm2](https://pm2.keymetrics.io/):

```
npm run build
npm install -g pm2
pm2 start dist/index.js --name lichess-board-bot
pm2 save && pm2 startup   # pm2 startup prints a command to run — follow its instructions
```

Network hiccups are already handled by the bot itself — a process manager is only for recovering
from an actual crash or reboot.

## Troubleshooting

**The bot doesn't respond to anything.**
Check the process is running and that you've sent `/start` at least once. Still silent? Re-run
`npm run setup` to re-verify `TELEGRAM_BOT_TOKEN`.

**Moves fail, or the bot says Lichess rejected something.**
Almost always a `LICHESS_TOKEN` without the `board:play` scope. Re-run `npm run setup` and create
a fresh token — its link pre-selects the right scope.

**I started a game elsewhere and the bot never mentioned it.**
Send `/sync` — it checks lichess directly and connects, no restart needed.

**"Looking for an opponent..." just sits there.**
A live seek only matches once someone else is seeking the exact same time control, so it can take
seconds to a few minutes — not the instant matchmaking of the lichess.org homepage. Try again
later, or use "Challenge a friend" if you have someone specific in mind.

**I tapped a button and got "Menu was outdated, try again!"**
Harmless — the bot restarted since that message was sent. Run the command again for a fresh menu.

**I want to see exactly what the bot is telling Lichess.**
Set `DEBUG_LICHESS=1` in `.env` and restart.

## Project layout

- `src/lichessClient.ts` — Lichess Board API wrapper (NDJSON streaming, moves, seek/challenge).
- `src/gameManager.ts` — game state via `chess.js`, bridges lichess events to Telegram.
- `src/bot.ts` — Telegram bot (grammy): commands, inline menus, move input.
- `src/index.ts` — entry point.

## License

[MIT](LICENSE)
