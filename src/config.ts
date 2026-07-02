import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  telegramToken: required("TELEGRAM_BOT_TOKEN"),
  lichessToken: required("LICHESS_TOKEN"),
  allowedChatId: process.env.TELEGRAM_ALLOWED_CHAT_ID
    ? Number(process.env.TELEGRAM_ALLOWED_CHAT_ID)
    : undefined,
};
