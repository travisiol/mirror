import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { CATALOG } from "../src/config/catalog.ts";
import { MIN_ORDER_MICRO, SIGNING_LOCK_MS, DROPPED_AFTER_MS } from "../src/config/mirror-policy.ts";
import { LIFI, STOCK_TOKENS, USDG } from "../src/config/network.ts";
import { Ledger, LedgerError } from "../src/core/ledger.ts";
import type { ChainAdapter } from "../src/core/ledger.ts";
import {
  computeMirror,
  formatCents,
  formatRate,
  formatTokens,
  formatUsd,
  formatUsdgExact,
  mirrorAmountMicro,
  monthKey,
  monthLabel,
  parsePriceCents,
  parseRateBps,
  toShareUnits,
  validatePlan,
} from "../src/core/mirror.ts";
import { netTransfer, quoteUrl, settle, validateQuote } from "../src/core/swap.ts";

const ALICE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const HASH = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

function make() {
  const clock = { now: NOW };
  const ledger = new Ledger(new DatabaseSync(":memory:"), () => clock.now);
  return { ledger, clock };
}

const plan = { rateBps: 1000, subscriptions: [{ serviceId: "netflix", priceCents: 1549 }] };

const chain = (outcome: Awaited<ReturnType<ChainAdapter["inspect"]>>): ChainAdapter & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return {
    calls,
    async inspect(txHash, expected) {
      calls.push({ txHash, expected });
      return outcome;
    },
  };
};
const confirmed = { state: "confirmed" as const, tokenRaw: 22630562450526580n, usdgSpent: 1549000n, block: 77_000_000, uiMultiplier: 10n ** 18n };

const expectLedgerError = (status: number) => (error: unknown) => error instanceof LedgerError && error.status === status;

// ───────────────────────────── the calculation

test("the mockup's numbers: $15.49 at 10% is exactly 1.549 USDG, shown as $1.55", () => {
  const amount = mirrorAmountMicro(1549, 1000);
  assert.equal(amount, 1_549_000n);
  assert.equal(formatUsd(amount), "$1.55");
  assert.equal(formatUsdgExact(amount), "1.549");
});

test("amounts are exact for every preset and for fractional custom rates", () => {
  assert.equal(mirrorAmountMicro(1549, 500), 774_500n); // $0.7745
  assert.equal(mirrorAmountMicro(1549, 2500), 3_872_500n); // $3.8725
  assert.equal(mirrorAmountMicro(999, 1250), 1_248_750n); // 12.5% of $9.99
  assert.equal(mirrorAmountMicro(1, 1), 1n);
  assert.equal(mirrorAmountMicro(100_000, 10_000), 1_000_000_000n); // 100% of $1,000
  assert.throws(() => mirrorAmountMicro(15.49, 1000), RangeError);
  assert.throws(() => mirrorAmountMicro(-1, 1000), RangeError);
});

test("display rounding is half-up to the cent and never changes the amount bought", () => {
  assert.equal(formatUsd(774_500n), "$0.77");
  assert.equal(formatUsd(775_000n), "$0.78");
  assert.equal(formatUsd(3_872_500n), "$3.87");
  assert.equal(formatUsd(4_999n), "$0.00");
  assert.equal(formatUsd(5_000n), "$0.01");
  assert.equal(formatUsd(1_234_567_890_000n), "$1,234,567.89");
  assert.equal(formatUsdgExact(774_500n), "0.7745");
  assert.equal(formatUsdgExact(2_000_000n), "2.00");
  assert.equal(formatCents(1549), "$15.49");
  assert.equal(formatCents(100_000), "$1,000.00");
  assert.equal(formatRate(1000), "10%");
  assert.equal(formatRate(1250), "12.5%");
});

test("subscriptions of the same company are summed into one line, in exact units", () => {
  const { lines, totalMicro } = computeMirror({
    rateBps: 1000,
    subscriptions: [
      { serviceId: "apple-music", priceCents: 1099 },
      { serviceId: "netflix", priceCents: 1549 },
      { serviceId: "icloud", priceCents: 299 },
      { serviceId: "not-a-service", priceCents: 5000 },
    ],
  });
  assert.deepEqual(lines.map((l) => l.ticker), ["NFLX", "AAPL"]);
  const apple = lines[1];
  assert.equal(apple.amountMicro, 1_099_000n + 299_000n);
  assert.deepEqual(apple.parts.map((p) => p.serviceId), ["icloud", "apple-music"]);
  assert.equal(totalMicro, 1_549_000n + 1_398_000n);
});

