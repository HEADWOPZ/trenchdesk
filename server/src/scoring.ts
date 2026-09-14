import { nowIso } from "./util.js";
import type { Feature, NewPair, RiskBand, RiskBreakdown } from "./types.js";

export function bandFor(score: number): RiskBand {
  if (score >= 70) return "flagged";
  if (score >= 40) return "watch";
  return "clear";
}

export function bandLabel(band: RiskBand): string {
  if (band === "flagged") return "FLAGGED";
  if (band === "watch") return "WATCH";
  return "CLEAR-ISH";
}

function feature(
  id: string,
  label: string,
  points: number,
  maxPoints: number,
  evidence: string,
  available = true,
): Feature {
  return {
    id,
    label,
    points: available ? Math.round(points) : 0,
    maxPoints,
    evidence,
    available,
  };
}

function ageFeature(pair: NewPair): Feature {
  const age = pair.ageMinutes;
  if (age == null) {
    return feature("age", "Pair age", 8, 20, "Creation time unknown — treated as unverified fresh inventory.", false);
  }
  let points = 2;
  let evidence = `${age} min old — seasoned enough that age alone is not the main flag.`;
  if (age < 5) {
    points = 20;
    evidence = `${age} min old — brand-new pair. Highest age risk (deployer still in the room).`;
  } else if (age < 30) {
    points = 16;
    evidence = `${age} min old — still in the first half-hour. Classic rug window.`;
  } else if (age < 120) {
    points = 12;
    evidence = `${age} min old — under two hours. Fresh but not brand-new.`;
  } else if (age < 1440) {
    points = 6;
    evidence = `${age} min old (~${(age / 60).toFixed(1)}h) — intra-day pair.`;
  }
  return feature("age", "Pair age", points, 20, evidence);
}

function liquidityFeature(pair: NewPair): Feature {
  const liq = pair.liquidityUsd;
  if (liq == null) {
    return feature("liquidity", "Liquidity", 10, 20, "No reserve/liquidity figure from feeds.", false);
  }
  const pretty = `$${Math.round(liq).toLocaleString("en-US")}`;
  if (liq < 500) {
    return feature("liquidity", "Liquidity", 20, 20, `${pretty} — dust / unseeded pool. Easy to yank.`);
  }
  if (liq < 5_000) {
    return feature("liquidity", "Liquidity", 16, 20, `${pretty} — thin book. Slippage and LP-pull risk stay high.`);
  }
  if (liq < 25_000) {
    return feature("liquidity", "Liquidity", 10, 20, `${pretty} — small-cap trench size.`);
  }
  if (liq < 100_000) {
    return feature("liquidity", "Liquidity", 5, 20, `${pretty} — moderate depth.`);
  }
  return feature("liquidity", "Liquidity", 1, 20, `${pretty} — relatively deep for a meme desk scan.`);
}

function honeypotFeature(pair: NewPair): Feature {
  const raw = pair.raw;
  const mintOff = raw.mintAuthorityDisabled;
  const freezeOff = raw.freezeAuthorityDisabled;
  const buys = pair.buys24h;
  const sells = pair.sells24h;
  const liq = pair.liquidityUsd ?? 0;
  const vol = pair.volume24h ?? 0;
  const ratio = liq > 0 && vol > 0 ? vol / liq : null;

  let points = 0;
  const bits: string[] = [];

  if (freezeOff === false) {
    points += 12;
    bits.push("freeze authority still enabled (can blacklist wallets — honeypot-ish)");
  } else if (freezeOff === true) {
    bits.push("freeze authority disabled");
  }

  if (mintOff === false) {
    points += 8;
    bits.push("mint authority still enabled (supply can inflate)");
  } else if (mintOff === true) {
    bits.push("mint authority disabled");
  }

  if (buys != null && sells != null && buys >= 8 && sells === 0 && (pair.volume24h ?? 0) > 50) {
    points += 10;
    bits.push(`${buys} buys / 0 sells with volume — sell-side may be blocked or not yet real`);
  }

  if (ratio != null && ratio > 20) {
    points += 8;
    bits.push(`vol/liq ${ratio.toFixed(1)}× — wash-looking turnover vs. tiny book`);
  } else if (ratio != null && ratio > 8) {
    points += 4;
    bits.push(`vol/liq ${ratio.toFixed(1)}× — elevated churn`);
  }

  if (mintOff == null && freezeOff == null && buys == null) {
    return feature(
      "honeypot",
      "Honeypot-ish",
      6,
      20,
      "No mint/freeze audit and no buy/sell split — cannot clear this check.",
      false,
    );
  }

  points = Math.min(20, points);
  if (!bits.length) {
    bits.push("No strong honeypot pattern in available mint/freeze/flow fields.");
  }
  return feature("honeypot", "Honeypot-ish", points, 20, bits.join("; ") + ".");
}

