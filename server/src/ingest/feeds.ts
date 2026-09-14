import { ageMinutes, fetchJson, isQuoteMint, num, unique } from "../util.js";
import { config } from "../config.js";
import type { FeedSource, FeedStatus, NewPair, TokenLinks } from "../types.js";
import { mockPairs } from "./mock.js";

type GeckoPool = {
  id: string;
  attributes: {
    address: string;
    name: string;
    pool_created_at: string | null;
    reserve_in_usd: string | null;
    fdv_usd: string | null;
    base_token_price_usd: string | null;
    volume_usd?: { h1?: string; h24?: string };
    transactions?: {
      h1?: { buys?: number; sells?: number };
      h24?: { buys?: number; sells?: number };
    };
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
    dex?: { data?: { id?: string } };
  };
};

type JupiterToken = {
  id: string;
  name?: string;
  symbol?: string;
  twitter?: string;
  website?: string;
  telegram?: string;
  holderCount?: number;
  fdv?: number;
  mcap?: number;
  usdPrice?: number;
  liquidity?: number;
  createdAt?: string;
  launchpad?: string;
  organicScore?: number;
  firstPool?: { id?: string; createdAt?: string };
  stats1h?: { buyVolume?: number; sellVolume?: number; numBuys?: number; numSells?: number };
  stats24h?: { buyVolume?: number; sellVolume?: number; numBuys?: number; numSells?: number };
  audit?: {
    mintAuthorityDisabled?: boolean;
    freezeAuthorityDisabled?: boolean;
    devBalancePercentage?: number;
    top10HolderPercent?: number;
  };
};

type DexBoost = {
  chainId: string;
  tokenAddress: string;
  url?: string;
  description?: string;
  links?: Array<{ type?: string; url?: string }>;
  amount?: number;
  totalAmount?: number;
};

type DexPair = {
  chainId: string;
  dexId?: string;
  pairAddress?: string;
  url?: string;
  pairCreatedAt?: number;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string };
  priceUsd?: string;
  fdv?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number; h1?: number };
  txns?: { h24?: { buys?: number; sells?: number }; h1?: { buys?: number; sells?: number } };
  info?: {
    websites?: Array<{ url?: string }>;
    socials?: Array<{ url?: string; type?: string }>;
  };
};

function mintFromGeckoId(id?: string): string | null {
  if (!id) return null;
  const mint = id.startsWith("solana_") ? id.slice("solana_".length) : id;
  return mint || null;
}

function splitPairName(name: string): { symbol: string; name: string } {
  const left = name.split("/")[0]?.trim() || name;
  return { symbol: left, name: left };
}

function geckoLinks(poolAddress: string, mint: string): TokenLinks {
  return {
    geckoterminal: `https://www.geckoterminal.com/solana/pools/${poolAddress}`,
    dexscreener: `https://dexscreener.com/solana/${mint}`,
  };
}

function fromGecko(pool: GeckoPool, tags: string[]): NewPair | null {
  const attrs = pool.attributes;
  const base = mintFromGeckoId(pool.relationships?.base_token?.data?.id);
  const quote = mintFromGeckoId(pool.relationships?.quote_token?.data?.id);
  let mint = base;
  if (mint && isQuoteMint(mint) && quote && !isQuoteMint(quote)) mint = quote;
  if (!mint || isQuoteMint(mint)) return null;
  const { symbol, name } = splitPairName(attrs.name || mint.slice(0, 6));
  const createdAt = attrs.pool_created_at;
  const tx = attrs.transactions?.h24;
  return {
    mint,
    pairAddress: attrs.address || pool.id,
    symbol,
    name,
    chain: "solana",
    dex: pool.relationships?.dex?.data?.id ?? "unknown",
    liquidityUsd: num(attrs.reserve_in_usd),
    volume24h: num(attrs.volume_usd?.h24),
    volume1h: num(attrs.volume_usd?.h1),
    priceUsd: num(attrs.base_token_price_usd),
    fdvUsd: num(attrs.fdv_usd),
    createdAt,
    ageMinutes: ageMinutes(createdAt),
    buys24h: tx?.buys ?? null,
    sells24h: tx?.sells ?? null,
    holders: null,
    links: geckoLinks(attrs.address, mint),
    sources: ["geckoterminal"],
    tags,
    raw: { geckoPoolId: pool.id },
  };
}