test("a line below the smallest order is flagged and left out of the total", () => {
  const { lines, totalMicro } = computeMirror({
    rateBps: 100,
    subscriptions: [
      { serviceId: "icloud", priceCents: 99 },
      { serviceId: "adobe-creative-cloud", priceCents: 5999 },
    ],
  });
  const apple = lines.find((l) => l.ticker === "AAPL")!;
  assert.equal(apple.amountMicro, 9_900n);
  assert.ok(apple.amountMicro < MIN_ORDER_MICRO);
  assert.equal(apple.belowMinimum, true);
  assert.equal(totalMicro, 599_900n);
});

test("parsing what people type", () => {
  assert.equal(parsePriceCents("15.49"), 1549);
  assert.equal(parsePriceCents("$15,49"), 1549);
  assert.equal(parsePriceCents("15"), 1500);
  assert.equal(parsePriceCents("15.4"), 1540);
  assert.equal(parsePriceCents("15.499"), null);
  assert.equal(parsePriceCents("-3"), null);
  assert.equal(parsePriceCents("abc"), null);
  assert.equal(parseRateBps("10"), 1000);
  assert.equal(parseRateBps("12.5%"), 1250);
  assert.equal(parseRateBps("0,25"), 25);
  assert.equal(parseRateBps("12.555"), null);
});

test("months are UTC and labelled in English", () => {
  assert.equal(monthKey(Date.parse("2026-10-31T23:59:59Z")), "2026-10");
  assert.equal(monthKey(Date.parse("2026-11-01T00:00:00Z")), "2026-11");
  assert.equal(monthLabel("2026-10"), "October 2026");
});

test("token quantities are truncated, never rounded up, and ERC-8056 scaling is applied on request", () => {
  assert.equal(formatTokens(22630562450526580n, 18), "0.02263");
  assert.equal(formatTokens(22639999999999999n, 18), "0.022639");
  assert.equal(formatTokens(1_500000000000000000n, 18), "1.5");
  assert.equal(formatTokens(999n, 18), "<0.000001");
  assert.equal(formatTokens(0n, 18), "0");
  // AAPL's multiplier on 2026-10-01: one token stands for 1.000566… shares.
  assert.equal(toShareUnits(10n ** 18n, 1000566080061092436n), 1000566080061092436n);
  assert.equal(toShareUnits(4688738070248123n, 2n * 10n ** 18n), 9377476140496246n); // after a 2-for-1 split
});

test("every catalogue service maps to a configured, official token", () => {
  for (const service of CATALOG) assert.ok(STOCK_TOKENS[service.ticker], `${service.name} → ${service.ticker}`);
  assert.equal(new Set(CATALOG.map((s) => s.id)).size, CATALOG.length);
});

// ───────────────────────────── server-side validation

test("the server validates prices, rate and services", () => {
  assert.deepEqual(validatePlan(plan), plan);
  const bad = (input: unknown, field: string) =>
    assert.throws(
      () => validatePlan(input),
      (e: unknown) => Object.hasOwn((e as { fields: Record<string, string> }).fields, field),
    );
  bad({ rateBps: 50, subscriptions: [] }, "rate");
  bad({ rateBps: 10_001, subscriptions: [] }, "rate");
  bad({ rateBps: 10.5, subscriptions: [] }, "rate");
  bad({ rateBps: "1000", subscriptions: [] }, "rate");
  bad({ rateBps: 1000, subscriptions: [{ serviceId: "netflix", priceCents: 15.49 }] }, "netflix");
  bad({ rateBps: 1000, subscriptions: [{ serviceId: "netflix", priceCents: -1 }] }, "netflix");
  bad({ rateBps: 1000, subscriptions: [{ serviceId: "netflix", priceCents: 100_001 }] }, "netflix");
  bad({ rateBps: 1000, subscriptions: [{ serviceId: "spotify", priceCents: 1199 }] }, "subscriptions");
  bad({ rateBps: 1000, subscriptions: [plan.subscriptions[0], plan.subscriptions[0]] }, "netflix");
  bad({ rateBps: 1000, subscriptions: "netflix" }, "subscriptions");
  bad(null, "rate");

  const { ledger } = make();
  assert.throws(() => ledger.savePlan(ALICE, { rateBps: 0, subscriptions: [] }), expectLedgerError(400));
  assert.equal(ledger.getPlan(ALICE).rateBps, null);
});

