/**
 * The rules of a mirror. Rates are basis points (1% = 100) and prices are
 * cents, so the monthly amount is exact integer math — see src/core/mirror.ts.
 */
export const RATE_PRESETS_BPS = [500, 1000, 2500] as const;
export const DEFAULT_RATE_BPS = 1000;
export const MIN_RATE_BPS = 100; // 1%
export const MAX_RATE_BPS = 10_000; // 100%

export const MIN_PRICE_CENTS = 50; // $0.50
export const MAX_PRICE_CENTS = 100_000; // $1,000.00

/**
 * Smallest order sent to the swap route, in USDG base units (6 decimals).
 * $0.25 is the smallest size a live quote was obtained for on every token.
 */
export const MIN_ORDER_MICRO = BigInt(250_000);

/** The most a swap may slip below its quote. Shown before signing. */
export const MAX_SLIPPAGE_BPS = 100; // 1%

/** How long a purchase stays locked while the wallet is asked to sign. */
export const SIGNING_LOCK_MS = 10 * 60_000;

/** A submitted transaction the chain has never heard of is dropped after this long. */
export const DROPPED_AFTER_MS = 15 * 60_000;
