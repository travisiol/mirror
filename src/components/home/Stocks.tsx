"use client";

import { COMPANIES } from "@/config/catalog";
import { CHAIN, STOCK_TOKENS, explorerToken } from "@/config/network";
import { formatPrice, formatPriceTime, usePrices } from "@/lib/prices";
import { ExternalIcon } from "../icons";

/** Every company in the catalogue with the stock token a mirror buys. */
export function Stocks() {
  const prices = usePrices();
  const newest = Object.values(prices)
    .map((price) => price.generatedAt)
    .sort()
    .at(-1);

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {COMPANIES.map((entry) => {
          const token = STOCK_TOKENS[entry.ticker];
          const price = prices[entry.ticker];
          return (
            <li key={entry.ticker} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <span className="tile h-11 min-w-11 px-2.5 text-[0.9375rem] font-bold tracking-[-0.01em]">{entry.ticker}</span>
                {price && <span className="text-[1.0625rem] font-semibold tabular-nums">{formatPrice(price.ask)}</span>}
              </div>
              <p className="mt-4 font-display text-[1.4rem] leading-tight font-semibold tracking-[-0.025em]">{entry.company}</p>
              <p className="mt-1 text-[0.9375rem] leading-snug text-ink-soft">{entry.services.map((s) => s.name).join(" · ")}</p>
              <a
                href={explorerToken(token.address)}
                target="_blank"
                rel="noreferrer"
                className="mt-auto inline-flex items-center gap-1.5 pt-4 text-[0.9375rem] font-medium text-ink-soft hover:text-violet-deep"
              >
                {token.address.slice(0, 6)}…{token.address.slice(-4)}
                <ExternalIcon className="size-4" />
                <span className="sr-only">
                  {entry.ticker} token contract on the {CHAIN.name} explorer
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <p className="mt-5 text-[0.9375rem] leading-relaxed text-ink-soft">
        {newest
          ? `Token ask prices from Robinhood’s Stock Token API, as of ${formatPriceTime(newest)}. Stock prices follow market hours.`
          : "Prices are not available right now, so none are shown."}{" "}
        Contract addresses come from Robinhood’s official asset list and were re-read on {CHAIN.name}.
      </p>
    </>
  );
}