// ───────────────────────────── isolation between wallets

test("a wallet only ever sees and changes its own plan, month and history", async () => {
  const { ledger } = make();
  ledger.savePlan(ALICE, plan);
  ledger.savePlan(BOB, { rateBps: 2500, subscriptions: [{ serviceId: "zoom", priceCents: 1599 }] });

  assert.deepEqual(ledger.getPlan(ALICE), plan);
  assert.equal(ledger.getPlan(BOB).rateBps, 2500);
  assert.deepEqual(ledger.monthView(ALICE).lines.map((l) => l.ticker), ["NFLX"]);
  assert.deepEqual(ledger.monthView(BOB).lines.map((l) => l.ticker), ["ZM"]);

  const { month } = ledger.begin(ALICE, "NFLX");
  // Bob cannot submit, confirm or cancel Alice's purchase, nor start it for himself.
  assert.throws(() => ledger.submit(BOB, month, "NFLX", HASH(1)), expectLedgerError(409));
  await assert.rejects(ledger.confirm(BOB, month, "NFLX", chain(confirmed)), expectLedgerError(404));
  ledger.cancel(BOB, month, "NFLX");
  assert.equal(ledger.monthView(ALICE).lines[0].status, "signing");
  assert.throws(() => ledger.begin(BOB, "NFLX"), expectLedgerError(409));

  ledger.submit(ALICE, month, "NFLX", HASH(1));
  await ledger.confirm(ALICE, month, "NFLX", chain(confirmed));
  assert.equal(ledger.history(ALICE).length, 1);
  assert.equal(ledger.history(BOB).length, 0);
  // Replacing Bob's plan leaves Alice's untouched; address case does not create a second account.
  ledger.savePlan(BOB, { rateBps: 500, subscriptions: [] });
  assert.deepEqual(ledger.getPlan(ALICE.toUpperCase().replace("0X", "0x")), plan);
});

// ───────────────────────────── monthly idempotency

test("the amount comes from the saved plan and the month view shows what is due", () => {
  const { ledger } = make();
  assert.deepEqual(ledger.monthView(ALICE), { month: "2026-10", rateBps: null, lines: [], dueMicro: "0" });
  assert.throws(() => ledger.begin(ALICE, "NFLX"), expectLedgerError(409));
  ledger.savePlan(ALICE, plan);
  const view = ledger.monthView(ALICE);
  assert.equal(view.dueMicro, "1549000");
  assert.equal(view.lines[0].status, "due");
  assert.deepEqual(ledger.begin(ALICE, "NFLX"), { month: "2026-10", amountMicro: 1_549_000n });
  assert.throws(() => ledger.begin(ALICE, "AAPL"), expectLedgerError(409)); // no Apple subscription
  assert.throws(() => ledger.begin(ALICE, "TSLA"), expectLedgerError(404)); // not in the catalogue
});