function holdersFeature(pair: NewPair): Feature {
  const holders = pair.holders;
  const top = typeof pair.raw.top10HolderPercent === "number" ? pair.raw.top10HolderPercent : null;

  if (top != null) {
    if (top >= 70) {
      return feature("holders", "Holder concentration", 15, 15, `Top-10 wallets hold ${top.toFixed(1)}% — extreme concentration.`);
    }
    if (top >= 45) {
      return feature("holders", "Holder concentration", 10, 15, `Top-10 wallets hold ${top.toFixed(1)}%.`);
    }
    return feature("holders", "Holder concentration", 3, 15, `Top-10 wallets hold ${top.toFixed(1)}% — less crowded than typical rugs.`);
  }

  if (holders == null) {
    return feature("holders", "Holder concentration", 6, 15, "Holder count not provided by current feeds.", false);
  }
  if (holders < 10) {
    return feature("holders", "Holder concentration", 15, 15, `${holders} holders — essentially a private club.`);
  }
  if (holders < 50) {
    return feature("holders", "Holder concentration", 10, 15, `${holders} holders — still highly concentrated.`);
  }
  if (holders < 200) {
    return feature("holders", "Holder concentration", 5, 15, `${holders} holders — early distribution.`);
  }
  return feature("holders", "Holder concentration", 1, 15, `${holders} holders — broader than a typical fresh mint.`);
}

function deployerFeature(pair: NewPair): Feature {
  const devPct = typeof pair.raw.devBalancePercentage === "number" ? pair.raw.devBalancePercentage : null;
  const launchpad = typeof pair.raw.launchpad === "string" ? pair.raw.launchpad : "";
  const deployerAgeHours =
    typeof pair.raw.deployerAgeHours === "number" ? pair.raw.deployerAgeHours : null;

  if (deployerAgeHours != null && deployerAgeHours < 24) {
    return feature(
      "deployer",
      "Deployer age proxy",
      15,
      15,
      `Deployer wallet ~${deployerAgeHours.toFixed(1)}h old — fresh wallet proxy.`,
    );
  }
  if (deployerAgeHours != null && deployerAgeHours < 24 * 7) {
    return feature(
      "deployer",
      "Deployer age proxy",
      9,
      15,
      `Deployer wallet ~${(deployerAgeHours / 24).toFixed(1)}d old.`,
    );
  }

  if (devPct != null) {
    if (devPct >= 20) {
      return feature("deployer", "Deployer age proxy", 15, 15, `Dev still holds ${devPct.toFixed(1)}% — dump leverage.`);
    }
    if (devPct >= 10) {
      return feature("deployer", "Deployer age proxy", 10, 15, `Dev still holds ${devPct.toFixed(1)}%.`);
    }
    if (devPct >= 5) {
      return feature("deployer", "Deployer age proxy", 6, 15, `Dev still holds ${devPct.toFixed(1)}%.`);
    }
    return feature(
      "deployer",
      "Deployer age proxy",
      3,
      15,
      `Dev holds ${devPct.toFixed(1)}%${launchpad ? ` via ${launchpad}` : ""}. Wallet age unknown — using residual as proxy.`,
    );
  }

  if (launchpad) {
    return feature(
      "deployer",
      "Deployer age proxy",
      7,
      15,
      `Launchpad=${launchpad}. No wallet-age feed in v1 — launchpad tokens treated as unverified deployers.`,
      false,
    );
  }

  return feature(
    "deployer",
    "Deployer age proxy",
    8,
    15,
    "No deployer age, residual, or launchpad hint. Neutral-unverified.",
    false,
  );
}

