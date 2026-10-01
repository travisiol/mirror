"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { COMPANIES } from "@/config/catalog";
import { MAX_SLIPPAGE_BPS, MIN_ORDER_MICRO } from "@/config/mirror-policy";
import { CHAIN, STOCK_TOKENS, explorerTx } from "@/config/network";
import type { HistoryEntry, LineView } from "@/core/ledger";
import { formatRate, formatTokens, formatUsd, formatUsdgExact, monthLabel, toShareUnits } from "@/core/mirror";
import type { PreparedSwap } from "@/core/swap";
import { ApiError, appStore, useApp } from "@/lib/app-store";
import type { BuyStep } from "@/lib/app-store";
import { formatPriceTime, usePrices, valueAtBid } from "@/lib/prices";
import { isUserRejection, openWalletDialog, useWallet, walletErrorMessage } from "@/lib/wallet";
import { Modal } from "../Modal";
import { LogoMark } from "../Logo";
import { CheckIcon, ExternalIcon } from "../icons";
import { SignInGate } from "./SignInGate";

const ONE = BigInt(10) ** BigInt(18);
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const errorText = (error: unknown) => (error instanceof ApiError ? error.message : walletErrorMessage(error));

function TxLink({ hash, children }: { hash: string; children?: React.ReactNode }) {
  return (
    <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-violet-deep hover:underline">
      {children ?? `${hash.slice(0, 8)}…${hash.slice(-6)}`}
      <ExternalIcon className="size-4" />
    </a>
  );
}

const STATUS: Record<LineView["status"], { label: string; className: string }> = {
  due: { label: "To buy", className: "bg-violet-soft text-violet-deep" },
  "too-small": { label: "Too small", className: "bg-line-soft text-ink-soft" },
  signing: { label: "Waiting for signature", className: "bg-warn-soft text-warn" },
  submitted: { label: "Confirming", className: "bg-warn-soft text-warn" },
  confirmed: { label: "Bought", className: "bg-good-soft text-good" },
};

/** A purchase the wallet was asked to sign but whose transaction we never received. */
function LockedLine({ line, month }: { line: LineView; month: string }) {
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="note note-warn mt-3">
      <p>
        Your wallet was asked to sign this purchase. If it shows a sent swap, paste its transaction hash so it is not
        bought twice. If nothing was sent, release it.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className="field min-w-0 flex-1 !min-h-[2.6rem] !text-[0.9375rem] !font-medium"
          placeholder="0x… transaction hash"
          aria-label={`${line.ticker} transaction hash`}
          value={hash}
          onChange={(event) => setHash(event.target.value.trim())}
        />
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(hash)}
          onClick={() => act(async () => {
            await appStore.submit(month, line.ticker, hash);
            await appStore.waitConfirmed(month, line.ticker);
          })}
        >
          Check it
        </button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => act(() => appStore.cancel(month, line.ticker))}>
          Nothing was sent
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 font-semibold text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

function Line({ line, month }: { line: LineView; month: string }) {
  const token = STOCK_TOKENS[line.ticker];
  const status = STATUS[line.status];
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="tile h-11 min-w-11 px-2.5 text-[0.9375rem] font-bold">{line.ticker}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[1.125rem] font-semibold tracking-[-0.01em]">{line.company}</p>
          <p className="text-[0.9375rem] text-ink-soft">
            {line.parts.map((part) => part.name).join(" · ")} · {formatRate(line.rateBps)}
          </p>
        </div>
        <span className={`badge ${status.className}`}>
          {line.status === "submitted" && <span className="spinner !size-3.5" />}
          {line.status === "confirmed" && <CheckIcon className="size-4" />}
          {status.label}
        </span>
        <span className="w-[5.5rem] text-right text-[1.25rem] font-semibold tabular-nums">{formatUsd(BigInt(line.amountMicro))}</span>
      </div>
      {line.status === "confirmed" && line.tokenRaw && line.txHash && (
        <p className="mt-2 pl-[3.75rem] text-[1rem] text-ink-soft">
          Received <strong className="font-semibold text-ink">{formatTokens(BigInt(line.tokenRaw), token.decimals)} {line.ticker}</strong> for{" "}
          {formatUsdgExact(BigInt(line.usdgSpent ?? line.amountMicro))} USDG · <TxLink hash={line.txHash}>Transaction</TxLink>
        </p>
      )}
      {line.status === "submitted" && line.txHash && (
        <p className="mt-2 pl-[3.75rem] text-[1rem] text-ink-soft">
          Sent. Waiting for {CHAIN.name} to confirm it · <TxLink hash={line.txHash}>Transaction</TxLink>
        </p>
      )}
      {line.status === "too-small" && (
        <p className="mt-2 pl-[3.75rem] text-[1rem] text-ink-soft">
          Under the smallest order of {formatUsd(MIN_ORDER_MICRO)}. Raise your rate to include it.
        </p>
      )}
      {line.status === "signing" && <LockedLine line={line} month={month} />}
    </li>
  );
}

