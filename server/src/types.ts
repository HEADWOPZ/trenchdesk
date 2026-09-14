export type FeedSource =
  | "geckoterminal"
  | "jupiter"
  | "dexscreener"
  | "birdeye"
  | "mock";

export type EventKind = "new_pair" | "social_spike" | "score_update" | "watchlist_hit";

export type TokenLinks = {
  dexscreener?: string;
  geckoterminal?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
};

export type NewPair = {
  mint: string;
  pairAddress: string;
  symbol: string;
  name: string;
  chain: "solana";
  dex: string;
  liquidityUsd: number | null;
  volume24h: number | null;
  volume1h: number | null;
  priceUsd: number | null;
  fdvUsd: number | null;
  createdAt: string | null;
  ageMinutes: number | null;
  buys24h: number | null;
  sells24h: number | null;
  holders: number | null;
  links: TokenLinks;
  sources: FeedSource[];
  tags: string[];
  raw: Record<string, unknown>;
};

export type TokenEvent = {
  id: string;
  mint: string;
  pairAddress: string;
  kind: EventKind;
  source: FeedSource;
  headline: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type Feature = {
  id: string;
  label: string;
  points: number;
  maxPoints: number;
  evidence: string;
  available: boolean;
};

export type RiskBreakdown = {
  mint: string;
  score: number;
  band: RiskBand;
  summary: string;
  features: Feature[];
  scoredAt: string;
};

export type RiskBand = "clear" | "watch" | "flagged";

export type ScoredPair = NewPair & {
  score: number;
  band: RiskBand;
  summary: string;
  features: Feature[];
  scoredAt: string;
  watched: boolean;
};

export type WatchlistEntry = {
  mint: string;
  symbol: string;
  name: string;
  note: string;
  addedAt: string;
};

export type AlertRecord = {
  id: string;
  mint: string;
  kind: "high_score" | "watchlist";
  score: number;
  dryRun: boolean;
  message: string;
  createdAt: string;
  status: string;
};

export type FeedStatus = {
  source: FeedSource;
  ok: boolean;
  count: number;
  error?: string;
  fetchedAt: string;
};

export type DeskSnapshot = {
  pairs: ScoredPair[];
  events: TokenEvent[];
  watchlist: WatchlistEntry[];
  feeds: FeedStatus[];
  mode: "live" | "mock";
  lastPollAt: string | null;
  disclaimer: string;
};