function socialLpFeature(pair: NewPair): Feature {
  const links = pair.links;
  const hasSocial = Boolean(links.twitter || links.telegram || links.website);
  const liq = pair.liquidityUsd;
  const fdv = pair.fdvUsd;
  const boosted = pair.tags.includes("social-spike");
  let points = 0;
  const bits: string[] = [];

  if (!hasSocial) {
    points += 6;
    bits.push("no twitter/telegram/website on the merged record");
  } else {
    bits.push("at least one social/web link present");
  }

  if (liq != null && liq < 50) {
    points += 4;
    bits.push(`reserve $${liq.toFixed(0)} — LP looks open/unseeded`);
  } else if (liq != null && fdv != null && fdv > 50_000 && liq / fdv < 0.01) {
    points += 3;
    bits.push(`liq/FDV ${(100 * liq / fdv).toFixed(2)}% — LP thin vs. valuation (lock unknown)`);
  }

  if (boosted) {
    points = Math.max(0, points - 3);
    bits.push("DexScreener-style boost/social-spike tag (paid attention, not safety)");
  }

  if (pair.raw.lpLocked === true) {
    points = Math.max(0, points - 4);
    bits.push("feed reports LP locked (hint only)");
  } else if (pair.raw.lpLocked === false) {
    points += 3;
    bits.push("feed reports LP unlocked / open");
  } else {
    bits.push("no LP lock proof in v1 public feeds — treat as unknown, not safe");
  }

  return feature("social_lp", "Social + LP hints", Math.min(10, points), 10, bits.join("; ") + ".");
}

export function scorePair(pair: NewPair, scoredAt = nowIso()): RiskBreakdown {
  const features = [
    ageFeature(pair),
    liquidityFeature(pair),
    honeypotFeature(pair),
    holdersFeature(pair),
    deployerFeature(pair),
    socialLpFeature(pair),
  ];
  const score = Math.min(100, features.reduce((sum, f) => sum + f.points, 0));
  const band = bandFor(score);
  const hot = features.filter((f) => f.points >= f.maxPoints * 0.6).map((f) => f.label);
  const summary =
    band === "flagged"
      ? `Flagged ${score}/100. Drivers: ${hot.join(", ") || "stacked medium signals"}.`
      : band === "watch"
        ? `Watch ${score}/100. Not a hard rug call — ${hot.join(", ") || "several elevated features"}.`
        : `Clear-ish ${score}/100 on public heuristics. Missing fields still matter; this is not a green light.`;

  return {
    mint: pair.mint,
    score,
    band,
    summary,
    features,
    scoredAt,
  };
}

export function explainFeatures(breakdown: RiskBreakdown, symbol?: string): string {
  const who = symbol ? `${symbol} (${breakdown.mint})` : breakdown.mint;
  const lines = [
    `${who} scores ${breakdown.score}/100 (${bandLabel(breakdown.band)}).`,
    breakdown.summary,
    "",
    "Feature breakdown (points contribute to risk, not quality):",
    ...breakdown.features.map(
      (f) =>
        `• ${f.label}: ${f.points}/${f.maxPoints}${f.available ? "" : " (partial)"} — ${f.evidence}`,
    ),
    "",
    "This is a transparent rule engine over public feeds. It is not financial advice and cannot see private LP locks, hidden authorities, or off-chain intent.",
  ];
  return lines.join("\n");
}
