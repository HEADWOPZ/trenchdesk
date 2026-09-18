import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { explainFeatures, scorePair } from "../src/scoring.js";
import { mockPairs } from "../src/ingest/mock.js";
import type { NewPair } from "../src/types.js";

function base(over: Partial<NewPair> = {}): NewPair {
  return {
    mint: "Mint1111111111111111111111111111111111111",
    pairAddress: "Pair1111111111111111111111111111111111111",
    symbol: "TEST",
    name: "Test",
    chain: "solana",
    dex: "raydium",
    liquidityUsd: 50_000,
    volume24h: 20_000,
    volume1h: 2_000,
    priceUsd: 0.01,
    fdvUsd: 100_000,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    ageMinutes: 3 * 24 * 60,
    buys24h: 100,
    sells24h: 90,
    holders: 800,
    links: { twitter: "https://x.com/x", website: "https://example.com" },
    sources: ["mock"],
    tags: [],
    raw: {
      mintAuthorityDisabled: true,
      freezeAuthorityDisabled: true,
      devBalancePercentage: 1,
      lpLocked: true,
    },
    ...over,
  };
}

describe("scorePair", () => {
  it("scores a seasoned, deep, audited pair in the clear band", () => {
    const risk = scorePair(base());
    assert.equal(risk.features.length, 6);
    assert.ok(risk.score < 40, `expected clear-ish, got ${risk.score}`);
    assert.equal(risk.band, "clear");
    assert.ok(risk.features.every((f) => f.points <= f.maxPoints));
  });

  it("flags a brand-new dust honeypot-ish mint near the top of the scale", () => {
    const risk = scorePair(
      base({
        liquidityUsd: 200,
        volume24h: 12_000,
        ageMinutes: 3,
        createdAt: new Date().toISOString(),
        buys24h: 30,
        sells24h: 0,
        holders: 4,
        links: {},
        tags: [],
        raw: {
          mintAuthorityDisabled: false,
          freezeAuthorityDisabled: false,
          devBalancePercentage: 42,
          lpLocked: false,
        },
      }),
    );
    assert.ok(risk.score >= 70, `expected flagged, got ${risk.score}`);
    assert.equal(risk.band, "flagged");
    const honeypot = risk.features.find((f) => f.id === "honeypot");
    assert.ok(honeypot && honeypot.points >= 12);
  });

  it("caps the score at 100 and explains in plain language", () => {
    const [rug] = mockPairs();
    const risk = scorePair(rug);
    assert.ok(risk.score <= 100);
    const text = explainFeatures(risk, rug.symbol);
    assert.match(text, /RUGX/);
    assert.match(text, /Feature breakdown/);
    assert.match(text, /not financial advice/i);
  });

  it("marks missing holder data as unavailable instead of inventing counts", () => {
    const risk = scorePair(base({ holders: null, raw: { mintAuthorityDisabled: true } }));
    const holders = risk.features.find((f) => f.id === "holders");
    assert.equal(holders?.available, false);
    assert.match(holders?.evidence ?? "", /not provided/i);
  });

  it("scores the offline mock fixture into the documented bands", () => {
    const [rug, , desk, dust] = mockPairs();
    const rugRisk = scorePair(rug);
    const deskRisk = scorePair(desk);
    const dustRisk = scorePair(dust);
    assert.equal(rugRisk.band, "flagged");
    assert.ok(rugRisk.score >= 70);
    assert.equal(deskRisk.band, "clear");
    assert.ok(deskRisk.score < 40);
    assert.equal(dustRisk.band, "watch");
    assert.ok(dustRisk.score >= 40 && dustRisk.score < 70);
  });
});
