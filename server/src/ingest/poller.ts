import { config } from "../config.js";
import {
  getMeta,
  getPair,
  getScore,
  insertEvent,
  listFeedStatus,
  pruneOld,
  setFeedStatus,
  setMeta,
  upsertPair,
  upsertScore,
} from "../db.js";
import { scorePair } from "../scoring.js";
import { nowIso, stableId } from "../util.js";
import type { FeedStatus, NewPair, TokenEvent } from "../types.js";
import { ingestLive, ingestMock } from "./feeds.js";
import { dispatchAlerts } from "../telegram.js";

export type PollResult = {
  mode: "live" | "mock";
  ingested: number;
  scored: number;
  events: number;
  fallback: boolean;
  feeds: FeedStatus[];
  at: string;
};

function eventFor(pair: NewPair, kind: TokenEvent["kind"], headline: string): TokenEvent {
  return {
    id: stableId(kind, pair.mint, pair.pairAddress, headline),
    mint: pair.mint,
    pairAddress: pair.pairAddress,
    kind,
    source: pair.sources[0] ?? "mock",
    headline,
    payload: {
      symbol: pair.symbol,
      tags: pair.tags,
      liquidityUsd: pair.liquidityUsd,
      volume24h: pair.volume24h,
    },
    createdAt: nowIso(),
  };
}

export async function runPoll(): Promise<PollResult> {
  const at = nowIso();
  let mode: "live" | "mock" = config.feedMode;
  let fallback = false;
  let pairs: NewPair[] = [];
  let statuses: FeedStatus[] = [];

  if (mode === "live") {
    const live = await ingestLive();
    pairs = live.pairs;
    statuses = live.statuses;
    const liveHits = statuses.filter((s) => s.source !== "birdeye" && s.ok && s.count > 0).length;
    if (liveHits === 0) {
      fallback = true;
      mode = "mock";
      const mocked = ingestMock();
      pairs = mocked.pairs;
      statuses = [...statuses, ...mocked.statuses];
    }
  } else {
    const mocked = ingestMock();
    pairs = mocked.pairs;
    statuses = mocked.statuses;
  }

  let ingested = 0;
  let scored = 0;
  let events = 0;

  for (const incoming of pairs) {
    const previous = getPair(incoming.mint);
    const previousScore = getScore(incoming.mint);
    upsertPair(incoming);
    ingested += 1;
    const breakdown = scorePair(incoming);
    upsertScore(breakdown);
    scored += 1;

    if (!previous) {
      insertEvent(
        eventFor(
          incoming,
          "new_pair",
          `New pair ${incoming.symbol} · liq ${fmt(incoming.liquidityUsd)} · score ${breakdown.score}`,
        ),
      );
      events += 1;
    }
    if (incoming.tags.includes("social-spike") && !previous?.tags.includes("social-spike")) {
      insertEvent(eventFor(incoming, "social_spike", `Social spike tag on ${incoming.symbol}`));
      events += 1;
    }
    if (previousScore && Math.abs(previousScore.score - breakdown.score) >= 8) {
      insertEvent(
        eventFor(
          incoming,
          "score_update",
          `${incoming.symbol} score ${previousScore.score} → ${breakdown.score}`,
        ),
      );
      events += 1;
    }
  }

  for (const status of statuses) setFeedStatus(status);
  setMeta("last_poll_at", at);
  setMeta("feed_mode_effective", mode);
  pruneOld();

  await dispatchAlerts();

  return { mode, ingested, scored, events, fallback, feeds: listFeedStatus(), at };
}

function fmt(n: number | null): string {
  if (n == null) return "n/a";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function lastPollAt(): string | null {
  return getMeta("last_poll_at");
}
