/**
 * The mirror calculation. Pure and framework-free.
 *
 * A price is an integer number of cents, a rate an integer number of basis
 * points, and USDG has 6 decimals. So:
 *
 *   amount (USDG base units) = cents × 10⁴ × bps ÷ 10⁴ = cents × bps
 *
 * The amount due is therefore always exact — nothing is rounded before the
 * purchase. Rounding only happens when an amount is displayed.
 */
import { CATALOG, SERVICE_BY_ID } from "../config/catalog.ts";
import {
  MAX_PRICE_CENTS,
  MAX_RATE_BPS,
  MIN_ORDER_MICRO,
  MIN_PRICE_CENTS,
  MIN_RATE_BPS,
} from "../config/mirror-policy.ts";

export interface Subscription {
  serviceId: string;
  priceCents: number;
}

export interface Plan {
  rateBps: number;
  subscriptions: Subscription[];
}

export interface MirrorPart {
  serviceId: string;
  name: string;
  priceCents: number;
  amountMicro: bigint;
}

export interface MirrorLine {
  ticker: string;
  company: string;
  amountMicro: bigint;
  parts: MirrorPart[];
  /** Below the smallest order the swap route was verified for. */
  belowMinimum: boolean;
}

export class PlanError extends Error {
  fields: Record<string, string>;
  constructor(fields: Record<string, string>) {
    super(Object.values(fields)[0] ?? "Invalid plan.");
    this.name = "PlanError";
    this.fields = fields;
  }
}

const ZERO = BigInt(0);

/** "2026-10" for any instant, in UTC so server and browser agree. */
export function monthKey(time: number): string {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-10" → "October 2026" */
export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  const name = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(Date.UTC(year, month - 1, 1));
  return `${name} ${year}`;
}

/** Exact monthly amount for one subscription, in USDG base units. */
export function mirrorAmountMicro(priceCents: number, rateBps: number): bigint {
  if (!Number.isInteger(priceCents) || !Number.isInteger(rateBps) || priceCents < 0 || rateBps < 0)
    throw new RangeError("price and rate must be non-negative integers");
  return BigInt(priceCents) * BigInt(rateBps);
}

/** One line per company, in catalogue order. Unknown services are ignored. */
export function computeMirror(plan: Plan): { lines: MirrorLine[]; totalMicro: bigint } {
  const lines: MirrorLine[] = [];
  for (const service of CATALOG) {
    const subscription = plan.subscriptions.find((s) => s.serviceId === service.id);
    if (!subscription) continue;
    const amountMicro = mirrorAmountMicro(subscription.priceCents, plan.rateBps);
    const part: MirrorPart = { serviceId: service.id, name: service.name, priceCents: subscription.priceCents, amountMicro };
    const line = lines.find((l) => l.ticker === service.ticker);
    if (line) {
      line.parts.push(part);
      line.amountMicro += amountMicro;
    } else {
      lines.push({ ticker: service.ticker, company: service.company, amountMicro, parts: [part], belowMinimum: false });
    }
  }
  let totalMicro = ZERO;
  for (const line of lines) {
    line.belowMinimum = line.amountMicro < MIN_ORDER_MICRO;
    if (!line.belowMinimum) totalMicro += line.amountMicro;
  }
  return { lines, totalMicro };
}

/** "15.49" / "15,49" / "$15" → 1549. Null when it is not a plain amount. */
export function parsePriceCents(input: string): number | null {
  const match = /^\$?\s*(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** "10" / "12.5" / "12,5%" → basis points. Null when finer than 0.01% or not a number. */
export function parseRateBps(input: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?\s*%?$/.exec(input.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Server-side validation of everything a client can send for a plan. */
export function validatePlan(input: unknown): Plan {
  const fields: Record<string, string> = {};
  const body = (input ?? {}) as { rateBps?: unknown; subscriptions?: unknown };

  const rateBps = body.rateBps;
  if (typeof rateBps !== "number" || !Number.isInteger(rateBps) || rateBps < MIN_RATE_BPS || rateBps > MAX_RATE_BPS)
    fields.rate = `Choose a mirror rate between ${MIN_RATE_BPS / 100}% and ${MAX_RATE_BPS / 100}%.`;

  const subscriptions: Subscription[] = [];
  if (!Array.isArray(body.subscriptions) || body.subscriptions.length > CATALOG.length) {
    fields.subscriptions = "Invalid subscription list.";
  } else {
    const seen = new Set<string>();
    for (const raw of body.subscriptions as { serviceId?: unknown; priceCents?: unknown }[]) {
      const serviceId = typeof raw?.serviceId === "string" ? raw.serviceId : "";
      const service = SERVICE_BY_ID[serviceId];
      if (!service) {
        fields.subscriptions = "That service is not in the catalogue.";
        continue;
      }
      if (seen.has(serviceId)) {
        fields[serviceId] = `${service.name} is listed twice.`;
        continue;
      }
      seen.add(serviceId);
      const price = raw.priceCents;
      if (typeof price !== "number" || !Number.isInteger(price) || price < MIN_PRICE_CENTS || price > MAX_PRICE_CENTS) {
        fields[serviceId] = `Enter what you pay each month, between ${formatCents(MIN_PRICE_CENTS)} and ${formatCents(MAX_PRICE_CENTS)}.`;
        continue;
      }
      subscriptions.push({ serviceId, priceCents: price });
    }
  }

  if (Object.keys(fields).length > 0) throw new PlanError(fields);
  return { rateBps: rateBps as number, subscriptions };
}

// ───────────────────────────── display

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 1549 → "$15.49" */
export function formatCents(cents: number): string {
  return `$${group(String(Math.floor(cents / 100)))}.${String(cents % 100).padStart(2, "0")}`;
}

/** USDG base units → "$1.55", rounded half up to the cent. Display only. */
export function formatUsd(micro: bigint): string {
  const cents = (micro + BigInt(5_000)) / BigInt(10_000);
  return `$${group((cents / BigInt(100)).toString())}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
}

/** USDG base units → "1.549" (exact, trailing zeros trimmed to two places). */
export function formatUsdgExact(micro: bigint): string {
  const whole = micro / BigInt(1_000_000);
  let fraction = (micro % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  if (fraction.length < 2) fraction = fraction.padEnd(2, "0");
  return `${group(whole.toString())}.${fraction}`;
}

/** 1000 → "10%", 1250 → "12.5%" */
export function formatRate(bps: number): string {
  return `${String(bps / 100)}%`;
}

/**
 * Token base units → a readable quantity, truncated (never rounded up) to
 * `places` decimals. Stock tokens are fractional, so tiny holdings matter:
 * anything below the last shown place reads "<0.000001".
 */
export function formatTokens(raw: bigint, decimals: number, places = 6): string {
  if (raw === ZERO) return "0";
  const base = BigInt(10) ** BigInt(decimals);
  const whole = raw / base;
  const scale = BigInt(10) ** BigInt(decimals - places);
  const fraction = (raw % base) / scale;
  if (whole === ZERO && fraction === ZERO) return `<0.${"0".repeat(places - 1)}1`;
  const text = fraction.toString().padStart(places, "0").replace(/0+$/, "");
  return `${group(whole.toString())}${text ? `.${text}` : ""}`;
}

/**
 * ERC-8056: a stock token's raw balance never changes on a split or a
 * reinvested dividend; `uiMultiplier` (18 decimals) does. Share-equivalent
 * units = raw × multiplier ÷ 1e18.
 */
export function toShareUnits(raw: bigint, uiMultiplier: bigint): bigint {
  return (raw * uiMultiplier) / BigInt(10) ** BigInt(18);
}
