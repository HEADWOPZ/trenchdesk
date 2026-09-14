import { createHash, randomUUID } from "node:crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(prefix = "evt"): string {
  return `${prefix}_${randomUUID()}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function ageMinutes(createdAt: string | null | undefined, now = Date.now()): number | null {
  if (!createdAt) return null;
  const ts = Date.parse(createdAt);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.round((now - ts) / 60_000));
}

export function truncate(value: string, n = 80): string {
  return value.length > n ? `${value.slice(0, n - 1)}…` : value;
}

export function stableId(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function mergeLinks(
  a: Record<string, string | undefined>,
  b: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && !out[k]) out[k] = v;
  }
  return out;
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const { timeoutMs = 12_000, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/json",
      "user-agent": "TrenchDesk/0.1 (+https://github.com/HEADWOPZ/trenchdesk)",
      ...headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${url} ${truncate(body, 160)}`);
  }
  return (await res.json()) as T;
}

export const WSOL = "So11111111111111111111111111111111111111112";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export function isQuoteMint(mint: string): boolean {
  return [WSOL, USDC, USDT].includes(mint);
}

export function looksLikeSolanaMint(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

export function extractMint(text: string): string | null {
  const match = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  return match?.[0] ?? null;
}
