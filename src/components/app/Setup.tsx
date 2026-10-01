"use client";

import Link from "next/link";
import { useState } from "react";
import { COMPANIES } from "@/config/catalog";
import { DEFAULT_RATE_BPS, MAX_PRICE_CENTS, MAX_RATE_BPS, MIN_ORDER_MICRO, MIN_PRICE_CENTS, MIN_RATE_BPS, RATE_PRESETS_BPS } from "@/config/mirror-policy";
import { computeMirror, formatCents, formatRate, formatUsd, parsePriceCents, parseRateBps } from "@/core/mirror";
import type { Subscription } from "@/core/mirror";
import { ApiError, appStore, useApp } from "@/lib/app-store";
import type { PlanView } from "@/lib/app-store";
import { CheckIcon } from "../icons";
import { SignInGate } from "./SignInGate";

const centsToInput = (cents: number) => (cents / 100).toFixed(2);
const isPreset = (bps: number) => (RATE_PRESETS_BPS as readonly number[]).includes(bps);

function Editor({ plan }: { plan: PlanView }) {
  // What is typed, per service. A service is "on" when it has an entry.
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(plan.subscriptions.map((s) => [s.serviceId, centsToInput(s.priceCents)])),
  );
  const [rateBps, setRateBps] = useState<number>(plan.rateBps ?? DEFAULT_RATE_BPS);
  const [custom, setCustom] = useState(plan.rateBps !== null && !isPreset(plan.rateBps) ? String(plan.rateBps / 100) : "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const touch = () => {
    setSaved(false);
    setError(null);
  };

  const customBps = custom ? parseRateBps(custom) : null;
  const customOk = customBps !== null && customBps >= MIN_RATE_BPS && customBps <= MAX_RATE_BPS;
  const activeRate = custom ? (customOk ? customBps : null) : rateBps;

  const priceProblem = (text: string): string | null => {
    const cents = parsePriceCents(text);
    if (cents === null) return "Enter a price like 15.49.";
    if (cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS) return `Between ${formatCents(MIN_PRICE_CENTS)} and ${formatCents(MAX_PRICE_CENTS)}.`;
    return null;
  };

  const valid: Subscription[] = [];
  let invalid = 0;
  for (const [serviceId, text] of Object.entries(prices)) {
    if (priceProblem(text)) invalid++;
    else valid.push({ serviceId, priceCents: parsePriceCents(text) as number });
  }
  const mirror = activeRate !== null ? computeMirror({ rateBps: activeRate, subscriptions: valid }) : null;
  const canSave = !busy && invalid === 0 && activeRate !== null;

  const toggle = (serviceId: string) => {
    touch();
    setPrices((current) => {
      const next = { ...current };
      if (serviceId in next) delete next[serviceId];
      else next[serviceId] = "";
      return next;
    });
  };

  const save = async () => {
    if (activeRate === null) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await appStore.savePlan({ rateBps: activeRate, subscriptions: valid });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.fields) setFieldErrors(e.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rise grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
      <div>
        <h1 className="display text-[clamp(2.2rem,5vw,3.25rem)] font-semibold">Your subscriptions</h1>
        <p className="mt-3 max-w-[40rem] text-[1.0625rem] leading-relaxed text-ink-soft">
          Tick what you pay for and type the monthly price from your own bill. mirror does not look anything up.
        </p>

        <div className="mt-7 space-y-4">
          {COMPANIES.map((company) => (
            <fieldset key={company.ticker} className="card p-5">
              <legend className="sr-only">{company.company}</legend>
              <div className="flex items-center gap-3" aria-hidden="true">
                <span className="tile h-10 min-w-10 px-2.5 text-[0.875rem] font-bold">{company.ticker}</span>
                <span className="font-display text-[1.3rem] font-semibold tracking-[-0.02em]">{company.company}</span>
              </div>
              <ul className="mt-3 divide-y divide-line-soft">
                {company.services.map((service) => {
                  const on = service.id in prices;
                  const text = prices[service.id] ?? "";
                  const problem = on && text !== "" ? priceProblem(text) : null;
                  const serverProblem = fieldErrors[service.id];
                  return (
                    <li key={service.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 text-[1.0625rem] font-medium">
                          <input type="checkbox" className="peer sr-only" checked={on} onChange={() => toggle(service.id)} />
                          <span
                            className={`grid size-7 shrink-0 place-items-center rounded-[9px] transition-colors peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet ${
                              on ? "bg-violet text-white" : "bg-surface shadow-[inset_0_0_0_1.5px_var(--color-line)]"
                            }`}
                          >
                            {on && <CheckIcon className="size-4" />}
                          </span>
                          {service.name}
                        </label>
                        {on && (
                          <label className="flex items-center gap-2 text-[1rem] text-ink-soft">
                            <span className="sr-only">{service.name} monthly price in US dollars</span>
                            <span aria-hidden="true">$</span>
                            <input
                              className="field !w-[7rem] text-right"
                              inputMode="decimal"
                              autoComplete="off"
                              placeholder="0.00"
                              value={text}
                              aria-invalid={!!problem || !!serverProblem}
                              onChange={(event) => {
                                touch();
                                setPrices((current) => ({ ...current, [service.id]: event.target.value }));
                              }}
                            />
                            <span aria-hidden="true">/ month</span>
                          </label>
                        )}
                      </div>
                      {(problem || serverProblem) && (
                        <p role="alert" className="mt-1 text-right text-[0.9375rem] font-medium text-bad">
                          {serverProblem ?? problem}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
        </div>
      </div>

      <aside className="card p-6 lg:sticky lg:top-6">
        <h2 className="font-display text-[1.5rem] font-semibold tracking-[-0.025em]">Mirror rate</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="seg !shadow-none ring-1 ring-line-soft" role="group" aria-label="Mirror rate">
            {RATE_PRESETS_BPS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={!custom && preset === rateBps}
                onClick={() => {
                  touch();
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
              className="field !min-h-[2.6rem] !w-[4.75rem] text-center"
              inputMode="decimal"
              autoComplete="off"
              value={custom}
              placeholder="15"
              aria-label="Custom mirror rate in percent"
              aria-invalid={(custom !== "" && !customOk) || !!fieldErrors.rate}
              onChange={(event) => {
                touch();
                setCustom(event.target.value);
              }}
            />
            %
          </label>
        </div>
        {custom !== "" && !customOk && (
          <p role="alert" className="mt-2 text-[0.9375rem] font-medium text-bad">
            Between {formatRate(MIN_RATE_BPS)} and {formatRate(MAX_RATE_BPS)}, up to two decimals.
          </p>
        )}

        <h2 className="mt-7 font-display text-[1.5rem] font-semibold tracking-[-0.025em]">Each month</h2>
        {mirror && mirror.lines.length > 0 ? (
          <>
            <ul className="mt-3 divide-y divide-line-soft">
              {mirror.lines.map((line) => (
                <li key={line.ticker} className="flex items-baseline justify-between gap-3 py-2.5 text-[1.0625rem]">
                  <span>
                    <span className="font-semibold">{line.ticker}</span>{" "}
                    <span className="text-ink-soft">{line.company}</span>
                  </span>
                  <span className={`font-semibold tabular-nums ${line.belowMinimum ? "text-ink-faint line-through" : ""}`}>{formatUsd(line.amountMicro)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-[1.0625rem] font-medium">Total</span>
              <span className="display text-[2rem] tabular-nums">{formatUsd(mirror.totalMicro)}</span>
            </div>
            {mirror.lines.some((line) => line.belowMinimum) && (
              <p className="note note-warn mt-3">
                Amounts under {formatUsd(MIN_ORDER_MICRO)} are too small for the swap route and are skipped. A higher rate brings them in.
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-[1.0625rem] leading-relaxed text-ink-soft">
            Nothing yet. Tick a subscription and enter its price to see what each month would buy.
          </p>
        )}

        {error && (
          <p role="alert" className="note note-bad mt-4">
            {error}
          </p>
        )}
        <button type="button" className="btn btn-accent mt-5 w-full" disabled={!canSave} onClick={save}>
          {busy && <span className="spinner" />}
          Save
        </button>
        {saved && (
          <p role="status" className="note note-good mt-3">
            Saved.{" "}
            <Link href="/app/dashboard" className="link">
              See this month’s mirror
            </Link>
          </p>
        )}
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-soft">
          Saving buys nothing. Each month you approve the purchase yourself on the dashboard.
        </p>
      </aside>
    </div>
  );
}

export default function Setup() {
  const app = useApp();
  return (
    <SignInGate title="Mirror your subscriptions">
      {app.plan ? (
        <Editor key={app.session} plan={app.plan} />
      ) : app.error ? (
        <div className="card mx-auto max-w-[38rem] p-8 text-center">
          <p role="alert" className="note note-bad text-left">
            {app.error}
          </p>
          <button type="button" className="btn btn-quiet mt-5" onClick={() => appStore.refresh()}>
            Try again
          </button>
        </div>
      ) : null}
    </SignInGate>
  );
}
