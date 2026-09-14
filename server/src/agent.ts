import { config } from "./config.js";
import { getScoredPair, listScoredPairs } from "./db.js";
import { explainFeatures } from "./scoring.js";
import { extractMint } from "./util.js";
import type { ScoredPair } from "./types.js";

export type ChatReply = {
  reply: string;
  mint?: string;
  usedLlm: boolean;
  offline: boolean;
};

function findPair(message: string, selectedMint?: string): ScoredPair | null {
  if (selectedMint) {
    const direct = getScoredPair(selectedMint);
    if (direct) return direct;
  }
  const extracted = extractMint(message);
  if (extracted) {
    const byMint = getScoredPair(extracted);
    if (byMint) return byMint;
  }
  const pairs = listScoredPairs(200);
  const upper = message.toUpperCase();
  const bySymbol = pairs.find(
    (p) =>
      upper.includes(`$${p.symbol.toUpperCase()}`) ||
      new RegExp(`\\b${p.symbol.toUpperCase()}\\b`).test(upper),
  );
  return bySymbol ?? null;
}

function ruleReply(message: string, pair: ScoredPair | null): string {
  const q = message.toLowerCase();
  if (/disclaimer|advice|financial/.test(q)) {
    return "TrenchDesk does not give financial advice and cannot execute, copy-trade, or custody anything in v1. Scores are public-data heuristics for research context (later: PhantomBridge read-only risk).";
  }
  if (/how.*score|what.*score|0–100|0-100/.test(q)) {
    return [
      "Risk score is 0–100 (higher = more concerning), summed from six features:",
      "1. Pair age (max 20) — brand-new pairs score hotter.",
      "2. Liquidity (max 20) — dust books score hotter.",
      "3. Honeypot-ish (max 20) — mint/freeze still on, buys-without-sells, extreme vol/liq.",
      "4. Holder concentration (max 15) — tiny holder sets or top-10 % when Birdeye is keyed.",
      "5. Deployer age proxy (max 15) — fresh wallets or high remaining dev %.",
      "6. Social + LP hints (max 10) — missing links, unseeded reserve, unknown lock.",
      "Ask “why is this flagged?” with a symbol or mint to ground the answer in stored features.",
    ].join("\n");
  }
  if (!pair) {
    if (/why|flag|score|risk/.test(q)) {
      return "I need a mint, $SYMBOL, or a selected row. Click a pair on the desk, then ask “why is this flagged?”";
    }
    return "TrenchDesk agent (offline). I explain stored risk features — I do not trade. Try: “why is this flagged?”, “how does scoring work?”, or paste a mint.";
  }
  return explainFeatures(pair, pair.symbol);
}

async function llmPolish(base: string, message: string): Promise<string | null> {
  if (!config.openaiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.openaiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.openaiModel,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are TrenchDesk's research clerk. Only restate the provided feature breakdown. Do not invent locks, holders, or alpha. Refuse execution or financial advice. Keep it tight.",
          },
          { role: "user", content: `Question: ${message}\n\nGrounding:\n${base}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export async function answerChat(message: string, selectedMint?: string): Promise<ChatReply> {
  const pair = findPair(message, selectedMint);
  const base = ruleReply(message, pair);
  const polished = await llmPolish(base, message);
  return {
    reply: polished ?? base,
    mint: pair?.mint,
    usedLlm: Boolean(polished),
    offline: !polished,
  };
}
