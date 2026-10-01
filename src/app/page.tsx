import Link from "next/link";
import { Calculator } from "@/components/home/Calculator";
import { Hero } from "@/components/home/Hero";
import { Stocks } from "@/components/home/Stocks";
import { Logo } from "@/components/Logo";
import { PlusIcon } from "@/components/icons";
import { BRAND } from "@/config/brand";
import { MAX_SLIPPAGE_BPS } from "@/config/mirror-policy";
import { CHAIN } from "@/config/network";

const HOW = [
  {
    n: "01",
    title: "List your subscriptions",
    body: "Pick what you pay for from the catalogue and type the monthly price yourself. mirror never looks at your bank or your accounts — it only knows what you tell it.",
  },
  {
    n: "02",
    title: "Pick your mirror rate",
    body: "5%, 10%, 25% or your own number. The rate times each price is the amount that goes into that company’s stock token each month.",
  },
  {
    n: "03",
    title: "Own what you pay for",
    body: "Once a month you review “This month’s mirror” and sign it in your wallet. Your USDG buys the tokens, and they land in your wallet — not ours.",
  },
];

const FACTS = [
  {
    title: "Tokens, not shares",
    body: "A mirror buys Robinhood Stock Tokens: ERC-20 tokens that track a stock’s price. They are issued by Robinhood Assets (Jersey) Limited and are not conventional shares.",
  },
  {
    title: "Their value can fall",
    body: "A stock token moves with its stock. What you buy can be worth less later, including less than you paid. mirror gives no investment advice.",
  },
  {
    title: "No partnership",
    body: "Netflix, Amazon, Alphabet, Apple, Microsoft, Adobe, Roblox and Zoom are not partners or sponsors of mirror and do not endorse it.",
  },
  {
    title: "Not available everywhere",
    body: "Stock Tokens may not be offered or sold in the United States or to U.S. persons, and are restricted in other places, including Canada, the United Kingdom and Switzerland. Check the rules where you live first.",
  },
];

const FAQ = [
  {
    q: "Does mirror take money automatically?",
    a: "No. Nothing is ever pulled from your wallet on a schedule. Each month you open the dashboard, review the amounts and sign the purchase yourself. If you do nothing, nothing happens.",
  },
  {
    q: "How does mirror know my subscriptions?",
    a: "It doesn’t. You choose them from the catalogue and enter the price you pay. You can change or remove them at any time.",
  },
  {
    q: "What exactly do I sign?",
    a: `First a free message that opens your session. Then, each month, one approval for the exact USDG total — never an unlimited one — and one swap per company. Before you sign, you see the minimum you will receive; a swap that would slip more than ${MAX_SLIPPAGE_BPS / 100}% below its quote fails instead of filling.`,
  },
  {
    q: "What do I need in my wallet?",
    a: `USDG to buy with and a little ETH for network fees, both on ${CHAIN.name}.`,
  },
  {
    q: "Who holds the tokens?",
    a: "You do. Swaps go from your wallet to your wallet through the LI.FI router. mirror has no custody and no private key of yours.",
  },
  {
    q: "Why can’t I add a service that isn’t listed?",
    a: "A service appears only if its company has an official Robinhood Stock Token and a real purchase route for it was verified. Others are left out rather than approximated.",
  },
];

