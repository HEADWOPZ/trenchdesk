import type { FastifyInstance } from "fastify";
import { answerChat } from "./agent.js";
import { config, DISCLAIMER } from "./config.js";
import {
  addWatch,
  getScoredPair,
  listAlerts,
  listEvents,
  listFeedStatus,
  listScoredPairs,
  listWatch,
  removeWatch,
} from "./db.js";
import { lastPollAt, runPoll } from "./ingest/poller.js";
import { nowIso } from "./util.js";
import type { ScoredPair } from "./types.js";

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function watchlistCsv(rows: ReturnType<typeof listWatch>, pairs: ScoredPair[]): string {
  const byMint = new Map(pairs.map((p) => [p.mint, p]));
  const header = [
    "mint",
    "symbol",
    "name",
    "pair",
    "score",
    "band",
    "liquidity_usd",
    "volume_24h",
    "age_minutes",
    "tags",
    "added_at",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    const pair = byMint.get(row.mint);
    lines.push(
      [
        csvEscape(row.mint),
        csvEscape(row.symbol),
        csvEscape(row.name),
        csvEscape(pair?.pairAddress),
        csvEscape(pair?.score),
        csvEscape(pair?.band),
        csvEscape(pair?.liquidityUsd),
        csvEscape(pair?.volume24h),
        csvEscape(pair?.ageMinutes),
        csvEscape(pair?.tags.join("|")),
        csvEscape(row.addedAt),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => ({
    ok: true,
    service: "trenchdesk",
    version: "0.1.0",
    feedMode: config.feedMode,
    lastPollAt: lastPollAt(),
    telegram: {
      configured: Boolean(config.telegramToken && config.telegramChatId),
      mode: config.telegramToken && config.telegramChatId ? "live" : "dry-run",
    },
    llm: Boolean(config.openaiKey),
    birdeye: Boolean(config.birdeyeKey),
    disclaimer: DISCLAIMER,
  }));

  app.get("/api/pairs", async (req) => {
    const q = req.query as { limit?: string; minScore?: string; tag?: string; source?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 80) || 80));
    const minScore = q.minScore != null ? Number(q.minScore) : null;
    let pairs = listScoredPairs(limit);
    if (minScore != null && Number.isFinite(minScore)) {
      pairs = pairs.filter((p) => p.score >= minScore);
    }
    if (q.tag) pairs = pairs.filter((p) => p.tags.includes(q.tag as string));
    if (q.source) pairs = pairs.filter((p) => p.sources.includes(q.source as ScoredPair["sources"][number]));
    return { pairs, count: pairs.length, lastPollAt: lastPollAt() };
  });

  app.get("/api/pairs/:mint", async (req, reply) => {
    const { mint } = req.params as { mint: string };
    const pair = getScoredPair(mint);
    if (!pair) {
      reply.code(404);
      return { error: "unknown mint", mint };
    }
    return { pair, risk: { score: pair.score, band: pair.band, summary: pair.summary, features: pair.features } };
  });

  app.get("/api/events", async (req) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 80) || 80));
    return { events: listEvents(limit) };
  });

  app.get("/api/watchlist", async () => ({ watchlist: listWatch() }));

  app.post("/api/watchlist", async (req, reply) => {
    const body = req.body as { mint?: string; note?: string };
    if (!body?.mint) {
      reply.code(400);
      return { error: "mint required" };
    }
    const pair = getScoredPair(body.mint);
    addWatch({
      mint: body.mint,
      symbol: pair?.symbol ?? body.mint.slice(0, 6),
      name: pair?.name ?? pair?.symbol ?? "Unknown",
      note: body.note ?? "",
      addedAt: nowIso(),
    });
    return { ok: true, watchlist: listWatch() };
  });

  app.delete("/api/watchlist/:mint", async (req) => {
    const { mint } = req.params as { mint: string };
    const removed = removeWatch(mint);
    return { ok: removed, watchlist: listWatch() };
  });

  app.get("/api/watchlist.csv", async (_req, reply) => {
    const csv = watchlistCsv(listWatch(), listScoredPairs(400));
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", "attachment; filename=trenchdesk-watchlist.csv")
      .send(csv);
  });

  app.post("/api/chat", async (req, reply) => {
    const body = req.body as { message?: string; mint?: string };
    if (!body?.message?.trim()) {
      reply.code(400);
      return { error: "message required" };
    }
    return answerChat(body.message.trim(), body.mint);
  });

  app.get("/api/alerts", async () => ({
    alerts: listAlerts(50),
    mode: config.telegramToken && config.telegramChatId ? "live" : "dry-run",
  }));

  app.post("/api/poll", async () => runPoll());

  app.get("/api/desk", async () => ({
    pairs: listScoredPairs(80),
    events: listEvents(40),
    watchlist: listWatch(),
    feeds: listFeedStatus(),
    mode: config.feedMode,
    lastPollAt: lastPollAt(),
    disclaimer: DISCLAIMER,
  }));

  // Agent / PhantomBridge-facing surface (same payloads, stable prefix).
  app.get("/v1/pairs", async () => ({ pairs: listScoredPairs(80) }));
  app.get("/v1/pairs/:mint/risk", async (req, reply) => {
    const { mint } = req.params as { mint: string };
    const pair = getScoredPair(mint);
    if (!pair) {
      reply.code(404);
      return { error: "unknown mint", mint };
    }
    return {
      mint: pair.mint,
      symbol: pair.symbol,
      score: pair.score,
      band: pair.band,
      summary: pair.summary,
      features: pair.features,
      scoredAt: pair.scoredAt,
      links: pair.links,
      disclaimer: DISCLAIMER,
    };
  });
}