test("one month cannot be bought twice: signing, submitted and confirmed all block a second purchase", async () => {
  const { ledger } = make();
  ledger.savePlan(ALICE, plan);
  const { month } = ledger.begin(ALICE, "NFLX");
  assert.throws(() => ledger.begin(ALICE, "NFLX"), expectLedgerError(409));

  ledger.submit(ALICE, month, "NFLX", HASH(1));
  assert.throws(() => ledger.begin(ALICE, "NFLX"), expectLedgerError(409));
  assert.throws(() => ledger.submit(ALICE, month, "NFLX", HASH(2)), expectLedgerError(409));
  ledger.cancel(ALICE, month, "NFLX"); // cancelling cannot undo a sent transaction
  assert.equal(ledger.monthView(ALICE).lines[0].status, "submitted");

  assert.equal(await ledger.confirm(ALICE, month, "NFLX", chain({ state: "pending" })), "submitted");
  assert.equal(await ledger.confirm(ALICE, month, "NFLX", chain(confirmed)), "confirmed");
  assert.throws(() => ledger.begin(ALICE, "NFLX"), expectLedgerError(409));

  const line = ledger.monthView(ALICE).lines[0];
  assert.equal(line.status, "confirmed");
  assert.equal(line.tokenRaw, "22630562450526580");
  assert.equal(ledger.monthView(ALICE).dueMicro, "0");

  // Confirming again is a no-op and never asks the chain.
  const again = chain({ state: "failed", reason: "x" });
  assert.equal(await ledger.confirm(ALICE, month, "NFLX", again), "confirmed");
  assert.equal(again.calls.length, 0);
  assert.equal(ledger.history(ALICE).length, 1);
});

test("a purchase is only shown as bought after the chain confirms it", async () => {
  const { ledger } = make();
  ledger.savePlan(ALICE, plan);
  const { month } = ledger.begin(ALICE, "NFLX");
  assert.equal(ledger.history(ALICE).length, 0);
  ledger.submit(ALICE, month, "NFLX", HASH(1));
  assert.equal(ledger.monthView(ALICE).lines[0].status, "submitted");
  assert.equal(ledger.history(ALICE).length, 0);
  const adapter = chain(confirmed);
  await ledger.confirm(ALICE, month, "NFLX", adapter);
  assert.deepEqual(adapter.calls, [{ txHash: HASH(1), expected: { wallet: ALICE, ticker: "NFLX", amountMicro: 1_549_000n } }]);
  const [entry] = ledger.history(ALICE);
  assert.equal(entry.outcome, "confirmed");
  assert.equal(entry.usdgSpent, "1549000");
  assert.equal(entry.txHash, HASH(1));
});

test("changing the plan after a purchase does not change what was bought, and a new month is due again", async () => {
  const { ledger, clock } = make();
  ledger.savePlan(ALICE, plan);
  const { month } = ledger.begin(ALICE, "NFLX");
  ledger.submit(ALICE, month, "NFLX", HASH(1));
  await ledger.confirm(ALICE, month, "NFLX", chain(confirmed));

  ledger.savePlan(ALICE, { rateBps: 2500, subscriptions: [{ serviceId: "netflix", priceCents: 1799 }] });
  const october = ledger.monthView(ALICE).lines[0];
  assert.equal(october.status, "confirmed");
  assert.equal(october.amountMicro, "1549000");
  assert.equal(october.rateBps, 1000);

  clock.now = Date.parse("2026-11-01T00:00:01Z");
  const november = ledger.monthView(ALICE);
  assert.equal(november.month, "2026-11");
  assert.equal(november.lines[0].status, "due");
  assert.equal(november.lines[0].amountMicro, String(1799 * 2500));
  assert.deepEqual(ledger.begin(ALICE, "NFLX"), { month: "2026-11", amountMicro: 4_497_500n });
  assert.equal(ledger.history(ALICE).length, 1);
});

test("a declined or expired signature frees the purchase; a late hash is still honoured", () => {
  const { ledger, clock } = make();
  ledger.savePlan(ALICE, plan);
  const { month } = ledger.begin(ALICE, "NFLX");
  ledger.cancel(ALICE, month, "NFLX");
  assert.equal(ledger.monthView(ALICE).lines[0].status, "due");

  ledger.begin(ALICE, "NFLX");
  clock.now += SIGNING_LOCK_MS - 1;
  assert.throws(() => ledger.begin(ALICE, "NFLX"), expectLedgerError(409));
  // The wallet answered after the lock ran out, before anything else happened: the hash wins.
  clock.now += 2;
  ledger.submit(ALICE, month, "NFLX", HASH(7));
  assert.equal(ledger.monthView(ALICE).lines[0].status, "submitted");

  const other = make();
  other.ledger.savePlan(ALICE, plan);
  other.ledger.begin(ALICE, "NFLX");
  other.clock.now += SIGNING_LOCK_MS + 1;
  assert.equal(other.ledger.monthView(ALICE).lines[0].status, "due");
  assert.doesNotThrow(() => other.ledger.begin(ALICE, "NFLX"));
});

