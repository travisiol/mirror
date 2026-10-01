"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "../Logo";
import { WalletButton } from "../WalletDialog";

const NAV = [
  { href: "/app", label: "Subscriptions" },
  { href: "/app/dashboard", label: "Dashboard" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto w-[min(100%-1.25rem,78rem)] py-[clamp(0.6rem,2.5vw,2.5rem)]">
      <div className="panel px-[clamp(1rem,3.2vw,2.25rem)] pt-4 pb-[clamp(1.5rem,4vw,3rem)]">
        <header className="flex min-h-[3.25rem] flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Logo />
          <nav aria-label="App" className="seg order-3 w-full sm:order-none sm:w-auto">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className="flex-1 !px-5 !py-2 text-center !text-[1rem]">
                {item.label}
              </Link>
            ))}
          </nav>
          <WalletButton className="btn btn-accent btn-sm" />
        </header>

        <main className="mt-[clamp(1.75rem,4vw,3rem)]">{children}</main>

        <footer className="mt-[clamp(2.5rem,5vw,4rem)] border-t border-line pt-5 text-[0.9375rem] leading-relaxed text-ink-soft">
          Stock tokens are not conventional shares and their value can go down. They are not available in some
          countries, including the United States. The companies named are not partners or sponsors of mirror. Nothing
          is bought without a signature from your wallet.
        </footer>
      </div>
    </div>
  );
}
