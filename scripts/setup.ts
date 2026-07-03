import { createInterface, type Interface } from "node:readline/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseEnv } from "dotenv";

const ENV_PATH = ".env";

type ValidationResult = { ok: true; detail: string } | { ok: false; error: string };
type Validator = (value: string) => Promise<ValidationResult>;

function loadExisting(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  return parseEnv(readFileSync(ENV_PATH, "utf8"));
}

async function validateTelegramToken(token: string): Promise<ValidationResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json()) as { ok: boolean; result?: { username: string }; description?: string };
    if (data.ok && data.result) return { ok: true, detail: `bot @${data.result.username}` };
    return { ok: false, error: data.description ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function validateLichessToken(token: string): Promise<ValidationResult> {
  try {
    const res = await fetch("https://lichess.org/api/account", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} — check the token and that it has the board:play scope` };
    const data = (await res.json()) as { username: string };
    return { ok: true, detail: `account ${data.username}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function promptRequired(
  rl: Interface,
  label: string,
  existing: string | undefined,
  validate: Validator,
): Promise<string> {
  for (;;) {
    const hint = existing ? " (press Enter to keep current)" : "";
    const answer = (await rl.question(`${label}${hint}: `)).trim();
    const value = answer || existing;
    if (!value) {
      console.log("  Required — please enter a value.\n");
      continue;
    }
    process.stdout.write("  Checking... ");
    const result = await validate(value);
    if (result.ok) {
      console.log(`OK (${result.detail})\n`);
      return value;
    }
    console.log(`failed — ${result.error}`);
    console.log("  Let's try that again.\n");
  }
}

async function promptChatId(rl: Interface, existing: string | undefined): Promise<string> {
  for (;;) {
    const hint = existing ? ` (press Enter to keep "${existing}", or type "-" to clear)` : " (press Enter to skip)";
    const answer = (await rl.question(`Telegram chat id${hint}: `)).trim();
    if (answer === "-") return "";
    const value = answer || existing || "";
    if (value && !/^-?\d+$/.test(value)) {
      console.log("  That doesn't look like a numeric chat id — try again, or press Enter to skip.\n");
      continue;
    }
    return value;
  }
}

async function main() {
  console.log("Lichess Board Bot — setup");
  console.log("=".repeat(26) + "\n");
  console.log("This walks you through the two required tokens and writes a .env file for you.\n");

  const existing = loadExisting();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("1) Telegram bot token");
    console.log("   In Telegram, message @BotFather, send /newbot, and follow the prompts.");
    console.log("   BotFather will give you a token that looks like 123456789:AA...\n");
    const telegramToken = await promptRequired(
      rl,
      "Telegram bot token",
      existing.TELEGRAM_BOT_TOKEN,
      validateTelegramToken,
    );

    console.log("2) Lichess personal access token");
    console.log("   Open this link (it pre-selects the required \"Play games with the board API\" permission):");
    console.log("   https://lichess.org/account/oauth/token/create?scopes[]=board:play&description=Board+Bot");
    console.log("   Click \"Create\" and copy the token.\n");
    const lichessToken = await promptRequired(rl, "Lichess token", existing.LICHESS_TOKEN, validateLichessToken);

    console.log("3) Restrict the bot to your own chat (optional, recommended)");
    console.log("   You can leave this blank for now — after setup, send /start to your bot in");
    console.log("   Telegram and it will reply with your chat id. Re-run \"npm run setup\" to add it later.\n");
    const allowedChatId = await promptChatId(rl, existing.TELEGRAM_ALLOWED_CHAT_ID);

    const envContent =
      `TELEGRAM_BOT_TOKEN=${telegramToken}\n` +
      `LICHESS_TOKEN=${lichessToken}\n` +
      `# Optional: restrict the bot to a single Telegram chat (get the id from the bot's /start reply).\n` +
      `TELEGRAM_ALLOWED_CHAT_ID=${allowedChatId}\n` +
      `# Optional: set to 1 to log every Lichess API request/response/stream message to the console.\n` +
      `DEBUG_LICHESS=${existing.DEBUG_LICHESS ?? ""}\n`;

    writeFileSync(ENV_PATH, envContent);
    console.log(`Wrote ${ENV_PATH}\n`);
    console.log("Setup complete! Start the bot with:\n");
    console.log("  npm run dev\n");
    console.log("Then send /start to your bot in Telegram to begin.");
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  if (err instanceof Error && err.message.includes("readline was closed")) {
    console.log("\nSetup cancelled.");
    process.exit(1);
  }
  console.error("Setup failed:", err);
  process.exit(1);
});
