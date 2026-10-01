"use client";

import { useState } from "react";
import { CATALOG, SERVICE_BY_ID } from "@/config/catalog";
import { DEFAULT_RATE_BPS, MAX_PRICE_CENTS, MAX_RATE_BPS, MIN_ORDER_MICRO, MIN_PRICE_CENTS, MIN_RATE_BPS, RATE_PRESETS_BPS } from "@/config/mirror-policy";
import { formatCents, formatRate, formatUsd, mirrorAmountMicro, parsePriceCents, parseRateBps } from "@/core/mirror";

/** The mirror formula, live: the visitor's own service, price and rate. Nothing is stored. */
export function Calculator() {
  const [serviceId, setServiceId] = useState("netflix");
  const [price, setPrice] = useState("15.49");
  const [rateBps, setRateBps] = useState<number>(DEFAULT_RATE_BPS);
  const [custom, setCustom] = useState("");

  const service = SERVICE_BY_ID[serviceId];
  const cents = parsePriceCents(price);
  const priceOk = cents !== null && cents >= MIN_PRICE_CENTS && cents <= MAX_PRICE_CENTS;
  const customBps = custom ? parseRateBps(custom) : null;
  const customOk = customBps !== null && customBps >= MIN_RATE_BPS && customBps <= MAX_RATE_BPS;
  const activeRate = custom ? (customOk ? customBps : null) : rateBps;
  const monthly = priceOk && activeRate !== null ? mirrorAmountMicro(cents, activeRate) : null;

  return (
    <div className="card p-6 sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-[0.9375rem] font-semibold">Subscription</span>
          <select className="field" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
            {CATALOG.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-2 block text-[0.9375rem] font-semibold">What you pay each month (USD)</span>
          <input
            className="field"
            inputMode="decimal"
            value={price}
            aria-invalid={!priceOk}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="15.49"
          />
        </label>
      </div>

      <div className="mt-5">
        <span className="mb-2 block text-[0.9375rem] font-semibold">Mirror rate</span>
        <div className="flex flex-wrap items-center gap-3">
          <div className="seg" role="group" aria-label="Mirror rate">
            {RATE_PRESETS_BPS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={!custom && preset === rateBps}
                onClick={() => {
                  setRateBps(preset);
                  setCustom("");
                }}
              >
                {formatRate(preset)}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[0.9375rem] font-medium text-ink-soft">
            or
            <input
              className="field !min-h-[2.6rem] !w-[5.5rem] text-center"
              inputMode="decimal"
              value={custom}
              aria-label="Custom mirror rate in percent"
              aria-invalid={custom !== "" && !customOk}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="15"
            />
            %
          </label>
        </div>
      </div>

      <div className="mt-7 rounded-[20px] bg-violet-soft p-5 sm:p-6" aria-live="polite">
        {monthly !== null && priceOk && activeRate !== null ? (
          <>
            <p className="text-[1.0625rem] text-ink-soft">
              {formatCents(cents)} × {formatRate(activeRate)} =
            </p>
            <p className="display mt-1 text-[clamp(2.6rem,7vw,4rem)] tabular-nums">
              {formatUsd(monthly)}
              <span className="ml-2 font-sans text-[1.0625rem] font-medium tracking-normal text-ink-soft">a month</span>
            </p>
            <p className="mt-3 text-[1.0625rem] leading-relaxed">
              buys <strong className="font-semibold">{service.ticker}</strong>, the {service.company} stock token —{" "}
              {formatUsd(monthly * BigInt(12))} over twelve months at this price and rate.
            </p>
            {monthly < MIN_ORDER_MICRO && (
              <p className="note note-warn mt-4">
                The smallest order the swap route takes is {formatUsd(MIN_ORDER_MICRO)}. Raise the rate to mirror this one.
              </p>
            )}
          </>
        ) : (
          <p className="text-[1.0625rem] text-ink-soft">
            Enter a monthly price between {formatCents(MIN_PRICE_CENTS)} and {formatCents(MAX_PRICE_CENTS)} and a rate between{" "}
            {formatRate(MIN_RATE_BPS)} and {formatRate(MAX_RATE_BPS)}.
          </p>
        )}
      </div>
    </div>
  );
}
