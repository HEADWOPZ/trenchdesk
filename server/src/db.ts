import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import { nowIso } from "./util.js";
import type {
  AlertRecord,
  Feature,
  FeedSource,
  FeedStatus,
  NewPair,
  RiskBreakdown,
  ScoredPair,
  TokenEvent,
  TokenLinks,
  WatchlistEntry,
} from "./types.js";

let db: DatabaseSync;

export function getDb(): DatabaseSync {
  if (!db) throw new Error("database not opened");
  return db;
}

export function openDb(path = config.dbPath): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS pairs (
      mint TEXT PRIMARY KEY,
      pair_address TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      chain TEXT NOT NULL DEFAULT 'solana',
      dex TEXT NOT NULL DEFAULT '',
      liquidity_usd REAL,
      volume_24h REAL,
      volume_1h REAL,
      price_usd REAL,
      fdv_usd REAL,
      created_at TEXT,
      age_minutes INTEGER,
      buys_24h INTEGER,
      sells_24h INTEGER,
      holders INTEGER,
      links_json TEXT NOT NULL DEFAULT '{}',
      sources_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      raw_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scores (
      mint TEXT PRIMARY KEY,
      score INTEGER NOT NULL,
      band TEXT NOT NULL,
      summary TEXT NOT NULL,
      features_json TEXT NOT NULL,
      scored_at TEXT NOT NULL,
      FOREIGN KEY (mint) REFERENCES pairs(mint)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      mint TEXT NOT NULL,
      pair_address TEXT NOT NULL,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      headline TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      mint TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      mint TEXT NOT NULL,
      kind TEXT NOT NULL,
      score INTEGER NOT NULL,
      dry_run INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feed_status (
      source TEXT PRIMARY KEY,
      ok INTEGER NOT NULL,
      count INTEGER NOT NULL,
      error TEXT,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
  `);
  return db;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToPair(row: Record<string, unknown>): NewPair {
  return {
    mint: String(row.mint),
    pairAddress: String(row.pair_address),
    symbol: String(row.symbol),
    name: String(row.name),
    chain: "solana",
    dex: String(row.dex ?? ""),
    liquidityUsd: row.liquidity_usd == null ? null : Number(row.liquidity_usd),
    volume24h: row.volume_24h == null ? null : Number(row.volume_24h),
    volume1h: row.volume_1h == null ? null : Number(row.volume_1h),
    priceUsd: row.price_usd == null ? null : Number(row.price_usd),
    fdvUsd: row.fdv_usd == null ? null : Number(row.fdv_usd),
    createdAt: row.created_at == null ? null : String(row.created_at),
    ageMinutes: row.age_minutes == null ? null : Number(row.age_minutes),
    buys24h: row.buys_24h == null ? null : Number(row.buys_24h),
    sells24h: row.sells_24h == null ? null : Number(row.sells_24h),
    holders: row.holders == null ? null : Number(row.holders),
    links: parseJson<TokenLinks>(String(row.links_json ?? "{}"), {}),
    sources: parseJson<FeedSource[]>(String(row.sources_json ?? "[]"), []),
    tags: parseJson<string[]>(String(row.tags_json ?? "[]"), []),
    raw: parseJson<Record<string, unknown>>(String(row.raw_json ?? "{}"), {}),
  };
}

export function upsertPair(pair: NewPair): void {
  getDb()
    .prepare(
      `INSERT INTO pairs (
        mint, pair_address, symbol, name, chain, dex, liquidity_usd, volume_24h, volume_1h,
        price_usd, fdv_usd, created_at, age_minutes, buys_24h, sells_24h, holders,
        links_json, sources_json, tags_json, raw_json, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(mint) DO UPDATE SET
        pair_address=excluded.pair_address,
        symbol=excluded.symbol,
        name=excluded.name,
        dex=excluded.dex,
        liquidity_usd=excluded.liquidity_usd,
        volume_24h=excluded.volume_24h,
        volume_1h=excluded.volume_1h,
        price_usd=excluded.price_usd,
        fdv_usd=excluded.fdv_usd,
        created_at=excluded.created_at,
        age_minutes=excluded.age_minutes,
        buys_24h=excluded.buys_24h,
        sells_24h=excluded.sells_24h,
        holders=excluded.holders,
        links_json=excluded.links_json,
        sources_json=excluded.sources_json,
        tags_json=excluded.tags_json,
        raw_json=excluded.raw_json,
        updated_at=excluded.updated_at`,
    )
    .run(
      pair.mint,
      pair.pairAddress,
      pair.symbol,
      pair.name,
      pair.chain,
      pair.dex,
      pair.liquidityUsd,
      pair.volume24h,
      pair.volume1h,
      pair.priceUsd,
      pair.fdvUsd,
      pair.createdAt,
      pair.ageMinutes,
      pair.buys24h,
      pair.sells24h,
      pair.holders,
      JSON.stringify(pair.links),
      JSON.stringify(pair.sources),
      JSON.stringify(pair.tags),
      JSON.stringify(pair.raw),
      nowIso(),
    );
}

export function getPair(mint: string): NewPair | null {
  const row = getDb().prepare("SELECT * FROM pairs WHERE mint = ?").get(mint) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToPair(row) : null;
}

export function upsertScore(breakdown: RiskBreakdown): void {
  getDb()
    .prepare(
      `INSERT INTO scores (mint, score, band, summary, features_json, scored_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(mint) DO UPDATE SET
         score=excluded.score,
         band=excluded.band,
         summary=excluded.summary,
         features_json=excluded.features_json,
         scored_at=excluded.scored_at`,
    )
    .run(
      breakdown.mint,
      breakdown.score,
      breakdown.band,
      breakdown.summary,
      JSON.stringify(breakdown.features),
      breakdown.scoredAt,
    );
}

export function getScore(mint: string): RiskBreakdown | null {
  const row = getDb().prepare("SELECT * FROM scores WHERE mint = ?").get(mint) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    mint: String(row.mint),
    score: Number(row.score),
    band: row.band as RiskBreakdown["band"],
    summary: String(row.summary),
    features: parseJson<Feature[]>(String(row.features_json), []),
    scoredAt: String(row.scored_at),
  };
}

export function insertEvent(event: TokenEvent): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO events (id, mint, pair_address, kind, source, headline, payload_json, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      event.id,
      event.mint,
      event.pairAddress,
      event.kind,
      event.source,
      event.headline,
      JSON.stringify(event.payload),
      event.createdAt,
    );
}

export function listEvents(limit = 80): TokenEvent[] {
  const rows = getDb()
    .prepare("SELECT * FROM events ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    mint: String(row.mint),
    pairAddress: String(row.pair_address),
    kind: row.kind as TokenEvent["kind"],
    source: row.source as TokenEvent["source"],
    headline: String(row.headline),
    payload: parseJson<Record<string, unknown>>(String(row.payload_json), {}),
    createdAt: String(row.created_at),
  }));
}

export function listScoredPairs(limit = 80): ScoredPair[] {
  const rows = getDb()
    .prepare(
      `SELECT p.*, s.score, s.band, s.summary, s.features_json, s.scored_at,
              CASE WHEN w.mint IS NULL THEN 0 ELSE 1 END AS watched
       FROM pairs p
       JOIN scores s ON s.mint = p.mint
       LEFT JOIN watchlist w ON w.mint = p.mint
       ORDER BY COALESCE(p.created_at, p.updated_at) DESC
       LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map((row) => ({
    ...rowToPair(row),
    score: Number(row.score),
    band: row.band as ScoredPair["band"],
    summary: String(row.summary),
    features: parseJson<Feature[]>(String(row.features_json), []),
    scoredAt: String(row.scored_at),
    watched: Number(row.watched) === 1,
  }));
}

export function getScoredPair(mint: string): ScoredPair | null {
  const pair = getPair(mint);
  const score = getScore(mint);
  if (!pair || !score) return null;
  const watched = Boolean(
    getDb().prepare("SELECT 1 FROM watchlist WHERE mint = ?").get(mint),
  );
  return { ...pair, ...score, watched };
}

export function addWatch(entry: WatchlistEntry): void {
  getDb()
    .prepare(
      `INSERT INTO watchlist (mint, symbol, name, note, added_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(mint) DO UPDATE SET symbol=excluded.symbol, name=excluded.name, note=excluded.note`,
    )
    .run(entry.mint, entry.symbol, entry.name, entry.note, entry.addedAt);
}

export function removeWatch(mint: string): boolean {
  const res = getDb().prepare("DELETE FROM watchlist WHERE mint = ?").run(mint);
  return Number(res.changes) > 0;
}

export function listWatch(): WatchlistEntry[] {
  const rows = getDb()
    .prepare("SELECT * FROM watchlist ORDER BY added_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    mint: String(row.mint),
    symbol: String(row.symbol),
    name: String(row.name),
    note: String(row.note),
    addedAt: String(row.added_at),
  }));
}

export function isWatched(mint: string): boolean {
  return Boolean(getDb().prepare("SELECT 1 FROM watchlist WHERE mint = ?").get(mint));
}

export function insertAlert(alert: AlertRecord): void {
  getDb()
    .prepare(
      `INSERT INTO alerts (id, mint, kind, score, dry_run, message, created_at, status)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      alert.id,
      alert.mint,
      alert.kind,
      alert.score,
      alert.dryRun ? 1 : 0,
      alert.message,
      alert.createdAt,
      alert.status,
    );
}

export function listAlerts(limit = 40): AlertRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    mint: String(row.mint),
    kind: row.kind as AlertRecord["kind"],
    score: Number(row.score),
    dryRun: Number(row.dry_run) === 1,
    message: String(row.message),
    createdAt: String(row.created_at),
    status: String(row.status),
  }));
}

export function alertAlreadySent(mint: string, kind: string, sinceIso: string): boolean {
  return Boolean(
    getDb()
      .prepare("SELECT 1 FROM alerts WHERE mint = ? AND kind = ? AND created_at >= ? LIMIT 1")
      .get(mint, kind, sinceIso),
  );
}

export function setFeedStatus(status: FeedStatus): void {
  getDb()
    .prepare(
      `INSERT INTO feed_status (source, ok, count, error, fetched_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(source) DO UPDATE SET ok=excluded.ok, count=excluded.count, error=excluded.error, fetched_at=excluded.fetched_at`,
    )
    .run(status.source, status.ok ? 1 : 0, status.count, status.error ?? null, status.fetchedAt);
}

export function listFeedStatus(): FeedStatus[] {
  const rows = getDb().prepare("SELECT * FROM feed_status").all() as Record<string, unknown>[];
  return rows.map((row) => ({
    source: row.source as FeedSource,
    ok: Number(row.ok) === 1,
    count: Number(row.count),
    error: row.error == null ? undefined : String(row.error),
    fetchedAt: String(row.fetched_at),
  }));
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    )
    .run(key, value);
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function pruneOld(maxPairs = 400, maxEvents = 800): void {
  const database = getDb();
  const keepEvents = database
    .prepare("SELECT id FROM events ORDER BY created_at DESC LIMIT ?")
    .all(maxEvents) as Array<{ id: string }>;
  if (keepEvents.length === maxEvents) {
    const placeholders = keepEvents.map(() => "?").join(",");
    database.prepare(`DELETE FROM events WHERE id NOT IN (${placeholders})`).run(...keepEvents.map((r) => r.id));
  }
  const keepPairs = database
    .prepare("SELECT mint FROM pairs ORDER BY updated_at DESC LIMIT ?")
    .all(maxPairs) as Array<{ mint: string }>;
  if (keepPairs.length === maxPairs) {
    const placeholders = keepPairs.map(() => "?").join(",");
    const args = keepPairs.map((r) => r.mint);
    database
      .prepare(
        `DELETE FROM scores WHERE mint NOT IN (${placeholders}) AND mint NOT IN (SELECT mint FROM watchlist)`,
      )
      .run(...args);
    database
      .prepare(
        `DELETE FROM pairs WHERE mint NOT IN (${placeholders}) AND mint NOT IN (SELECT mint FROM watchlist)`,
      )
      .run(...args);
  }
}