export default function Home() {
  return (
    <main className="pb-10">
      <Hero />

      <div className="panel section-panel">
        <section id="how" className="shell scroll-mt-10">
          <p className="eyebrow">How it works</p>
          <h2 className="h2 mt-3 max-w-[18ch]">A small share of every bill, in the company that sent it.</h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {HOW.map((step) => (
              <li key={step.n} className="card p-6">
                <span className="text-[0.9375rem] font-medium text-ink-faint tabular-nums">{step.n}</span>
                <h3 className="mt-3 font-display text-[1.5rem] leading-tight font-semibold tracking-[-0.025em]">{step.title}</h3>
                <p className="mt-3 text-[1.0625rem] leading-relaxed text-ink-soft">{step.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-[clamp(3rem,7vw,5.5rem)] grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
            <div>
              <p className="eyebrow">The mirror, in numbers</p>
              <h2 className="h2 mt-3">Price × rate. That’s the whole formula.</h2>
              <p className="lede mt-5">
                Try it with your own bill. The amount is exact to a fraction of a cent, and it is the amount you will be
                asked to sign — no rounding up, no fee added by mirror.
              </p>
              <p className="mt-4 text-[1.0625rem] leading-relaxed text-ink-soft">
                The swap route takes its own fee out of the amount and you pay the network fee in ETH; both are shown
                before you sign.
              </p>
            </div>
            <Calculator />
          </div>
        </section>

        <section id="stocks" className="shell mt-[clamp(3.5rem,8vw,6.5rem)] scroll-mt-10">
          <p className="eyebrow">Stocks</p>
          <h2 className="h2 mt-3 max-w-[20ch]">Twelve subscriptions, eight companies you can own a piece of.</h2>
          <p className="lede mt-5 max-w-[46rem]">
            Each service maps to the stock token of the company behind it. Several services of one company add up to a
            single monthly purchase.
          </p>
          <div className="mt-9">
            <Stocks />
          </div>
        </section>

        <section className="shell mt-[clamp(3.5rem,8vw,6.5rem)]" aria-labelledby="know">
          <h2 id="know" className="h2 max-w-[16ch]">
            What you should know first.
          </h2>
          <ul className="mt-9 grid gap-4 sm:grid-cols-2">
            {FACTS.map((fact) => (
              <li key={fact.title} className="card-flat p-6">
                <h3 className="text-[1.1875rem] font-semibold tracking-[-0.01em]">{fact.title}</h3>
                <p className="mt-2 text-[1.0625rem] leading-relaxed text-ink-soft">{fact.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="shell faq mt-[clamp(3.5rem,8vw,6.5rem)]" aria-labelledby="faq">
          <h2 id="faq" className="h2">
            Questions
          </h2>
          <div className="mt-8 divide-y divide-line border-y border-line">
            {FAQ.map((item) => (
              <details key={item.q} className="group">
                <summary className="flex items-center justify-between gap-6 py-5 text-[1.1875rem] font-semibold tracking-[-0.01em]">
                  {item.q}
                  <span className="tile faq-plus size-9 shrink-0">
                    <PlusIcon className="size-4" />
                  </span>
                </summary>
                <p className="max-w-[48rem] pb-6 text-[1.0625rem] leading-relaxed text-ink-soft">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="shell mt-[clamp(3.5rem,8vw,6rem)] text-center">
          <h2 className="h2 mx-auto max-w-[14ch]">Pay for it. Own a piece of it.</h2>
          <Link href="/app" className="btn btn-accent mt-8">
            Mirror my subscriptions
          </Link>
        </section>

        <footer className="shell mt-[clamp(3.5rem,8vw,6rem)] border-t border-line pt-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Logo />
            <nav aria-label="Footer" className="flex flex-wrap gap-x-7 gap-y-2 text-[1rem] font-medium">
              <a href="#how" className="hover:underline">
                How it works
              </a>
              <a href="#stocks" className="hover:underline">
                Stocks
              </a>
              <Link href="/app" className="hover:underline">
                Open the app
              </Link>
              {BRAND.contactEmail && (
                <a href={`mailto:${BRAND.contactEmail}`} className="hover:underline">
                  Contact
                </a>
              )}
            </nav>
          </div>
          <p className="mt-6 max-w-[60rem] text-[0.9375rem] leading-relaxed text-ink-soft">
            mirror is a tool for buying Robinhood Stock Tokens on {CHAIN.name} with your own wallet. Stock tokens are
            not conventional shares, their value can go down, and they are not available in some countries. mirror is not
            affiliated with, sponsored by or endorsed by Robinhood or any company named on this site. Nothing here is
            investment advice.
          </p>
        </footer>
      </div>
    </main>
  );
}
