# mirror

**Pay Netflix. Own Netflix.** Each month, a percentage of what you pay for a
subscription buys the stock token of the company behind it, on Robinhood Chain.

- You list your subscriptions and type the price yourself. The site does not look anything up.
- You pick a mirror rate (5 %, 10 %, 25 % or your own).
- Each month the dashboard proposes "This month's mirror". You approve it and sign; your USDG buys the tokens.
- Nothing is taken automatically, nothing is bought without a wallet signature, and a purchase is shown as
  done only after the server has read its confirmed transaction on chain.

## Run it

```bash
npm install
npm run dev          # http://localhost:3637
```

Node 22.13+ (uses `node:sqlite`). No environment variable is needed in development; see `.env.example`
for production (`SESSION_SECRET`, a persistent `MIRROR_DATA_DIR`).

| Command | What it does |
| --- | --- |
| `npm test` | 23 unit tests: mirror math, rounding, monthly idempotency, wallet isolation, quote and receipt checks |
| `npm run lint` / `npm run build` | ESLint / production build |
| `npm run check:api` | 17 HTTP checks against a running server (anonymous and cross-wallet access refused, nonce replay refused, …) |
| `npm run check:tokens` | Re-reads all tokens on chain, compares with Robinhood's official list, gets a live quote for each |

## Where things are

| Path | Role |
| --- | --- |
| `src/app/tokens.css` | Every design token: colours, type, radii, shadows |
| `src/config/network.ts` | Chain, token addresses, swap route. Nothing guessed; sources in the header comment |
| `src/config/catalog.ts` | Subscription → company → ticker |
| `src/config/mirror-policy.ts` | Rate presets, limits, smallest order, max slippage |
| `src/core/mirror.ts` | The calculation. `amount = cents × bps` in USDG base units: exact, no rounding |
| `src/core/swap.ts` | Quote validation before signing, receipt check after |
| `src/core/ledger.ts` | SQLite: plans, purchases, idempotency per (wallet, month, token) |
| `src/server/chain.ts` | Read-only chain access, quote fetch, price fetch. The server holds no key |
| `src/components/home/SplitDisc.tsx` | The hero disc, rendered live with three.js |

## The purchase route

Verified on 2026-10-01 (`research/` keeps the raw evidence):

- **Tokens** — NFLX, AMZN, GOOGL, AAPL, MSFT, ADBE, RBLX, ZM. Addresses from
  `GET https://api.robinhood.com/rhj/assets`, re-read on chain (name, symbol, decimals, `uiMultiplier`).
- **Route** — LI.FI (`li.quest/v1/quote`), one of the venues named in Robinhood's
  "Building with Stock Tokens" docs, restricted to the `kyberswap` venue, which settles in the same
  transaction. LI.FI's intent venue (`lifiIntentsDex`) is excluded: it takes the USDG and delivers later,
  so a purchase could not be confirmed from its own transaction.
- **Safety** — the server computes the amount, fetches the quote and refuses it unless it spends exactly
  that amount of USDG from the user's wallet, to the user's wallet, through the LI.FI Diamond, with no ETH
  attached and at most 1 % slippage. The approval is for the exact amount.
- **Prices** — `GET https://api.robinhood.com/rhj/prices/{symbol}`, shown with their timestamp. When the
  source does not answer, only token quantities are shown.

## Rehearsing a purchase on a fork

No real transaction is needed to try the whole flow.

```bash
cd fork && npm install && npm run serve            # fork on :8637, funds a test wallet with USDG
node scripts/fork-buy.mjs                          # quote → approve exact → swap → verify, all 8 tokens
```

For the browser journey, start the app against the fork, then drive it:

```bash
RPC_URL=http://127.0.0.1:8637 MIRROR_DATA_DIR=data-fork npx next dev -p 3637
node scripts/browser-flow.mjs                      # screenshots land in ./shots
```

The public RPC only keeps recent state, so a fork lives a few minutes: serve, rehearse, stop.
`scripts/dev-wallet.js` is a test wallet injected by that script only; the site never loads it.

## Not done / not verified

- No purchase was made on the real chain, and no real browser wallet extension was used.
- Only the `kyberswap` venue is allowed. If it has no route for a token at some moment, that line cannot
  be bought until it does.
- LI.FI rate-limits keyless quotes per IP (hit during development after about a hundred quotes: "retry in
  1 hour"). Set `LIFI_API_KEY` on the server for real use; the app reports the limit instead of failing silently.
- One swap per company per month: several companies mean several signatures.
- Eligibility by country is stated, not enforced.
- `SESSION_SECRET` and a persistent data directory must be set before any deployment.
