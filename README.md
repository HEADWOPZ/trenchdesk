# TrenchDesk

Multi-source Solana meme/token discovery desk for [Kevin Lance Murray](https://github.com/HEADWOPZ). One dark radar instead of tab-hell across Axiom / GMGN / DexScreener-class feeds.

TrenchDesk **ingests public feeds**, **normalizes** them into `NewPair` / `TokenEvent`, **scores 0–100** with a transparent rule engine, **persists** recent inventory in SQLite, and exposes a **desk UI**, **watchlist CSV**, **Telegram dry-run/live alerts**, and a **small HTTP surface** other agents (later: PhantomBridge, read-only risk context) can call.

v1 does **not** execute, copy-trade, custody wallets, or promise alpha.

## Architecture

```
public feeds                trenchdesk
─────────────               ──────────
GeckoTerminal new/trend ─┐
Jupiter recent + audit ──┼─► ingest/normalize ─► SQLite
DexScreener boosts ──────┤         │
Birdeye (optional key) ──┘         ▼
                            rule engine (0–100)
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
                 Desk UI      Telegram       /api + /v1
              watchlist CSV   dry-run/live   PhantomBridge later
```

| Layer | What it does |
| --- | --- |
| **Ingest** | Polls 3 keyless sources every 30s. Optional Birdeye. `FEED_MODE=mock` or automatic mock fallback if every live source fails. |
| **Schema** | `NewPair` (mint, pair, liq, vol, age, links, tags) and `TokenEvent` (`new_pair`, `social_spike`, `score_update`, `watchlist_hit`). |
| **Rules** | Six features, each with points, max, evidence, and `available` (so the UI/API never invents missing data). |
| **Desk** | Vite + React. Live table, score badges, expandable “why this score”, watchlist, CSV, offline agent clerk. |
| **Alerts** | Formats and (if configured) pushes high-score / watchlist hits. Unset credentials → dry-run log + `/api/alerts`. |
| **Agent API** | `/api/*` for the desk; `/v1/pairs` and `/v1/pairs/:mint/risk` as the stable read model for other agents. |

Stack: Node 22 (`node:sqlite`), Fastify, TypeScript, Vite React. No paid keys required.

## Feeds (no paid keys)

| Source | Endpoint | Role |
| --- | --- | --- |
| **GeckoTerminal** | `/api/v2/networks/solana/new_pools`, `trending_pools` | New-pair radar + trending |
| **Jupiter** | `https://lite-api.jup.ag/tokens/v2/recent` | Recent mints, holders, mint/freeze audit, residual % |
| **DexScreener** | `/token-boosts/latest/v1` + `/tokens/v1/solana/{mints}` | Social-spike tags + pair enrichment |
| **Birdeye** | `token_overview` when `BIRDEYE_API_KEY` is set | Optional holder concentration |

DexScreener has **no** public “all new Solana pairs” route; we use GeckoTerminal + Jupiter for discovery and DexScreener for boosts/enrichment.

## Risk score (0–100)

Higher = more concerning. Band: **CLEAR-ISH** `<40` · **WATCH** `40–69` · **FLAGGED** `≥70`.

| Feature | Max | Uses |
| --- | --- | --- |
| Pair age | 20 | Minutes since `createdAt` |
| Liquidity | 20 | Reserve USD |
| Honeypot-ish | 20 | Mint/freeze still on, buys-without-sells, extreme vol/liq |
| Holder concentration | 15 | Holder count or Birdeye top-10 % |
| Deployer age proxy | 15 | Fresh wallet hours (if present) or remaining dev % / launchpad |
| Social + LP hints | 10 | Missing links, dust reserve, lock unknown vs. reported |

Every feature ships `evidence` text. The desk “why flagged?” panel and `/v1/pairs/:mint/risk` render **the same stored breakdown**. LP lock is a **hint** only — v1 public feeds do not prove a lock.

## Local run

Requires Node **22.5+** (this repo uses `node:sqlite`).

```bash
git clone https://github.com/HEADWOPZ/trenchdesk.git
cd trenchdesk
cp .env.example .env
npm install
npm test
npm run dev
```

- Desk: [http://127.0.0.1:5173](http://127.0.0.1:5173) (Vite proxies `/api` → API)
- API: [http://127.0.0.1:8787](http://127.0.0.1:8787)

Production-style (API also serves the built desk):

```bash
npm run build
npm start
# open http://127.0.0.1:8787
```

Offline / CI without egress:

```bash
FEED_MODE=mock npm run dev
```

Live mode is the default. If GeckoTerminal, Jupiter, and DexScreener all fail, the poller loads the mock fixture and the desk footer shows `MOCK / FALLBACK`.

### Useful scripts

| Script | |
| --- | --- |
| `npm run dev` | API watch + Vite desk |
| `npm run dev:api` / `dev:web` | Split processes |
| `npm start` | API only (`tsx server/src/index.ts`) |
| `npm test` | Scoring, Telegram dry-run, merge/CSV |
| `npm run typecheck` | `tsc --noEmit` for server + web |

## Environment

See [`.env.example`](.env.example). All variables are optional.

| Variable | Default | |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | API bind |
| `TRENCHDESK_DB` | `./data/trenchdesk.sqlite` | SQLite file |
| `FEED_MODE` | `live` | `live` or `mock` |
| `POLL_INTERVAL_MS` | `30000` | Floor 10s |
| `BIRDEYE_API_KEY` | unset | Optional holder/security enrich |
| `TELEGRAM_BOT_TOKEN` | unset | Bot token |
| `TELEGRAM_CHAT_ID` | unset | Destination chat |
| `ALERT_MIN_SCORE` | `70` | High-score threshold (watchlist always alerts) |
| `OPENAI_API_KEY` | unset | Optional paraphrase of stored features |
| `OPENAI_MODEL` | `gpt-4o-mini` | |

Telegram: **both** token and chat id required for live send. Otherwise alerts are stored with `dryRun: true` (`GET /api/alerts`). The formatter and threshold logic are unit-tested without a bot.

## HTTP / agent surface

Desk:

- `GET /api/health`
- `GET /api/desk` — pairs, events, watchlist, feed status
- `GET /api/pairs` · `GET /api/pairs/:mint` — scored inventory + feature breakdown
- `GET|POST /api/watchlist` · `DELETE /api/watchlist/:mint`
- `GET /api/watchlist.csv`
- `POST /api/chat` `{ message, mint? }` — rule-based explainer (LLM optional)
- `GET /api/alerts` · `POST /api/poll`

Other agents / PhantomBridge later:

```http
GET /v1/pairs
GET /v1/pairs/:mint/risk
```

`/v1/pairs/:mint/risk` returns `score`, `band`, `summary`, `features[]` (`id`, `label`, `points`, `maxPoints`, `evidence`, `available`).

## Security / disclaimer

- **Not financial advice.** Heuristics over incomplete public data.
- **No execution in v1.** No swap, no copy-trade, no custodial wallet, no private keys.
- Scores are **not** rug guarantees. Missing lock proofs, hidden authorities, and wash volume will fool a ruleset.
- Treat Telegram tokens, Birdeye keys, and OpenAI keys as secrets. Do not commit `.env`.
- Rate-limit public APIs; this desk polls slowly on purpose.

## Not in v1

Copy-trade execution, paid signal-group clone, guaranteed alpha, custodial wallets.

## License

[MIT](LICENSE) © 2026 Kevin Lance Murray
