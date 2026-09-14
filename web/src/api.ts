import type { ChatReply, DeskSnapshot, ScoredPair, WatchItem } from "./types";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${path}: ${body.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  desk: () => json<DeskSnapshot>("/api/desk"),
  pair: (mint: string) => json<{ pair: ScoredPair }>(`/api/pairs/${mint}`),
  addWatch: (mint: string) =>
    json<{ watchlist: WatchItem[] }>("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ mint }),
    }),
  removeWatch: (mint: string) =>
    json<{ watchlist: WatchItem[] }>(`/api/watchlist/${mint}`, { method: "DELETE" }),
  chat: (message: string, mint?: string) =>
    json<ChatReply>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message, mint }),
    }),
  poll: () => json<unknown>("/api/poll", { method: "POST" }),
};

export function watchlistCsvUrl(): string {
  return "/api/watchlist.csv";
}
