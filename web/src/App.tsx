import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, watchlistCsvUrl } from "./api";
import { age, bandLabel, clock, shortMint, usd } from "./format";
import type { ChatReply, DeskSnapshot, ScoredPair } from "./types";

type ChatLine = { role: "user" | "desk"; text: string; meta?: string };

export function App() {
  const [desk, setDesk] = useState<DeskSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [bandFilter, setBandFilter] = useState<"all" | "flagged" | "watch" | "clear">("all");
  const [chat, setChat] = useState<ChatLine[]>([
    {
      role: "desk",
      text: "Offline clerk ready. Ask “why is this flagged?” after selecting a row — answers are grounded in stored features, no LLM required.",
    },
  ]);
  const [draft, setDraft] = useState("why is this flagged?");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await api.desk();
      setDesk(next);
      setError(null);
      setSelected((cur) => cur ?? next.pairs[0]?.mint ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 12_000);
    return () => clearInterval(id);
  }, [refresh]);

  const pair = desk?.pairs.find((p) => p.mint === selected) ?? null;
  const rows = useMemo(() => {
    if (!desk) return [];
    return desk.pairs.filter((p) => {
      if (bandFilter !== "all" && p.band !== bandFilter) return false;
      if (!filter.trim()) return true;
      const q = filter.toLowerCase();
      return (
        p.symbol.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.mint.toLowerCase().includes(q) ||
        p.tags.some((t) => t.includes(q))
      );
    });
  }, [desk, filter, bandFilter]);

  async function toggleWatch(mint: string, watched: boolean) {
    if (watched) await api.removeWatch(mint);
    else await api.addWatch(mint);
    await refresh();
  }

  async function onChat(e: FormEvent) {
    e.preventDefault();
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    setChat((c) => [...c, { role: "user", text: message }]);
    setBusy(true);
    try {
      const res: ChatReply = await api.chat(message, selected ?? undefined);
      setChat((c) => [
        ...c,
        {
          role: "desk",
          text: res.reply,
          meta: res.usedLlm ? "llm paraphrase" : "rule engine",
        },
      ]);
    } catch (err) {
      setChat((c) => [
        ...c,
        { role: "desk", text: err instanceof Error ? err.message : String(err) },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="desk">
      <header className="topbar">
        <div className="brand">
          <span className="mark">TD</span>
          <div>
            <div className="title">TRENCHDESK</div>
            <div className="sub">KLM · SOLANA RADAR · READ-ONLY</div>
          </div>
        </div>
        <div className="status-cluster">
          <span className={`pill ${desk?.mode === "live" ? "live" : "mock"}`}>
            <i />
            {desk?.mode === "live" ? "LIVE FEEDS" : "MOCK / FALLBACK"}
          </span>
          <span className="meta">POLL {clock(desk?.lastPollAt)}</span>
          <span className="meta">{desk?.pairs.length ?? 0} PAIRS</span>
          <button type="button" className="ghost" onClick={() => void api.poll().then(refresh)}>
            SCAN
          </button>
        </div>
      </header>

      {error && <div className="banner">{error} — is the API on :8787?</div>}

      <main className="grid">
        <section className="radar">
          <div className="toolbar">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter symbol / mint / tag"
            />
            <div className="seg">
              {(["all", "flagged", "watch", "clear"] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  className={bandFilter === b ? "on" : ""}
                  onClick={() => setBandFilter(b)}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>age</th>
                  <th>pair</th>
                  <th>mint</th>
                  <th>liq</th>
                  <th>vol 24h</th>
                  <th>score</th>
                  <th>tags</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.mint}
                    className={p.mint === selected ? "sel" : ""}
                    onClick={() => setSelected(p.mint)}
                  >
                    <td className="num">{age(p.ageMinutes)}</td>
                    <td>
                      <div className="sym">${p.symbol}</div>
                      <div className="muted">{p.dex}</div>
                    </td>
                    <td className="mono">{shortMint(p.mint)}</td>
                    <td className="num">{usd(p.liquidityUsd)}</td>
                    <td className="num">{usd(p.volume24h)}</td>
                    <td>
                      <ScoreBadge pair={p} />
                    </td>
                    <td>
                      <div className="tags">
                        {p.tags.slice(0, 3).map((t) => (
                          <span key={t} className={`tag tag-${t}`}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`star ${p.watched ? "on" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleWatch(p.mint, p.watched);
                        }}
                      >
                        {p.watched ? "★" : "☆"}
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={8} className="empty">
                      No pairs yet — waiting on the first poll.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {pair && <WhyFlagged pair={pair} />}
        </section>

        <aside className="rail">
          <WatchPanel
            desk={desk}
            selected={selected}
            onSelect={setSelected}
            onToggle={toggleWatch}
          />
          <ChatPanel
            lines={chat}
            draft={draft}
            busy={busy}
            onDraft={setDraft}
            onSubmit={onChat}
          />
        </aside>
      </main>

      <footer className="ticker">
        <div className="feeds">
          {(desk?.feeds ?? []).map((f) => (
            <span key={f.source} className={f.ok ? "ok" : "bad"}>
              {f.source} {f.ok ? f.count : "×"}
            </span>
          ))}
        </div>
        <p>{desk?.disclaimer}</p>
      </footer>
    </div>
  );
}

function ScoreBadge({ pair }: { pair: ScoredPair }) {
  return (
    <span className={`badge ${pair.band}`}>
      <b>{pair.score}</b>
      <em>{bandLabel(pair.band)}</em>
    </span>
  );
}

function WhyFlagged({ pair }: { pair: ScoredPair }) {
  return (
    <div className="why">
      <div className="why-head">
        <div>
          <div className="kicker">WHY {pair.band === "flagged" ? "FLAGGED" : "THIS SCORE"}</div>
          <h2>
            ${pair.symbol} <span className="mono">{pair.mint}</span>
          </h2>
          <p>{pair.summary}</p>
        </div>
        <div className="links">
          {pair.links.dexscreener && (
            <a href={pair.links.dexscreener} target="_blank" rel="noreferrer">
              DexScreener
            </a>
          )}
          {pair.links.geckoterminal && (
            <a href={pair.links.geckoterminal} target="_blank" rel="noreferrer">
              GeckoTerminal
            </a>
          )}
          {pair.links.twitter && (
            <a href={pair.links.twitter} target="_blank" rel="noreferrer">
              X
            </a>
          )}
        </div>
      </div>
      <div className="features">
        {pair.features.map((f) => (
          <div key={f.id} className="feat">
            <div className="feat-top">
              <span>
                {f.label}
                {!f.available && <i> partial</i>}
              </span>
              <span>
                {f.points}/{f.maxPoints}
              </span>
            </div>
            <div className="bar">
              <span style={{ width: `${(100 * f.points) / f.maxPoints}%` }} />
            </div>
            <p>{f.evidence}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function WatchPanel({
  desk,
  selected,
  onSelect,
  onToggle,
}: {
  desk: DeskSnapshot | null;
  selected: string | null;
  onSelect: (mint: string) => void;
  onToggle: (mint: string, watched: boolean) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>WATCHLIST</h3>
        <a className="ghost" href={watchlistCsvUrl()}>
          CSV
        </a>
      </div>
      <ul className="watch">
        {(desk?.watchlist ?? []).map((w) => {
          const pair = desk?.pairs.find((p) => p.mint === w.mint);
          return (
            <li key={w.mint} className={w.mint === selected ? "sel" : ""}>
              <button type="button" className="plain" onClick={() => onSelect(w.mint)}>
                <strong>${w.symbol}</strong>
                <span>{pair ? `${pair.score}/100` : shortMint(w.mint)}</span>
              </button>
              <button type="button" className="ghost" onClick={() => onToggle(w.mint, true)}>
                ✕
              </button>
            </li>
          );
        })}
        {!desk?.watchlist.length && <li className="empty">Star a pair to pin it. Export stays empty until then.</li>}
      </ul>
    </section>
  );
}

function ChatPanel({
  lines,
  draft,
  busy,
  onDraft,
  onSubmit,
}: {
  lines: ChatLine[];
  draft: string;
  busy: boolean;
  onDraft: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <section className="panel chat">
      <div className="panel-head">
        <h3>AGENT</h3>
        <span className="meta">FEATURE-GROUNDED</span>
      </div>
      <div className="log">
        {lines.map((line, i) => (
          <div key={i} className={`bubble ${line.role}`}>
            <pre>{line.text}</pre>
            {line.meta && <small>{line.meta}</small>}
          </div>
        ))}
      </div>
      <form onSubmit={onSubmit}>
        <input
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder="why is this flagged?"
          disabled={busy}
        />
        <button type="submit" disabled={busy}>
          ASK
        </button>
      </form>
    </section>
  );
}
