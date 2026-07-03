import { Bot, type Context } from "grammy";
import { Menu } from "@grammyjs/menu";
import { challengeUser, type TimeControl } from "./lichessClient.js";
import { config } from "./config.js";
import { GameManager } from "./gameManager.js";
import { escapeMd } from "./format.js";

let activeChatId: number | undefined = config.allowedChatId;
let awaitingChallengeUsername = false;

// The Board API's real-time seek only accepts Rapid-speed-or-slower time controls
// (estimated duration = minutes*60 + increment*40 >= 480s); Bullet/Blitz are rejected outright.
const SEEK_TIME_CONTROLS: Array<TimeControl & { label: string }> = [
  { label: "10+5 Rapid", minutes: 10, increment: 5 },
  { label: "15+10 Rapid", minutes: 15, increment: 10 },
  { label: "30+0 Classical", minutes: 30, increment: 0 },
  { label: "30+20 Classical", minutes: 30, increment: 20 },
];

const FRIEND_TIME_CONTROL: TimeControl = { minutes: 10, increment: 5 };

export const BOT_COMMANDS = [
  { command: "start", description: "Register this chat" },
  { command: "help", description: "How to play and full command list" },
  { command: "newgame", description: "Start a game (seek or challenge a friend)" },
  { command: "status", description: "Show the board, turn, and clock" },
  { command: "sync", description: "Reconnect to a game already in progress" },
  { command: "resign", description: "Resign the current game" },
  { command: "draw", description: "Offer or accept a draw" },
  { command: "nodraw", description: "Decline an offered draw" },
];

const HELP_TEXT =
  "*How to play*\n" +
  "Start a game on lichess.org, or use /newgame — I connect to it automatically. " +
  "Then just send your moves as plain text messages, the way you'd read them off a physical board.\n\n" +
  "*Move notation*\n" +
  "• SAN: `e4`, `Nf3`, `Bxc4`, `O-O` (or `0-0`), `e8=Q`\n" +
  "• UCI: `e2e4`, `e7e8q`\n\n" +
  "*Commands*\n" +
  "/newgame — start a game (seek or challenge a friend)\n" +
  "/status — board diagram, whose turn, clock\n" +
  "/sync — reconnect to a game already in progress (if I missed it)\n" +
  "/resign — resign the current game (asks to confirm)\n" +
  "/draw — offer a draw, or accept one already offered\n" +
  "/nodraw — decline an offered draw";

