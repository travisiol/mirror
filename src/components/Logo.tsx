import Link from "next/link";

/** A circle cut in two — the same object as the hero disc, flat. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="currentColor">
      <path d="M13.6 1.2A15 15 0 0 0 13.6 30.8Z" />
      <path d="M18.4 1.2A15 15 0 0 1 18.4 30.8Z" />
    </svg>
  );
}

export function Logo({ href = "/", className = "" }: { href?: string; className?: string }) {
  return (
    <Link href={href} aria-label="mirror home" className={`logo inline-flex items-center rounded-lg text-ink-deep ${className}`}>
      <span className="font-display font-bold tracking-[-0.045em]">mirror</span>
      <LogoMark className="logo-mark" />
    </Link>
  );
}