test("a reverted or mismatching transaction is recorded as failed and the month is due again", async () => {
  const { ledger } = make();
  ledger.savePlan(ALICE, plan);
  const { month } = ledger.begin(ALICE, "NFLX");
  ledger.submit(ALICE, month, "NFLX", HASH(1));
  assert.equal(await ledger.confirm(ALICE, month, "NFLX", chain({ state: "failed", reason: "The transaction reverted. Nothing was bought." })), "due");
  assert.equal(ledger.monthView(ALICE).lines[0].status, "due");
  const [entry] = ledger.history(ALICE);
  assert.equal(entry.outcome, "failed");
  assert.equal(entry.tokenRaw, null);

  // The failed hash can never be reused to settle the retry.
  ledger.begin(ALICE, "NFLX");
  assert.throws(() => ledger.submit(ALICE, month, "NFLX", HASH(1)), expectLedgerError(409));
  ledger.submit(ALICE, month, "NFLX", HASH(2));
  assert.equal(await ledger.confirm(ALICE, month, "NFLX", chain(confirmed)), "confirmed");
  assert.deepEqual(ledger.history(ALICE).map((e) => e.outcome).sort(), ["confirmed", "failed"]);
});

test("one transaction cannot settle two purchases, even across wallets", () => {
  const { ledger } = make();
  ledger.savePlan(ALICE, plan);
  ledger.savePlan(BOB, plan);
  const { month } = ledger.begin(ALICE, "NFLX");
  ledger.begin(BOB, "NFLX");
  ledger.submit(ALICE, month, "NFLX", HASH(1));
  assert.throws(() => ledger.submit(BOB, month, "NFLX", HASH(1).toUpperCase().replace("0X", "0x")), expectLedgerError(409));
  assert.throws(() => ledger.submit(BOB, month, "NFLX", "0x1234"), expectLedgerError(400));
});

test("a transaction the network never saw is dropped only after the waiting period", async () => {
  const { ledger, clock } = make();
  ledger.savePlan(ALICE, plan);
  const { month } = ledger.begin(ALICE, "NFLX");
  ledger.submit(ALICE, month, "NFLX", HASH(1));
  assert.equal(await ledger.confirm(ALICE, month, "NFLX", chain({ state: "unknown" })), "submitted");
  clock.now += DROPPED_AFTER_MS + 1;
  assert.equal(await ledger.confirm(ALICE, month, "NFLX", chain({ state: "unknown" })), "due");
});

test("a purchase submitted just before midnight can still be confirmed next month", async () => {
  const { ledger, clock } = make();
  clock.now = Date.parse("2026-10-31T23:59:50Z");
  ledger.savePlan(ALICE, plan);
  const { month } = ledger.begin(ALICE, "NFLX");
  ledger.submit(ALICE, month, "NFLX", HASH(1));
  clock.now = Date.parse("2026-11-01T00:00:10Z");
  assert.equal(ledger.history(ALICE)[0].outcome, "pending");
  assert.equal(await ledger.confirm(ALICE, "2026-10", "NFLX", chain(confirmed)), "confirmed");
  assert.equal(ledger.history(ALICE)[0].outcome, "confirmed");
  assert.equal(ledger.monthView(ALICE).lines[0].status, "due"); // November is its own month
});

test("a sign-in nonce works exactly once and expires", () => {
  const { ledger, clock } = make();
  const nonce = ledger.issueNonce();
  assert.equal(ledger.consumeNonce(nonce), true);
  assert.equal(ledger.consumeNonce(nonce), false);
  assert.equal(ledger.consumeNonce("never-issued"), false);
  const stale = ledger.issueNonce();
  clock.now += 11 * 60_000;
  assert.equal(ledger.consumeNonce(stale), false);
});

// ───────────────────────────── the swap route