export function createBot(): { bot: Bot; gameManager: GameManager } {
  const bot = new Bot(config.telegramToken);
  const gameManager = new GameManager((text) => {
    if (activeChatId === undefined) {
      console.warn("No chat to notify yet. Send /start to the bot first.");
      return;
    }
    bot.api
      .sendMessage(activeChatId, text, { parse_mode: "Markdown" })
      .catch((err) => console.error("sendMessage failed:", err));
  });

  const activeGameNotice = () => `⚠️ You already have an active game: ${gameManager.getActiveGameLink()}`;

  const seekMenu = new Menu<Context>("seek-menu");
  for (const tc of SEEK_TIME_CONTROLS) {
    seekMenu
      .text(tc.label, async (ctx) => {
        if (gameManager.hasActiveGame()) {
          await ctx.editMessageText(activeGameNotice(), { parse_mode: "Markdown" });
          return;
        }
        const status = await gameManager.seekOpponent({ minutes: tc.minutes, increment: tc.increment, rated: true });
        await ctx.editMessageText(
          `${status}\nThis can take anywhere from seconds to a few minutes.`,
        );
      })
      .row();
  }
  seekMenu.back("◀ Back");

  const newGameMenu = new Menu<Context>("newgame-menu")
    .submenu("🎲 Quick pairing", "seek-menu", async (ctx) => {
      await ctx.editMessageText("Pick a time control (rated pairing):");
    })
    .row()
    .text("👤 Challenge a friend", async (ctx) => {
      if (gameManager.hasActiveGame()) {
        await ctx.editMessageText(activeGameNotice(), { parse_mode: "Markdown" });
        return;
      }
      awaitingChallengeUsername = true;
      await ctx.editMessageText(
        `Send the lichess username of the friend you want to challenge ` +
          `(${FRIEND_TIME_CONTROL.minutes}+${FRIEND_TIME_CONTROL.increment}, casual).`,
      );
    });
  newGameMenu.register(seekMenu);

  const resignMenu = new Menu<Context>("resign-menu")
    .text("🏳️ Yes, resign", async (ctx) => {
      const result = await gameManager.resign();
      await ctx.editMessageText(result, { parse_mode: "Markdown" });
    })
    .row()
    .text("Cancel", async (ctx) => {
      await ctx.editMessageText("Resignation cancelled.");
    });

  bot.use((ctx, next) => {
    if (config.allowedChatId !== undefined && ctx.chat?.id !== config.allowedChatId) {
      return; // ignore messages from anyone but the configured owner
    }
    if (ctx.chat?.id !== undefined) {
      activeChatId = ctx.chat.id; // remember where to push background notifications
    }
    return next();
  });

  bot.use(newGameMenu);
  bot.use(resignMenu);

  bot.command("start", async (ctx) => {
    const restrictionNotice =
      config.allowedChatId === undefined
        ? "\n\n⚠️ Anyone who finds this bot can currently use it — set TELEGRAM_ALLOWED_CHAT_ID " +
          `to ${ctx.chat.id} in .env and restart to restrict it to this chat.`
        : "";
    await ctx.reply(
      "Hi! I'm a bridge between a physical chess board and lichess.\n" +
        `Your chat id: ${ctx.chat.id} (you can save it as TELEGRAM_ALLOWED_CHAT_ID).\n\n` +
        "Send /help to see how to play, or /newgame to start." +
        restrictionNotice,
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: "Markdown" });
  });

  bot.command("newgame", async (ctx) => {
    if (gameManager.hasActiveGame()) {
      await ctx.reply(activeGameNotice(), { parse_mode: "Markdown" });
      return;
    }
    await ctx.reply("How would you like to start a game?", { reply_markup: newGameMenu });
  });

  bot.command("status", async (ctx) => {
    await ctx.reply(gameManager.getStatus(), { parse_mode: "Markdown" });
  });

  bot.command("sync", async (ctx) => {
    await ctx.reply(await gameManager.syncActiveGame(), { parse_mode: "Markdown" });
  });

  bot.command("resign", async (ctx) => {
    if (!gameManager.hasActiveGame()) {
      await ctx.reply("No active game.");
      return;
    }
    await ctx.reply("⚠️ Are you sure you want to resign?", { reply_markup: resignMenu });
  });

  bot.command("draw", async (ctx) => {
    await ctx.reply(await gameManager.offerDraw(), { parse_mode: "Markdown" });
  });

  bot.command("nodraw", async (ctx) => {
    await ctx.reply(await gameManager.declineDraw(), { parse_mode: "Markdown" });
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;

    if (awaitingChallengeUsername) {
      awaitingChallengeUsername = false;
      const username = ctx.message.text.trim();
      try {
        await challengeUser(username, { ...FRIEND_TIME_CONTROL, rated: false });
        await ctx.reply(`✅ Challenge sent to ${escapeMd(username)}. I'll message you when they accept.`, {
          parse_mode: "Markdown",
        });
      } catch (err) {
        await ctx.reply(`⚠️ Failed to challenge ${escapeMd(username)}: ${escapeMd((err as Error).message)}`, {
          parse_mode: "Markdown",
        });
      }
      return;
    }

    await ctx.reply(await gameManager.handleUserMove(ctx.message.text), { parse_mode: "Markdown" });
  });

  return { bot, gameManager };
}
