import type { RiskBand } from "./types";

export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n === 0) return "$0";
  if (n < 1) return `$${n.toPrecision(3)}`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}m`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function age(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

export function shortMint(mint: string): string {
  return mint.length <= 12 ? mint : `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export function bandLabel(band: RiskBand): string {
  if (band === "flagged") return "FLAGGED";
  if (band === "watch") return "WATCH";
  return "CLEAR-ISH";
}

export function clock(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", { hour12: false });
}
