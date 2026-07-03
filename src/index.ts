import { BOT_COMMANDS, createBot } from "./bot.js";
import { config } from "./config.js";

async function main() {
  if (config.allowedChatId === undefined) {
    console.warn(
      "⚠️  TELEGRAM_ALLOWED_CHAT_ID is not set — this bot will respond to anyone who messages it. " +
        "Send /start in Telegram to get your chat id, then add it to .env.",
    );
  }

  const { bot, gameManager } = createBot();

  bot.catch((err) => console.error("Bot error:", err));

  await bot.api.setMyCommands(BOT_COMMANDS);
  await gameManager.start();
  await bot.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
