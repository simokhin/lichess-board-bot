import { Bot } from "grammy";
import { config } from "./config.js";
import { GameManager } from "./gameManager.js";

let activeChatId: number | undefined = config.allowedChatId;

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
    return next();
  });

  bot.command("start", async (ctx) => {
    activeChatId = ctx.chat.id;
    await ctx.reply(
      "Привет! Я мост между физической доской и lichess.\n" +
        `Ваш chat id: ${ctx.chat.id} (можно сохранить в TELEGRAM_ALLOWED_CHAT_ID).\n\n` +
        "Начните партию на lichess.org — я подключусь автоматически.\n" +
        "Отправляйте ходы текстом (например: e4, Nf3, O-O).\n" +
        "Команды: /status, /resign, /draw, /nodraw",
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
    activeChatId = ctx.chat.id;
    await ctx.reply(await gameManager.handleUserMove(ctx.message.text));
  });

  return { bot, gameManager };
}
