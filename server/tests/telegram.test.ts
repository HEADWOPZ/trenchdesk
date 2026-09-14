import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAlert, sendTelegram, shouldAlert, telegramConfigured } from "../src/telegram.js";
import { scorePair } from "../src/scoring.js";
import { mockPairs } from "../src/ingest/mock.js";
import type { ScoredPair } from "../src/types.js";

function scored(index = 0, extra: Partial<ScoredPair> = {}): ScoredPair {
  const pair = mockPairs()[index];
  const risk = scorePair(pair);
  return { ...pair, ...risk, watched: false, ...extra };
}

describe("telegram alerts", () => {
  it("is dry-run when token/chat are unset", () => {
    assert.equal(telegramConfigured(), false);
  });

  it("alerts high scores and watchlist hits, ignores quiet paper", () => {
    const hot = scored(0, { score: 88, watched: false });
    const watched = scored(2, { score: 12, watched: true });
    const quiet = scored(2, { score: 12, watched: false });
    assert.deepEqual(shouldAlert(hot, 70), { kind: "high_score" });
    assert.deepEqual(shouldAlert(watched, 70), { kind: "watchlist" });
    assert.equal(shouldAlert(quiet, 70), null);
  });

  it("formats a grounded message with mint, score, and features", () => {
    const pair = scored(0);
    const text = formatAlert(pair, "high_score");
    assert.match(text, /HIGH RISK SCORE/);
    assert.match(text, /RUGX/);
    assert.ok(text.includes(pair.mint));
    assert.match(text, /Not financial advice/);
    assert.match(text, /Liquidity|Honeypot|Pair age/);
  });

  it("sendTelegram dry-runs without credentials", async () => {
    const result = await sendTelegram("hello");
    assert.equal(result.dryRun, true);
    assert.match(result.status, /dry-run/);
  });
});
