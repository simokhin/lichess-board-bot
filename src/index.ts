import { BOT_COMMANDS, createBot } from "./bot.js";
import { config } from "./config.js";

// After either of these, the process is in an unknown state — log clearly and exit so a process
// manager (pm2, systemd, etc.) can restart cleanly, rather than limping on silently or hanging.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

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