function fromJupiter(token: JupiterToken): NewPair | null {
  if (!token.id) return null;
  const createdAt = token.firstPool?.createdAt ?? token.createdAt ?? null;
  const links: TokenLinks = {
    dexscreener: `https://dexscreener.com/solana/${token.id}`,
  };
  if (token.twitter) links.twitter = token.twitter;
  if (token.website) links.website = token.website;
  if (token.telegram) links.telegram = token.telegram;
  const tags = ["new-pair"];
  if ((token.organicScore ?? 0) >= 40) tags.push("social-spike");
  const vol24 = (token.stats24h?.buyVolume ?? 0) + (token.stats24h?.sellVolume ?? 0);
  const vol1h = (token.stats1h?.buyVolume ?? 0) + (token.stats1h?.sellVolume ?? 0);
  return {
    mint: token.id,
    pairAddress: token.firstPool?.id || token.id,
    symbol: token.symbol || token.id.slice(0, 6),
    name: token.name || token.symbol || "Unknown",
    chain: "solana",
    dex: token.launchpad || "jupiter",
    liquidityUsd: num(token.liquidity),
    volume24h: vol24 || null,
    volume1h: vol1h || null,
    priceUsd: num(token.usdPrice),
    fdvUsd: num(token.fdv ?? token.mcap),
    createdAt,
    ageMinutes: ageMinutes(createdAt),
    buys24h: token.stats24h?.numBuys ?? null,
    sells24h: token.stats24h?.numSells ?? null,
    holders: token.holderCount ?? null,
    links,
    sources: ["jupiter"],
    tags,
    raw: {
      mintAuthorityDisabled: token.audit?.mintAuthorityDisabled,
      freezeAuthorityDisabled: token.audit?.freezeAuthorityDisabled,
      devBalancePercentage: token.audit?.devBalancePercentage,
      top10HolderPercent: token.audit?.top10HolderPercent,
      launchpad: token.launchpad,
      organicScore: token.organicScore,
    },
  };
}

function fromDexPair(pair: DexPair, extraTags: string[] = []): NewPair | null {
  if (pair.chainId !== "solana") return null;
  const mint = pair.baseToken?.address;
  if (!mint || isQuoteMint(mint)) return null;
  const createdAt = pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null;
  const links: TokenLinks = { dexscreener: pair.url };
  for (const site of pair.info?.websites ?? []) {
    if (site.url) links.website = site.url;
  }
  for (const social of pair.info?.socials ?? []) {
    if (!social.url) continue;
    if (social.type === "twitter") links.twitter = social.url;
    if (social.type === "telegram") links.telegram = social.url;
  }
  return {
    mint,
    pairAddress: pair.pairAddress || mint,
    symbol: pair.baseToken?.symbol || mint.slice(0, 6),
    name: pair.baseToken?.name || pair.baseToken?.symbol || "Unknown",
    chain: "solana",
    dex: pair.dexId || "dexscreener",
    liquidityUsd: num(pair.liquidity?.usd),
    volume24h: num(pair.volume?.h24),
    volume1h: num(pair.volume?.h1),
    priceUsd: num(pair.priceUsd),
    fdvUsd: num(pair.fdv),
    createdAt,
    ageMinutes: ageMinutes(createdAt),
    buys24h: pair.txns?.h24?.buys ?? null,
    sells24h: pair.txns?.h24?.sells ?? null,
    holders: null,
    links,
    sources: ["dexscreener"],
    tags: extraTags,
    raw: {},
  };
}

export function mergePairs(existing: NewPair | undefined, incoming: NewPair): NewPair {
  if (!existing) return incoming;
  const createdAt =
    existing.createdAt && incoming.createdAt
      ? Date.parse(existing.createdAt) <= Date.parse(incoming.createdAt)
        ? existing.createdAt
        : incoming.createdAt
      : existing.createdAt || incoming.createdAt;
  return {
    mint: existing.mint,
    pairAddress:
      incoming.pairAddress && incoming.pairAddress !== incoming.mint
        ? incoming.pairAddress
        : existing.pairAddress,
    symbol: incoming.symbol && incoming.symbol !== incoming.mint.slice(0, 6) ? incoming.symbol : existing.symbol,
    name: incoming.name && incoming.name !== "Unknown" ? incoming.name : existing.name,
    chain: "solana",
    dex: incoming.dex && incoming.dex !== "unknown" ? incoming.dex : existing.dex,
    liquidityUsd: pickMax(existing.liquidityUsd, incoming.liquidityUsd),
    volume24h: pickMax(existing.volume24h, incoming.volume24h),
    volume1h: pickMax(existing.volume1h, incoming.volume1h),
    priceUsd: incoming.priceUsd ?? existing.priceUsd,
    fdvUsd: pickMax(existing.fdvUsd, incoming.fdvUsd),
    createdAt,
    ageMinutes: ageMinutes(createdAt),
    buys24h: pickMax(existing.buys24h, incoming.buys24h),
    sells24h: pickMax(existing.sells24h, incoming.sells24h),
    holders: pickMax(existing.holders, incoming.holders),
    links: { ...existing.links, ...incoming.links },
    sources: unique([...existing.sources, ...incoming.sources]),
    tags: unique([...existing.tags, ...incoming.tags]),
    raw: { ...existing.raw, ...incoming.raw },
  };
}

