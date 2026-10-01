"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_RATE_BPS, RATE_PRESETS_BPS } from "@/config/mirror-policy";
import { formatCents, formatRate, formatUsd, mirrorAmountMicro } from "@/core/mirror";
import { Logo } from "../Logo";
import { WalletButton } from "../WalletDialog";
import { ArrowUpRight, CardIcon, ChartIcon, ClipboardIcon, HouseIcon, KeyIcon, SlidersIcon } from "../icons";
import { SplitDisc } from "./SplitDisc";

/** The price on the "You pay" card. The visitor's own prices are entered in the app. */
const PAY_CENTS = 1549;

/** Counts from the previous amount to the new one when the rate changes. */
function useTween(target: number): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      const id = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(id);
    }
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - began) / 420);
      const eased = 1 - (1 - p) ** 3;
      const current = Math.round(start + (target - start) * eased);
      from.current = current;
      setValue(current);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

const STEPS = [
  { n: "01", label: "List your subscriptions", icons: [ClipboardIcon] },
  { n: "02", label: "Pick your mirror rate", icons: [SlidersIcon] },
  { n: "03", label: "Own what you pay for", icons: [KeyIcon, HouseIcon] },
];

export function Hero() {
  const [rateBps, setRateBps] = useState<number>(DEFAULT_RATE_BPS);
  const micro = Number(mirrorAmountMicro(PAY_CENTS, rateBps));
  const shown = useTween(micro);

  return (
    <section className="panel hero">
      <header className="hero-header">
        <Logo />
        <nav aria-label="Main" className="hero-nav">
          <a href="#how">How it works</a>
          <a href="#stocks">Stocks</a>
          <WalletButton className="btn btn-accent" />
        </nav>
      </header>

      <h1 className="hero-title font-display">
        Pay Netflix.
        <br />
        Own Netflix.
      </h1>
      <p className="hero-sub">Turn the subscriptions you pay into tokenized stock.</p>
      <div className="hero-cta">
        <Link href="/app" className="btn btn-accent">
          Mirror my subscriptions
        </Link>
        <a href="#how" className="hero-link">
          <span>See how it works</span>
          <ArrowUpRight style={{ width: "1.05em", height: "1.05em" }} />
        </a>
      </div>

      <div className="hero-stage">
        <div className="card hero-card hero-pay">
          <CardIcon />
          <p className="k">You pay</p>
          <p className="v">{formatCents(PAY_CENTS)}</p>
          <p className="s">Netflix</p>
        </div>
        <div className="hero-wire" aria-hidden="true" />
        <SplitDisc pulse={rateBps} />
        <div className="hero-wire" aria-hidden="true" />
        <div className="card hero-card hero-invest">
          <ChartIcon />
          <p className="k">You invest</p>
          <p className="v" aria-live="polite">
            {formatUsd(BigInt(shown))}
          </p>
          <p className="s">{formatRate(rateBps)} mirror rate</p>
          <div className="seg hero-rate" role="group" aria-label="Mirror rate">
            {RATE_PRESETS_BPS.map((preset) => (
              <button key={preset} type="button" aria-pressed={preset === rateBps} onClick={() => setRateBps(preset)}>
                {formatRate(preset)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="hero-rule" />
      <ol className="hero-steps">
        {STEPS.map((step) => (
          <li key={step.n} className="card hero-step">
            <span className="tile">
              {step.icons.map((Icon, i) => (
                <Icon key={i} />
              ))}
            </span>
            {step.label}
            <span className="n">{step.n}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
