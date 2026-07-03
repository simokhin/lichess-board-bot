# Lichess Board Bot

A Telegram bot that bridges a [lichess.org](https://lichess.org) game to a physical chess board.
Play on a real board while your opponent plays online: send your moves to the bot as plain text,
and it forwards them to lichess via the [Board API](https://lichess.org/api#tag/Board); your
opponent's moves come back as Telegram messages.

## Features

- Auto-connects to your active game as soon as it starts on lichess (no need to do anything but play);
  also checks for a game already in progress on startup, in case the bot was offline when it began.
- Send moves in SAN (`e4`, `Nf3`, `O-O`, `0-0`) or UCI (`e2e4`, `e7e8q`).
- `/newgame` — inline menu to find a real-time opponent (Rapid/Classical) or challenge a friend by username.
- `/status` — current position as a unicode board diagram, whose turn it is, and the clock.
- `/sync` — manually reconnect to a game already in progress, if it was ever missed.
- `/draw` / `/nodraw` — offer, accept, or decline a draw.
- `/resign` — resign the game.
- Reconnects automatically if the connection to a game drops mid-play.
- Single active game, single owner chat — built for personal, local use.

## Limitations

- **Bullet and Blitz aren't supported.** The Board API's real-time seek only accepts time controls
  of Rapid speed or slower (`minutes * 60 + increment * 40 >= 480` seconds). This also fits the
  point of the project — bullet isn't very playable with a physical board anyway.
- **No "play vs the computer".** Games created via lichess's AI-challenge endpoint aren't playable
  through the Board API at all (Lichess rejects it), so there's no way to wire that up through the
  public API for a regular account.
- One game and one Telegram chat at a time.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in:
   - `TELEGRAM_BOT_TOKEN` — create a bot via [@BotFather](https://t.me/BotFather).
   - `LICHESS_TOKEN` — create a personal access token at
     [lichess.org/account/oauth/token](https://lichess.org/account/oauth/token) with the
     **`board:play`** scope.
   - `TELEGRAM_ALLOWED_CHAT_ID` *(optional)* — restrict the bot to a single chat. Leave blank
     initially; send `/start` to the bot and it will reply with your chat id.
   - `DEBUG_LICHESS` *(optional)* — set to `1` to log every Lichess API request, response, and
     stream message to the console.
3. Run it:
   ```
   npm run dev
   ```

## Usage

Send `/start` to the bot, then either:

- Start a game the normal way on lichess.org / the app — the bot picks it up automatically, or
- Use `/newgame` in Telegram to seek an opponent or challenge a friend.

Once a game is running, send moves as plain text messages. Opponent moves, clock updates, draw
offers, and game-end results arrive as bot messages.

| Command | Description |
| --- | --- |
| `/newgame` | Start a game via quick pairing or by challenging a friend |
| `/status` | Show the board, whose turn it is, and the clock |
| `/sync` | Reconnect to a game already in progress, if it was ever missed |
| `/resign` | Resign the current game |
| `/draw` | Offer a draw, or accept one already offered |
| `/nodraw` | Decline an offered draw |

## Project layout

- `src/lichessClient.ts` — thin wrapper around the Lichess Board API (NDJSON streaming, moves, seek/challenge).
- `src/gameManager.ts` — tracks the active game's state via `chess.js`, bridges lichess events to Telegram notifications.
- `src/bot.ts` — Telegram bot (grammy): commands, inline menus, move input.
- `src/index.ts` — entry point.

## Requirements

- Node.js >= 18
