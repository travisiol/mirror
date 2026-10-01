import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Stroke({ children, viewBox = "0 0 24 24", ...props }: IconProps) {
  return (
    <svg viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

/** Bank card — the "You pay" card. */
export const CardIcon = (props: IconProps) => (
  <Stroke viewBox="0 0 42 34" strokeWidth={2.4} {...props}>
    <rect x="2" y="3" width="38" height="28" rx="5" />
    <path d="M2 11.5h38" strokeWidth={4.4} strokeLinecap="butt" />
    <path d="M9 23h9" />
  </Stroke>
);

/** Rising bars — the "You invest" card. The bars carry the accent. */
export const ChartIcon = (props: IconProps) => (
  <Stroke viewBox="0 0 42 34" strokeWidth={2.2} {...props}>
    <rect x="3" y="23" width="7" height="8" rx="1.6" fill="var(--color-lilac)" />
    <rect x="15" y="17" width="7" height="14" rx="1.6" fill="var(--color-lilac)" />
    <rect x="27" y="11" width="7" height="20" rx="1.6" fill="var(--color-lilac)" />
    <path d="M3 16 14 7l6 4.5L33 2" />
    <path d="M26 2h7v7" />
  </Stroke>
);

export const ClipboardIcon = (props: IconProps) => (
  <Stroke viewBox="0 0 30 30" strokeWidth={2} {...props}>
    <rect x="6" y="5" width="18" height="22" rx="3.5" />
    <rect x="11" y="2.5" width="8" height="5" rx="1.8" fill="var(--color-tile)" />
    <path d="M10.5 14h.01M10.5 18.5h.01M10.5 23h.01" strokeWidth={2.4} />
    <path d="M14 14h6M14 18.5h6M14 23h6" />
  </Stroke>
);

export const SlidersIcon = (props: IconProps) => (
  <Stroke viewBox="0 0 30 30" strokeWidth={1.9} {...props}>
    <path d="M4 8h10M20 8h6M4 15h4M14 15h12M4 22h12M22 22h4" />
    <circle cx="17" cy="8" r="2.7" />
    <circle cx="11" cy="15" r="2.7" />
    <circle cx="19" cy="22" r="2.7" />
  </Stroke>
);

export const KeyIcon = (props: IconProps) => (
  <Stroke viewBox="0 0 30 30" strokeWidth={1.9} {...props}>
    <circle cx="19.5" cy="10.5" r="6.5" />
    <circle cx="21.2" cy="8.8" r="1.2" />
    <path d="M14.6 15.4 4.5 25.5v-4m4.6.6-2.6-2.6m6.1-.9-2.6-2.6" />
  </Stroke>
);

export const HouseIcon = (props: IconProps) => (
  <Stroke viewBox="0 0 30 30" strokeWidth={1.9} {...props}>
    <path d="M4 14.5 15 5l11 9.5" />
    <path d="M7 12.5V25h16V12.5" />
    <path d="M12.5 25v-7h5v7" />
  </Stroke>
);

export const ArrowUpRight = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M6 18 18 6M8.5 6H18v9.5" />
  </Stroke>
);

export const CloseIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Stroke>
);

export const PlusIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M12 5v14M5 12h14" />
  </Stroke>
);

export const CheckIcon = (props: IconProps) => (
  <Stroke strokeWidth={2.4} {...props}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Stroke>
);

export const WalletIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3" />
    <rect x="4" y="8" width="16" height="11" rx="2.5" />
    <path d="M16 13.5h.01" strokeWidth={2.6} />
  </Stroke>
);

export const ExternalIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M10 6H6.5A1.5 1.5 0 0 0 5 7.5v10A1.5 1.5 0 0 0 6.5 19h10a1.5 1.5 0 0 0 1.5-1.5V14M13 5h6v6M19 5l-8 8" />
  </Stroke>
);
