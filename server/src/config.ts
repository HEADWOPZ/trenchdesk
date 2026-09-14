import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv();

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const ROOT = resolve(process.cwd());

export const config = {
  port: num("PORT", 8787),
  host: process.env.HOST ?? "0.0.0.0",
  dbPath: resolve(ROOT, process.env.TRENCHDESK_DB ?? "./data/trenchdesk.sqlite"),
  feedMode: (process.env.FEED_MODE === "mock" ? "mock" : "live") as "live" | "mock",
  pollMs: Math.max(10_000, num("POLL_INTERVAL_MS", 30_000)),
  birdeyeKey: process.env.BIRDEYE_API_KEY?.trim() ?? "",
  telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID?.trim() ?? "",
  alertMinScore: num("ALERT_MIN_SCORE", 70),
  openaiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
  openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
  userAgent: "TrenchDesk/0.1 (+https://github.com/HEADWOPZ/trenchdesk)",
};

export const DISCLAIMER =
  "TrenchDesk is a research radar, not financial advice. Scores are transparent heuristics from public data — they are not rug guarantees, not alpha, and v1 never executes, copy-trades, or holds keys.";
