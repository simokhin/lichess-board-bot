import { createBot } from "./bot.js";

async function main() {
  const { bot, gameManager } = createBot();

  bot.catch((err) => console.error("Bot error:", err));

  await gameManager.start();
  await bot.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
