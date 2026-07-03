import { Bot, type Context } from "grammy";
import { Menu } from "@grammyjs/menu";
import { challengeUser, seekGame, type TimeControl } from "./lichessClient.js";
import { config } from "./config.js";
import { GameManager } from "./gameManager.js";

let activeChatId: number | undefined = config.allowedChatId;
let awaitingChallengeUsername = false;

// The Board API's real-time seek only accepts Rapid-speed-or-slower time controls
// (estimated duration = minutes*60 + increment*40 >= 480s); Bullet/Blitz are rejected outright.
const SEEK_TIME_CONTROLS: Array<TimeControl & { label: string }> = [
  { label: "10+5 Rapid", minutes: 10, increment: 5 },
  { label: "15+10 Classical", minutes: 15, increment: 10 },
  { label: "30+0 Classical", minutes: 30, increment: 0 },
  { label: "30+20 Classical", minutes: 30, increment: 20 },
];

const FRIEND_TIME_CONTROL: TimeControl = { minutes: 10, increment: 5 };

export const BOT_COMMANDS = [
  { command: "start", description: "Show help and register this chat" },
  { command: "newgame", description: "Start a game (seek or challenge a friend)" },
  { command: "status", description: "Show the board, turn, and clock" },
  { command: "resign", description: "Resign the current game" },
  { command: "draw", description: "Offer or accept a draw" },
  { command: "nodraw", description: "Decline an offered draw" },
];

export function createBot(): { bot: Bot; gameManager: GameManager } {
  const bot = new Bot(config.telegramToken);
  const gameManager = new GameManager((text) => {
    if (activeChatId === undefined) {
      console.warn("No chat to notify yet. Send /start to the bot first.");
      return;
    }
    bot.api.sendMessage(activeChatId, text).catch((err) => console.error("sendMessage failed:", err));
  });

  const activeGameNotice = () => `You already have an active game: ${gameManager.getActiveGameLink()}`;

  const seekMenu = new Menu<Context>("seek-menu");
  for (const tc of SEEK_TIME_CONTROLS) {
    seekMenu
      .text(tc.label, async (ctx) => {
        if (gameManager.hasActiveGame()) {
          await ctx.editMessageText(activeGameNotice());
          return;
        }
        seekGame({ minutes: tc.minutes, increment: tc.increment, rated: true }).catch((err) => {
          if (activeChatId !== undefined) {
            bot.api.sendMessage(activeChatId, `Seek failed: ${(err as Error).message}`).catch(() => {});
          }
        });
        await ctx.editMessageText(
          `Looking for an opponent (${tc.minutes}+${tc.increment})... I'll message you when the game starts.`,
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
        await ctx.editMessageText(activeGameNotice());
        return;
      }
      awaitingChallengeUsername = true;
      await ctx.editMessageText(
        `Send the lichess username of the friend you want to challenge ` +
          `(${FRIEND_TIME_CONTROL.minutes}+${FRIEND_TIME_CONTROL.increment}, casual).`,
      );
    });
  newGameMenu.register(seekMenu);

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

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Hi! I'm a bridge between a physical chess board and lichess.\n" +
        `Your chat id: ${ctx.chat.id} (you can save it as TELEGRAM_ALLOWED_CHAT_ID).\n\n` +
        "Use /newgame to start a game, or just start one on lichess.org — I'll connect automatically.\n" +
        "Send moves as plain text (e.g. e4, Nf3, O-O).\n" +
        "Commands: /newgame, /status, /resign, /draw, /nodraw",
    );
  });

  bot.command("newgame", async (ctx) => {
    if (gameManager.hasActiveGame()) {
      await ctx.reply(activeGameNotice());
      return;
    }
    await ctx.reply("How would you like to start a game?", { reply_markup: newGameMenu });
  });

  bot.command("status", async (ctx) => {
    await ctx.reply(gameManager.getStatus(), { parse_mode: "Markdown" });
  });

  bot.command("resign", async (ctx) => {
    await ctx.reply(await gameManager.resign());
  });

  bot.command("draw", async (ctx) => {
    await ctx.reply(await gameManager.offerDraw());
  });

  bot.command("nodraw", async (ctx) => {
    await ctx.reply(await gameManager.declineDraw());
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;

    if (awaitingChallengeUsername) {
      awaitingChallengeUsername = false;
      const username = ctx.message.text.trim();
      try {
        await challengeUser(username, { ...FRIEND_TIME_CONTROL, rated: false });
        await ctx.reply(`Challenge sent to ${username}. I'll message you when they accept.`);
      } catch (err) {
        await ctx.reply(`Failed to challenge ${username}: ${(err as Error).message}`);
      }
      return;
    }

    await ctx.reply(await gameManager.handleUserMove(ctx.message.text));
  });

  return { bot, gameManager };
}