const NFLX = STOCK_TOKENS.NFLX;
const goodQuote = () => ({
  tool: "kyberswap",
  action: {
    fromToken: { address: USDG.address },
    toToken: { address: NFLX.address },
    fromAmount: "1549000",
    fromChainId: 4663,
    toChainId: 4663,
    fromAddress: ALICE,
    toAddress: ALICE,
  },
  estimate: {
    approvalAddress: LIFI.diamond,
    toAmount: "22670335959055360",
    toAmountMin: "22443632599464806",
    feeCosts: [{ amount: "3872", included: true, token: { address: USDG.address } }],
  },
  transactionRequest: { to: LIFI.diamond, data: "0x4666fc80deadbeef", value: "0x0", chainId: 4663, from: ALICE },
});
const expected = { wallet: ALICE, token: NFLX, amountMicro: 1_549_000n };

test("a quote is accepted only if it does exactly what was asked", () => {
  const swap = validateQuote(goodQuote(), expected);
  assert.equal(swap.to, LIFI.diamond);
  assert.equal(swap.toAmountMin, "22443632599464806");
  assert.equal(swap.feeMicro, "3872");
  assert.match(quoteUrl(expected), /fromAmount=1549000/);
  assert.match(quoteUrl(expected), /allowExchanges=kyberswap/);
  assert.match(quoteUrl(expected), /slippage=0\.01/);

  const reject = (mutate: (q: ReturnType<typeof goodQuote>) => void, pattern: RegExp) => {
    const quote = goodQuote();
    mutate(quote);
    assert.throws(() => validateQuote(quote, expected), pattern);
  };
  reject((q) => (q.transactionRequest.to = BOB as `0x${string}`), /unknown contract/);
  reject((q) => (q.estimate.approvalAddress = BOB as `0x${string}`), /unknown contract/);
  reject((q) => (q.action.fromAmount = "15490000"), /different amount/);
  reject((q) => (q.action.toToken.address = STOCK_TOKENS.AAPL.address), /different token/);
  reject((q) => (q.action.toAddress = BOB), /different wallet/);
  reject((q) => (q.transactionRequest.from = BOB), /different wallet/);
  reject((q) => (q.transactionRequest.value = "0x1"), /attaches ETH/);
  reject((q) => (q.transactionRequest.chainId = 1), /another network/);
  reject((q) => (q.estimate.toAmountMin = "0"), /delivers nothing/);
  reject((q) => (q.estimate.toAmountMin = "20000000000000000"), /more slippage/);
  reject((q) => (q.tool = "lifiIntentsDex"), /venue that is not allowed/);
  assert.throws(() => validateQuote({ message: "No available quotes" }, expected), /incomplete quote/);
});

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topic = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const transfer = (token: string, from: string, to: string, value: bigint) => ({ address: token, topics: [TRANSFER, topic(from), topic(to)], data: word(value) });
const POOL = "0xcccccccccccccccccccccccccccccccccccccccc";

test("a confirmed transaction settles a purchase only if it moved the right tokens for the right wallet", () => {
  const receipt = {
    status: "success",
    from: ALICE,
    to: LIFI.diamond,
    logs: [transfer(USDG.address, ALICE, LIFI.diamond, 1_549_000n), transfer(NFLX.address, POOL, ALICE, 22_630_000_000_000_000n), transfer(NFLX.address, POOL, BOB, 5n)],
  };
  assert.deepEqual(settle(receipt, expected), { ok: true, tokenReceived: 22_630_000_000_000_000n, usdgSpent: 1_549_000n });
  assert.equal(netTransfer(receipt, NFLX.address, BOB), 5n);

  assert.equal(settle({ ...receipt, status: "reverted" }, expected).ok, false);
  assert.equal(settle({ ...receipt, from: BOB }, expected).ok, false);
  assert.equal(settle({ ...receipt, to: POOL }, expected).ok, false);
  assert.equal(settle({ ...receipt, logs: [receipt.logs[0]] }, expected).ok, false); // nothing delivered (an intent route)
  assert.equal(settle({ ...receipt, logs: [transfer(USDG.address, ALICE, LIFI.diamond, 9_999_999n), receipt.logs[1]] }, expected).ok, false); // spent more than due
  assert.equal(settle(receipt, { ...expected, token: STOCK_TOKENS.AAPL }).ok, false); // another token
});
