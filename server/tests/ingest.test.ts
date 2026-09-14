import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveTags, mergePairs } from "../src/ingest/feeds.js";
import { mockPairs } from "../src/ingest/mock.js";
import { watchlistCsv } from "../src/routes.js";
import { scorePair } from "../src/scoring.js";
import type { NewPair, ScoredPair, WatchlistEntry } from "../src/types.js";

describe("normalize / merge", () => {
  it("merges two sources onto one mint without dropping links or audit", () => {
    const [a] = mockPairs();
    const b: NewPair = {
      ...a,
      sources: ["jupiter"],
      liquidityUsd: 12,
      links: { twitter: "https://x.com/trench" },
      raw: { mintAuthorityDisabled: true, organicScore: 9 },
      tags: ["social-spike"],
    };
    const merged = mergePairs(a, b);
    assert.deepEqual(new Set(merged.sources), new Set(["mock", "jupiter"]));
    assert.equal(merged.links.twitter, "https://x.com/trench");
    assert.equal(merged.raw.mintAuthorityDisabled, true);
    assert.equal(merged.raw.devBalancePercentage, a.raw.devBalancePercentage);
    assert.ok((merged.liquidityUsd ?? 0) >= 12);
    assert.ok(merged.tags.includes("social-spike"));
  });

  it("derives honeypot-ish and low-liq tags from features that exist", () => {
    const tags = deriveTags(mockPairs()[0]);
    assert.ok(tags.includes("new-pair"));
    assert.ok(tags.includes("low-liq"));
    assert.ok(tags.includes("honeypot-ish"));
  });
});

describe("watchlist csv", () => {
  it("emits a header and one escaped row per watch item", () => {
    const pair = mockPairs()[0];
    const scored: ScoredPair = { ...pair, ...scorePair(pair), watched: true };
    const watch: WatchlistEntry[] = [
      { mint: pair.mint, symbol: pair.symbol, name: 'Rug, "Example"', note: "", addedAt: "2026-09-14T00:00:00.000Z" },
    ];
    const csv = watchlistCsv(watch, [scored]);
    const lines = csv.trim().split("\n");
    assert.equal(lines[0], "mint,symbol,name,pair,score,band,liquidity_usd,volume_24h,age_minutes,tags,added_at");
    assert.match(lines[1], /RUGX/);
    assert.match(lines[1], /"Rug, ""Example"""/);
    assert.ok(lines[1].includes(pair.mint));
  });
});