type RunResult = { ticker: string; ok: boolean; text: string };

function ApproveDialog({ open, onClose, lines }: { open: boolean; onClose: () => void; lines: LineView[] }) {
  const app = useApp();
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<BuyStep | null>(null);
  const [quotes, setQuotes] = useState<Record<string, PreparedSwap>>({});
  const [results, setResults] = useState<RunResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The lines this run started with: the live list shrinks as purchases confirm.
  const [plan, setPlan] = useState<LineView[] | null>(null);

  const shown = plan ?? lines;
  const total = shown.reduce((sum, line) => sum + BigInt(line.amountMicro), BigInt(0));
  const finished = plan !== null && !running;

  const close = () => {
    setPlan(null);
    setResults([]);
    setQuotes({});
    setStep(null);
    setError(null);
    onClose();
  };

  const run = async () => {
    const todo = lines;
    const sum = todo.reduce((acc, line) => acc + BigInt(line.amountMicro), BigInt(0));
    setPlan(todo);
    setRunning(true);
    setError(null);
    setResults([]);
    try {
      // One approval for exactly what is left to buy — never an unlimited one.
      if (BigInt(app.wallet?.allowance ?? "0") < sum) await appStore.approveExact(sum, setStep);
      for (const line of todo) {
        try {
          const status = await appStore.buy(line.ticker, setStep, (swap) => setQuotes((current) => ({ ...current, [line.ticker]: swap })));
          setResults((current) => [
            ...current,
            status === "confirmed"
              ? { ticker: line.ticker, ok: true, text: "Bought" }
              : status === "submitted"
                ? { ticker: line.ticker, ok: true, text: "Sent — still confirming" }
                : { ticker: line.ticker, ok: false, text: "The transaction failed. Nothing was bought." },
          ]);
        } catch (e) {
          setResults((current) => [...current, { ticker: line.ticker, ok: false, text: errorText(e) }]);
          if (isUserRejection(e)) break; // a refusal stops the run; nothing else is asked
        }
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStep(null);
      setRunning(false);
      await appStore.refresh();
    }
  };

  const stepText = (line: LineView): string | null => {
    const done = results.find((r) => r.ticker === line.ticker);
    if (done) return done.text;
    if (step?.kind === "swap" && step.ticker === line.ticker)
      return step.state === "quote" ? "Getting a live quote…" : step.state === "wallet" ? "Confirm the swap in your wallet" : "Waiting for confirmation…";
    return null;
  };

  return (
    <Modal open={open} onClose={close} dismissible={!running} title={finished ? "This month’s mirror" : "Review and sign"}>
      <ul className="divide-y divide-line-soft">
        {shown.map((line) => {
          const quote = quotes[line.ticker];
          const text = stepText(line);
          const done = results.find((r) => r.ticker === line.ticker);
          return (
            <li key={line.ticker} className="py-3">
              <div className="flex items-baseline justify-between gap-3 text-[1.0625rem]">
                <span>
                  <span className="font-semibold">{line.ticker}</span> <span className="text-ink-soft">{line.company}</span>
                </span>
                <span className="font-semibold tabular-nums">{formatUsdgExact(BigInt(line.amountMicro))} USDG</span>
              </div>
              {quote && (
                <p className="mt-1 text-[0.9375rem] text-ink-soft">
                  Quote {formatTokens(BigInt(quote.toAmount), 18)} {line.ticker} · you receive at least{" "}
                  <strong className="font-semibold text-ink">{formatTokens(BigInt(quote.toAmountMin), 18)}</strong> · route fee{" "}
                  {formatUsdgExact(BigInt(quote.feeMicro))} USDG
                </p>
              )}
              {text && (
                <p className={`mt-1 flex items-center gap-2 text-[0.9375rem] font-semibold ${done ? (done.ok ? "text-good" : "text-bad") : "text-violet-deep"}`}>
                  {!done && <span className="spinner !size-3.5" />}
                  {text}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-[1.0625rem] font-medium">Total</span>
        <span className="display text-[1.75rem] tabular-nums">{formatUsdgExact(total)} USDG</span>
      </div>

      {step?.kind === "approve" && (
        <p className="note note-warn mt-4 flex items-center gap-2">
          <span className="spinner !size-3.5" />
          {step.state === "wallet" ? `Approve exactly ${formatUsdgExact(total)} USDG in your wallet` : "Waiting for the approval to confirm…"}
        </p>
      )}
      {error && (
        <p role="alert" className="note note-bad mt-4">
          {error}
        </p>
      )}

      {plan === null && (
        <>
          <ul className="mt-5 space-y-2 text-[0.9375rem] leading-relaxed text-ink-soft">
            <li>
              <strong className="font-semibold text-ink">What you sign:</strong> one approval for exactly {formatUsdgExact(total)} USDG, then{" "}
              {shown.length === 1 ? "one swap" : `${shown.length} swaps, one per company`}.
            </li>
            <li>
              <strong className="font-semibold text-ink">Maximum slippage {MAX_SLIPPAGE_BPS / 100}%:</strong> each swap shows the least you can
              receive before you sign it, and fails rather than deliver less.
            </li>
            <li>The route’s fee comes out of the amount; the network fee is paid in ETH. Stock tokens can lose value.</li>
          </ul>
          <button type="button" className="btn btn-accent mt-6 w-full" onClick={run}>
            Approve and sign
          </button>
        </>
      )}
      {finished && (
        <button type="button" className="btn btn-quiet mt-6 w-full" onClick={close}>
          Done
        </button>
      )}
    </Modal>
  );
}

function Holdings() {
  const app = useApp();
  const prices = usePrices();
  if (!app.wallet) {
    return app.walletError ? (
      <p role="alert" className="note note-bad">
        {app.walletError}
      </p>
    ) : (
      <p className="text-ink-soft">Reading {CHAIN.name}…</p>
    );
  }
  const held = app.wallet.holdings.filter((holding) => BigInt(holding.raw) > BigInt(0));
  if (held.length === 0)
    return (
      <p className="text-[1.0625rem] leading-relaxed text-ink-soft">
        This wallet holds none of the catalogue’s stock tokens yet. They appear here, read from {CHAIN.name}, after your first confirmed purchase.
      </p>
    );
  const stamp = held
    .map((holding) => prices[holding.ticker]?.generatedAt)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);
  return (
    <>
      <ul className="divide-y divide-line-soft">
        {held.map((holding) => {
          const token = STOCK_TOKENS[holding.ticker];
          const raw = BigInt(holding.raw);
          const multiplier = BigInt(holding.uiMultiplier);
          const price = prices[holding.ticker];
          return (
            <li key={holding.ticker} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3.5">
              <span className="tile h-11 min-w-11 px-2.5 text-[0.9375rem] font-bold">{holding.ticker}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[1.125rem] font-semibold">{COMPANIES.find((c) => c.ticker === holding.ticker)?.company}</p>
                {multiplier !== ONE && (
                  <p className="text-[0.9375rem] text-ink-soft">
                    = {formatTokens(toShareUnits(raw, multiplier), token.decimals)} share-equivalents (multiplier {formatTokens(multiplier, 18)})
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-[1.25rem] font-semibold tabular-nums">
                  {formatTokens(raw, token.decimals)} <span className="text-[1rem] font-medium text-ink-soft">tokens</span>
                </p>
                {price && <p className="text-[0.9375rem] text-ink-soft tabular-nums">≈ {valueAtBid(raw, token.decimals, price.bid)}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-soft">
        Balances read from {CHAIN.name} at block {app.wallet.block.toLocaleString("en-US")}.{" "}
        {stamp ? `Dollar values use Robinhood’s token bid price as of ${formatPriceTime(stamp)}.` : "No price source is available right now, so only quantities are shown."}
      </p>
    </>
  );
}

function History({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0)
    return <p className="text-[1.0625rem] leading-relaxed text-ink-soft">No purchases yet. Each confirmed purchase is listed here with its transaction.</p>;
  return (
    <ul className="divide-y divide-line-soft">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-[1.0625rem] font-semibold">
              {entry.ticker} <span className="font-medium text-ink-soft">· {monthLabel(entry.month)}</span>
            </p>
            <p className="text-[0.9375rem] text-ink-soft">
              {DATE.format(entry.at)} · <TxLink hash={entry.txHash} />
            </p>
            {entry.reason && <p className="text-[0.9375rem] font-medium text-bad">{entry.reason}</p>}
          </div>
          {entry.outcome === "confirmed" && entry.tokenRaw ? (
            <div className="text-right">
              <p className="text-[1.0625rem] font-semibold tabular-nums">
                +{formatTokens(BigInt(entry.tokenRaw), 18)} {entry.ticker}
              </p>
              <p className="text-[0.9375rem] text-ink-soft tabular-nums">{formatUsdgExact(BigInt(entry.usdgSpent ?? "0"))} USDG</p>
            </div>
          ) : (
            <span className={`badge ${entry.outcome === "pending" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad"}`}>
              {entry.outcome === "pending" ? "Confirming" : "Failed"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Board() {
  const app = useApp();
  const wallet = useWallet();
  const [reviewing, setReviewing] = useState(false);
  const month = app.month;

  // Purchases that were sent but not settled when the page opened: ask the chain.
  const watching = useRef(new Set<string>());
  const openKeys = [
    ...(month?.lines.filter((line) => line.status === "submitted").map((line) => `${month.month}:${line.ticker}`) ?? []),
    ...app.history.filter((entry) => entry.outcome === "pending").map((entry) => `${entry.month}:${entry.ticker}`),
  ].join(",");
  useEffect(() => {
    for (const key of openKeys ? openKeys.split(",") : []) {
      if (watching.current.has(key)) continue;
      watching.current.add(key);
      const [m, ticker] = key.split(":");
      void appStore.waitConfirmed(m, ticker).finally(() => watching.current.delete(key));
    }
  }, [openKeys]);

  if (!month) {
    return app.error ? (
      <div className="card mx-auto max-w-[38rem] p-8 text-center">
        <p role="alert" className="note note-bad text-left">
          {app.error}
        </p>
        <button type="button" className="btn btn-quiet mt-5" onClick={() => appStore.refresh()}>
          Try again
        </button>
      </div>
    ) : null;
  }

  const due = month.lines.filter((line) => line.status === "due");
  const dueTotal = BigInt(month.dueMicro);
  const bought = month.lines.filter((line) => line.status === "confirmed");
  const usdg = app.wallet ? BigInt(app.wallet.usdg) : null;
  const eth = app.wallet ? BigInt(app.wallet.eth) : null;
  const short = usdg !== null && usdg < dueTotal;
  const connected = wallet.address === app.session;

  return (
    <div className="rise">
      <p className="eyebrow">{monthLabel(month.month)}</p>
      <h1 className="display mt-2 text-[clamp(2.2rem,5vw,3.25rem)] font-semibold">This month’s mirror</h1>

      {month.lines.length === 0 ? (
        <section className="card mt-7 p-[clamp(1.75rem,5vw,3.5rem)] text-center">
          <LogoMark className="mx-auto size-16 text-lilac" />
          <h2 className="mt-6 font-display text-[1.75rem] font-semibold tracking-[-0.03em]">Nothing to mirror yet</h2>
          <p className="mx-auto mt-3 max-w-[30rem] text-[1.0625rem] leading-relaxed text-ink-soft">
            List the subscriptions you pay for and pick a rate. Your first month will show up here, ready for you to approve.
          </p>
          <Link href="/app" className="btn btn-accent mt-7">
            List my subscriptions
          </Link>
        </section>
      ) : (
        <section className="card mt-7 p-[clamp(1.25rem,3vw,2rem)]">
          <ul className="divide-y divide-line-soft">
            {month.lines.map((line) => (
              <Line key={line.ticker} line={line} month={month.month} />
            ))}
          </ul>

          <div className="mt-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-t border-line pt-5">
            <div>
              <p className="text-[1rem] font-medium text-ink-soft">{due.length > 0 ? "Left to buy this month" : "This month"}</p>
              <p className="display mt-1 text-[clamp(2.4rem,6vw,3.25rem)] tabular-nums">
                {due.length > 0 ? formatUsd(dueTotal) : bought.length > 0 ? "Done" : "—"}
              </p>
              {due.length > 0 && <p className="mt-1 text-[0.9375rem] text-ink-soft">exactly {formatUsdgExact(dueTotal)} USDG</p>}
            </div>
            {due.length > 0 &&
              (connected ? (
                <button type="button" className="btn btn-accent" disabled={short || !app.wallet} onClick={() => setReviewing(true)}>
                  Approve this month’s mirror
                </button>
              ) : (
                <button type="button" className="btn btn-accent" onClick={openWalletDialog}>
                  Connect wallet to approve
                </button>
              ))}
          </div>

          {due.length > 0 && app.wallet && (
            <p className="mt-4 text-[0.9375rem] text-ink-soft">
              In your wallet: {formatUsdgExact(usdg ?? BigInt(0))} USDG · {formatTokens(eth ?? BigInt(0), 18)} ETH for network fees
            </p>
          )}
          {due.length > 0 && short && (
            <p role="alert" className="note note-bad mt-3">
              This month needs {formatUsdgExact(dueTotal)} USDG and this wallet holds {formatUsdgExact(usdg ?? BigInt(0))}. Add USDG on {CHAIN.name} or lower
              your rate.
            </p>
          )}
          {due.length > 0 && eth === BigInt(0) && (
            <p role="alert" className="note note-warn mt-3">
              This wallet has no ETH on {CHAIN.name}. Network fees are paid in ETH, so the purchase cannot be sent yet.
            </p>
          )}
          {due.length > 0 && app.walletError && (
            <p role="alert" className="note note-bad mt-3">
              {app.walletError}
            </p>
          )}
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-soft">
            Nothing is taken automatically. A purchase is listed as bought only after {CHAIN.name} has confirmed its transaction.
          </p>
        </section>
      )}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <section className="card p-[clamp(1.25rem,3vw,2rem)]">
          <h2 className="font-display text-[1.5rem] font-semibold tracking-[-0.025em]">What you own</h2>
          <div className="mt-3">
            <Holdings />
          </div>
        </section>
        <section className="card p-[clamp(1.25rem,3vw,2rem)]">
          <h2 className="font-display text-[1.5rem] font-semibold tracking-[-0.025em]">History</h2>
          <div className="mt-3">
            <History entries={app.history} />
          </div>
        </section>
      </div>

      <ApproveDialog open={reviewing} onClose={() => setReviewing(false)} lines={due} />
    </div>
  );
}

export default function Dashboard() {
  return (
    <SignInGate title="Your dashboard">
      <Board />
    </SignInGate>
  );
}
