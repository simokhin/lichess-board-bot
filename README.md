# Lichess Board Bot

[![CI](https://github.com/simokhin/lichess-board-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/simokhin/lichess-board-bot/actions/workflows/ci.yml)

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
- **`/newgame` can't start a game against the computer.** Games created via lichess's public
  AI-challenge endpoint aren't playable through the Board API (Lichess rejects it), so there's no
  way to wire that up from the bot. If you start a game against the computer on lichess.org or the
  app directly, though, the bot picks it up and plays it like any other game — this limitation is
  only about *creating* the game through the bot, not playing one.
- One game and one Telegram chat at a time.

## Setup

You'll need Node.js 18+ installed. Then, in a terminal, inside this folder:

1. Install dependencies:
   ```
   npm install
   ```
2. Run the guided setup — it walks you through getting both tokens and writes `.env` for you,
   checking each token as you enter it:
   ```
   npm run setup
   ```
   (Prefer to do it by hand? Copy `.env.example` to `.env` and fill in the values described below.)
3. Run it:
   ```
   npm run dev
   ```
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

## Keeping it running

`npm run dev` is fine for trying things out, but it stops the moment you close the terminal. For
actually playing, you want the bot to keep running (and to come back on its own if it ever
crashes or the machine reboots). The simplest way is [pm2](https://pm2.keymetrics.io/):

```
npm run build
npm install -g pm2
pm2 start dist/index.js --name lichess-board-bot
pm2 save
pm2 startup   # prints a command to run so pm2 survives a reboot — follow its instructions
```

Check on it any time with `pm2 logs lichess-board-bot` or `pm2 status`. A systemd service works
just as well if you're already comfortable with that.

Network hiccups (Wi-Fi dropping, lichess briefly unreachable) are handled automatically by the
bot itself — a process manager is only needed to recover from an actual crash or a reboot.

## Troubleshooting

**The bot doesn't respond to anything.**
Make sure the process is actually running (`npm run dev`, or `pm2 status` if you set that up) and
that you've sent it `/start` at least once. If it's running but still silent, double-check
`TELEGRAM_BOT_TOKEN` in `.env` — re-run `npm run setup` to have it re-verified against Telegram.

**Moves fail, or the bot says Lichess rejected something.**
Almost always a `LICHESS_TOKEN` problem — usually the token was created without the `board:play`
scope. Re-run `npm run setup` and create a fresh token; the link it gives you pre-selects the
right scope.

**I started a game on lichess.org (or the app) and the bot never mentioned it.**
Send `/sync` — it checks lichess directly for a game in progress and connects to it, no restart
needed. This covers the bot having missed the notification (e.g. it was briefly offline when the
game started).

**"Looking for an opponent..." just sits there.**
That's a live seek: it only matches once another real player is seeking the exact same time
control at that moment, so it can take anywhere from a few seconds to a few minutes — this isn't
the instant matchmaking you get from the lichess.org homepage. (In earlier versions this could
also hang indefinitely — the bot's own account-event connection was competing with the seek's
connection over the same network path. The bot now closes that connection while a seek is
pending and reopens it afterward, which fixed it in testing over a VPN; if it still never
resolves for you, that's worth [reporting](https://github.com/simokhin/lichess-board-bot/issues).)

**Bullet and Blitz aren't offered in Quick pairing.**
Expected — see [Limitations](#limitations). Rapid (10+5, 15+10) and Classical (30+0, 30+20) are
the fastest time controls the Board API supports for real-time seeks.

**Can I play against the computer through the bot?**
`/newgame` can't start one — see [Limitations](#limitations). But start a computer game on
lichess.org or the app yourself, and the bot connects to it just like any other game.

**I tapped a button and got "Menu was outdated, try again!"**
Harmless — it means the bot's code changed (or it restarted) since that particular message was
sent. Just run `/newgame` (or whichever command) again to get a fresh menu.

**Something's wrong and I want to see exactly what the bot is telling Lichess.**
Set `DEBUG_LICHESS=1` in `.env` and restart — every request, response, and stream message gets
logged to the console.

## Project layout

- `src/lichessClient.ts` — thin wrapper around the Lichess Board API (NDJSON streaming, moves, seek/challenge).
- `src/gameManager.ts` — tracks the active game's state via `chess.js`, bridges lichess events to Telegram notifications.
- `src/bot.ts` — Telegram bot (grammy): commands, inline menus, move input.
- `src/index.ts` — entry point.

## Requirements

- Node.js >= 18

## License

[MIT](LICENSE)
