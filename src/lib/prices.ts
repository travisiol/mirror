"use client";

import { useSyncExternalStore } from "react";
import type { PriceView } from "@/server/chain";

/**
 * Token prices from /api/prices (Robinhood's Stock Token API). When the
 * source is unavailable the map is simply empty and screens show token
 * quantities without a dollar value.
 */
type PriceMap = Record<string, PriceView>;
const EMPTY: PriceMap = {};
let prices: PriceMap = EMPTY;
let loadedAt = 0;
let watching = false;
const listeners = new Set<() => void>();

async function load() {
  loadedAt = Date.now();
  try {
    const response = await fetch("/api/prices", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { prices: PriceView[] };
    prices = Object.fromEntries(body.prices.map((price) => [price.ticker, price]));
    listeners.forEach((l) => l());
  } catch {
    // keep what we have; it carries its own timestamp
  }
}

/** Loaded once, then refreshed when the reader comes back to the tab — no background polling. */
const refreshIfStale = () => {
  if (document.visibilityState === "visible" && Date.now() - loadedAt > 30_000) void load();
};

export function usePrices(): PriceMap {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (!watching) {
        watching = true;
        void load();
        document.addEventListener("visibilitychange", refreshIfStale);
        window.addEventListener("focus", refreshIfStale);
      }
      return () => listeners.delete(listener);
    },
    () => prices,
    () => EMPTY,
  );
}

const TIME = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

/** "Oct 1, 3:20 PM EDT" in the reader's timezone. */
export const formatPriceTime = (iso: string) => TIME.format(new Date(iso));

/** "68.14" → "$68.14" */
export function formatPrice(value: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}

/** Value of a raw token balance at the bid, as a dollar string. Display only. */
export function valueAtBid(raw: bigint, decimals: number, bid: string): string {
  // bid has at most 18 decimals; scale it to an integer of 1e-8 dollars.
  const [whole, fraction = ""] = bid.split(".");
  const scaled = BigInt(whole + fraction.slice(0, 8).padEnd(8, "0"));
  const cents = (raw * scaled) / BigInt(10) ** BigInt(decimals) / BigInt(1_000_000);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents) / 100);
}
