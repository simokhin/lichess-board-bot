import { Bot, InlineKeyboard, type Context } from "grammy";
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

/** Best-effort ack: a callback query can be stale (e.g. pressed while the bot was restarting), in
 * which case Telegram rejects the ack — that shouldn't abort the rest of the handler. */
async function safeAnswerCallback(ctx: Context): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
  } catch (err) {
    console.warn("answerCallbackQuery failed (stale callback query):", (err as Error).message);
  }
}

export function createBot(): { bot: Bot; gameManager: GameManager } {
  const bot = new Bot(config.telegramToken);
  const gameManager = new GameManager((text) => {
    if (activeChatId === undefined) {
      console.warn("No chat to notify yet. Send /start to the bot first.");
      return;
    }
    bot.api.sendMessage(activeChatId, text).catch((err) => console.error("sendMessage failed:", err));
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
      await ctx.reply(`You already have an active game: ${gameManager.getActiveGameLink()}`);
      return;
    }
    const keyboard = new InlineKeyboard()
      .text("🎲 Quick pairing", "newgame:seek")
      .row()
      .text("👤 Challenge a friend", "newgame:friend");
    await ctx.reply("How would you like to start a game?", { reply_markup: keyboard });
  });

  bot.callbackQuery("newgame:seek", async (ctx) => {
    await safeAnswerCallback(ctx);
    const keyboard = new InlineKeyboard();
    for (const tc of SEEK_TIME_CONTROLS) {
      keyboard.text(tc.label, `seek:${tc.minutes}:${tc.increment}`).row();
    }
    await ctx.editMessageText("Pick a time control (rated pairing):", { reply_markup: keyboard });
  });

  bot.callbackQuery(/^seek:([\d.]+):(\d+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    if (gameManager.hasActiveGame()) {
      await ctx.editMessageText(`You already have an active game: ${gameManager.getActiveGameLink()}`);
      return;
    }
    const minutes = Number(ctx.match[1]);
    const increment = Number(ctx.match[2]);
    seekGame({ minutes, increment, rated: true }).catch((err) => {
      if (activeChatId !== undefined) {
        bot.api.sendMessage(activeChatId, `Seek failed: ${(err as Error).message}`).catch(() => {});
      }
    });
    await ctx.editMessageText(
      `Looking for an opponent (${minutes}+${increment})... I'll message you when the game starts.`,
    );
  });

  bot.callbackQuery("newgame:friend", async (ctx) => {
    await safeAnswerCallback(ctx);
    if (gameManager.hasActiveGame()) {
      await ctx.editMessageText(`You already have an active game: ${gameManager.getActiveGameLink()}`);
      return;
    }
    awaitingChallengeUsername = true;
    await ctx.editMessageText(
      `Send the lichess username of the friend you want to challenge ` +
        `(${FRIEND_TIME_CONTROL.minutes}+${FRIEND_TIME_CONTROL.increment}, casual).`,
    );
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
