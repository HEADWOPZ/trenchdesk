export type Feature = {
  id: string;
  label: string;
  points: number;
  maxPoints: number;
  evidence: string;
  available: boolean;
};

export type RiskBand = "clear" | "watch" | "flagged";

export type ScoredPair = {
  mint: string;
  pairAddress: string;
  symbol: string;
  name: string;
  dex: string;
  liquidityUsd: number | null;
  volume24h: number | null;
  volume1h: number | null;
  priceUsd: number | null;
  fdvUsd: number | null;
  createdAt: string | null;
  ageMinutes: number | null;
  holders: number | null;
  links: {
    dexscreener?: string;
    geckoterminal?: string;
    twitter?: string;
    telegram?: string;
    website?: string;
  };
  sources: string[];
  tags: string[];
  score: number;
  band: RiskBand;
  summary: string;
  features: Feature[];
  scoredAt: string;
  watched: boolean;
};

export type TokenEvent = {
  id: string;
  mint: string;
  kind: string;
  source: string;
  headline: string;
  createdAt: string;
};

export type WatchItem = {
  mint: string;
  symbol: string;
  name: string;
  note: string;
  addedAt: string;
};

export type FeedStatus = {
  source: string;
  ok: boolean;
  count: number;
  error?: string;
  fetchedAt: string;
};

export type DeskSnapshot = {
  pairs: ScoredPair[];
  events: TokenEvent[];
  watchlist: WatchItem[];
  feeds: FeedStatus[];
  mode: "live" | "mock";
  lastPollAt: string | null;
  disclaimer: string;
};

export type ChatReply = {
  reply: string;
  mint?: string;
  usedLlm: boolean;
  offline: boolean;
};