function pickMax(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

export function deriveTags(pair: NewPair): string[] {
  const tags = new Set(pair.tags);
  if ((pair.ageMinutes ?? 9999) < 180) tags.add("new-pair");
  if ((pair.liquidityUsd ?? Infinity) < 5_000) tags.add("low-liq");
  if ((pair.liquidityUsd ?? 1) < 50) tags.add("lp-open");
  if ((pair.holders ?? 9999) < 30) tags.add("concentrated");
  if (pair.raw.freezeAuthorityDisabled === false || pair.raw.mintAuthorityDisabled === false) {
    tags.add("honeypot-ish");
  }
  if (pair.buys24h != null && pair.sells24h === 0 && pair.buys24h >= 8) tags.add("honeypot-ish");
  if (typeof pair.raw.devBalancePercentage === "number" && pair.raw.devBalancePercentage >= 15) {
    tags.add("fresh-deployer");
  }
  if (pair.raw.mintAuthorityDisabled === false) tags.add("mint-auth");
  if (pair.raw.freezeAuthorityDisabled === false) tags.add("freeze-on");
  if ((pair.volume1h ?? 0) > 20_000 && (pair.ageMinutes ?? 999) < 360) tags.add("social-spike");
  return [...tags];
}

async function gecko(path: string): Promise<GeckoPool[]> {
  const json = await fetchJson<{ data?: GeckoPool[] }>(
    `https://api.geckoterminal.com/api/v2/networks/solana/${path}`,
  );
  return json.data ?? [];
}

async function pullGecko(): Promise<{ pairs: NewPair[]; status: FeedStatus }> {
  const fetchedAt = new Date().toISOString();
  try {
    const [fresh, trending] = await Promise.all([
      gecko("new_pools?page=1"),
      gecko("trending_pools?page=1"),
    ]);
    const pairs = [
      ...fresh.map((p) => fromGecko(p, ["new-pair"])),
      ...trending.map((p) => fromGecko(p, ["trending"])),
    ].filter((p): p is NewPair => Boolean(p));
    return {
      pairs,
      status: { source: "geckoterminal", ok: true, count: pairs.length, fetchedAt },
    };
  } catch (err) {
    return {
      pairs: [],
      status: {
        source: "geckoterminal",
        ok: false,
        count: 0,
        error: err instanceof Error ? err.message : String(err),
        fetchedAt,
      },
    };
  }
}

async function pullJupiter(): Promise<{ pairs: NewPair[]; status: FeedStatus }> {
  const fetchedAt = new Date().toISOString();
  try {
    const tokens = await fetchJson<JupiterToken[]>("https://lite-api.jup.ag/tokens/v2/recent");
    const pairs = tokens.map(fromJupiter).filter((p): p is NewPair => Boolean(p));
    return { pairs, status: { source: "jupiter", ok: true, count: pairs.length, fetchedAt } };
  } catch (err) {
    return {
      pairs: [],
      status: {
        source: "jupiter",
        ok: false,
        count: 0,
        error: err instanceof Error ? err.message : String(err),
        fetchedAt,
      },
    };
  }
}

async function pullDexScreener(): Promise<{ pairs: NewPair[]; status: FeedStatus }> {
  const fetchedAt = new Date().toISOString();
  try {
    const boosts = await fetchJson<DexBoost[]>("https://api.dexscreener.com/token-boosts/latest/v1");
    const sol = boosts.filter((b) => b.chainId === "solana").slice(0, 20);
    const stubs: NewPair[] = sol.map((b) => ({
      mint: b.tokenAddress,
      pairAddress: b.tokenAddress,
      symbol: b.tokenAddress.slice(0, 4),
      name: b.description?.slice(0, 48) || "Boosted",
      chain: "solana",
      dex: "dexscreener",
      liquidityUsd: null,
      volume24h: null,
      volume1h: null,
      priceUsd: null,
      fdvUsd: null,
      createdAt: null,
      ageMinutes: null,
      buys24h: null,
      sells24h: null,
      holders: null,
      links: {
        dexscreener: b.url || `https://dexscreener.com/solana/${b.tokenAddress}`,
        ...Object.fromEntries(
          (b.links ?? [])
            .filter((l) => l.url)
            .map((l) => [
              l.type === "twitter" ? "twitter" : l.type === "telegram" ? "telegram" : "website",
              l.url as string,
            ]),
        ),
      },
      sources: ["dexscreener"],
      tags: ["social-spike"],
      raw: { boostAmount: b.amount ?? b.totalAmount ?? 0 },
    }));

    const mints = sol.map((b) => b.tokenAddress).filter(Boolean);
    if (mints.length) {
      try {
        const enriched = await fetchJson<DexPair[]>(
          `https://api.dexscreener.com/tokens/v1/solana/${mints.slice(0, 30).join(",")}`,
        );
        for (const pair of enriched) {
          const normalized = fromDexPair(pair, ["social-spike"]);
          if (normalized) stubs.push(normalized);
        }
      } catch {
        // boost stubs still useful
      }
    }

    return {
      pairs: stubs,
      status: { source: "dexscreener", ok: true, count: stubs.length, fetchedAt },
    };
  } catch (err) {
    return {
      pairs: [],
      status: {
        source: "dexscreener",
        ok: false,
        count: 0,
        error: err instanceof Error ? err.message : String(err),
        fetchedAt,
      },
    };
  }
}

async function pullBirdeye(mints: string[]): Promise<{ pairs: NewPair[]; status: FeedStatus }> {
  const fetchedAt = new Date().toISOString();
  if (!config.birdeyeKey) {
    return {
      pairs: [],
      status: {
        source: "birdeye",
        ok: true,
        count: 0,
        error: "BIRDEYE_API_KEY unset — skipped",
        fetchedAt,
      },
    };
  }
  const pairs: NewPair[] = [];
  let error: string | undefined;
  for (const mint of mints.slice(0, 8)) {
    try {
      const json = await fetchJson<{
        success?: boolean;
        data?: {
          holder?: number;
          security?: { top10HolderPercent?: number };
          top10HolderPercent?: number;
        };
      }>(`https://public-api.birdeye.so/defi/token_overview?address=${mint}`, {
        headers: { "X-API-KEY": config.birdeyeKey, "x-chain": "solana" },
      });
      const data = json.data;
      if (!data) continue;
      pairs.push({
        mint,
        pairAddress: mint,
        symbol: mint.slice(0, 4),
        name: mint.slice(0, 4),
        chain: "solana",
        dex: "birdeye",
        liquidityUsd: null,
        volume24h: null,
        volume1h: null,
        priceUsd: null,
        fdvUsd: null,
        createdAt: null,
        ageMinutes: null,
        buys24h: null,
        sells24h: null,
        holders: num(data.holder),
        links: {},
        sources: ["birdeye"],
        tags: [],
        raw: {
          top10HolderPercent: data.top10HolderPercent ?? data.security?.top10HolderPercent,
        },
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    pairs,
    status: { source: "birdeye", ok: !error || pairs.length > 0, count: pairs.length, error, fetchedAt },
  };
}

export async function ingestLive(): Promise<{ pairs: NewPair[]; statuses: FeedStatus[] }> {
  const [gt, jup, dex] = await Promise.all([pullGecko(), pullJupiter(), pullDexScreener()]);
  const merged = new Map<string, NewPair>();
  for (const pair of [...gt.pairs, ...jup.pairs, ...dex.pairs]) {
    merged.set(pair.mint, mergePairs(merged.get(pair.mint), pair));
  }
  const bird = await pullBirdeye([...merged.keys()].slice(0, 8));
  for (const pair of bird.pairs) {
    merged.set(pair.mint, mergePairs(merged.get(pair.mint), pair));
  }
  const pairs = [...merged.values()].map((p) => ({ ...p, tags: deriveTags(p) }));
  return { pairs, statuses: [gt.status, jup.status, dex.status, bird.status] };
}

export function ingestMock(): { pairs: NewPair[]; statuses: FeedStatus[] } {
  const fetchedAt = new Date().toISOString();
  const pairs = mockPairs().map((p) => ({ ...p, tags: deriveTags(p) }));
  const statuses: FeedStatus[] = [
    { source: "mock", ok: true, count: pairs.length, fetchedAt },
    { source: "geckoterminal", ok: true, count: 0, error: "mock mode", fetchedAt },
    { source: "jupiter", ok: true, count: 0, error: "mock mode", fetchedAt },
    { source: "dexscreener", ok: true, count: 0, error: "mock mode", fetchedAt },
  ];
  return { pairs, statuses };
}

export function sourceOk(statuses: FeedStatus[], source: FeedSource): boolean {
  return statuses.some((s) => s.source === source && s.ok && s.count > 0);
}
