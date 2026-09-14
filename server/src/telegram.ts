import { config } from "./config.js";
import {
  alertAlreadySent,
  insertAlert,
  insertEvent,
  isWatched,
  listScoredPairs,
} from "./db.js";
import { bandLabel } from "./scoring.js";
import { nowIso, uid } from "./util.js";
import type { AlertRecord, ScoredPair } from "./types.js";

export function telegramConfigured(): boolean {
  return Boolean(config.telegramToken && config.telegramChatId);
}

export function shouldAlert(pair: ScoredPair, minScore = config.alertMinScore): {
  kind: "high_score" | "watchlist";
} | null {
  if (pair.watched) return { kind: "watchlist" };
  if (pair.score >= minScore) return { kind: "high_score" };
  return null;
}

export function formatAlert(pair: ScoredPair, kind: "high_score" | "watchlist"): string {
  const why = pair.features
    .filter((f) => f.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 4)
    .map((f) => `• ${f.label} ${f.points}/${f.maxPoints}: ${f.evidence}`)
    .join("\n");
  const header = kind === "watchlist" ? "WATCHLIST HIT" : "HIGH RISK SCORE";
  return [
    `TrenchDesk · ${header}`,
    `${pair.symbol}  ${bandLabel(pair.band)} ${pair.score}/100`,
    `mint: ${pair.mint}`,
    `liq ${fmt(pair.liquidityUsd)} · vol24 ${fmt(pair.volume24h)} · age ${pair.ageMinutes ?? "?"}m`,
    pair.links.dexscreener ?? "",
    "",
    why,
    "",
    "Not financial advice. No execution.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export async function sendTelegram(text: string): Promise<{ dryRun: boolean; status: string }> {
  if (!telegramConfigured()) {
    return { dryRun: true, status: "dry-run: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID unset" };
  }
  const url = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: config.telegramChatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { dryRun: false, status: `telegram-error ${res.status} ${body.slice(0, 120)}` };
  }
  return { dryRun: false, status: "sent" };
}

export async function dispatchAlerts(pairs = listScoredPairs(200)): Promise<AlertRecord[]> {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const out: AlertRecord[] = [];
  for (const pair of pairs) {
    const watched = pair.watched || isWatched(pair.mint);
    const candidate = shouldAlert({ ...pair, watched });
    if (!candidate) continue;
    if (alertAlreadySent(pair.mint, candidate.kind, since)) continue;
    const message = formatAlert(pair, candidate.kind);
    const sent = await sendTelegram(message);
    const record: AlertRecord = {
      id: uid("alrt"),
      mint: pair.mint,
      kind: candidate.kind,
      score: pair.score,
      dryRun: sent.dryRun,
      message,
      createdAt: nowIso(),
      status: sent.status,
    };
    insertAlert(record);
    if (candidate.kind === "watchlist") {
      insertEvent({
        id: uid("evt"),
        mint: pair.mint,
        pairAddress: pair.pairAddress,
        kind: "watchlist_hit",
        source: pair.sources[0] ?? "mock",
        headline: `Watchlist hit ${pair.symbol} · ${pair.score}/100`,
        payload: { score: pair.score },
        createdAt: nowIso(),
      });
    }
    out.push(record);
  }
  return out;
}

function fmt(n: number | null): string {
  if (n == null) return "n/a";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
