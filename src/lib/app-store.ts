"use client";

/**
 * Client for the session, the plan, this month's mirror and the wallet's
 * on-chain balances. A failure is shown as a failure — there is no
 * placeholder data anywhere.
 */
import { useSyncExternalStore } from "react";
import { encodeFunctionData, parseAbi } from "viem";
import { LIFI, USDG } from "@/config/network";
import type { HistoryEntry, MonthView } from "@/core/ledger";
import type { Subscription } from "@/core/mirror";
import type { PreparedSwap } from "@/core/swap";
import type { WalletView } from "@/server/chain";
import { ensureChain, isUserRejection, sendTransaction, signMessage } from "./wallet";

export interface PlanView {
  rateBps: number | null;
  subscriptions: Subscription[];
}

export interface AppState {
  ready: boolean;
  signInAvailable: boolean;
  session: string | null;
  plan: PlanView | null;
  month: MonthView | null;
  history: HistoryEntry[];
  wallet: WalletView | null;
  walletError: string | null;
  error: string | null;
}

const INITIAL: AppState = {
  ready: false,
  signInAvailable: true,
  session: null,
  plan: null,
  month: null,
  history: [],
  wallet: null,
  walletError: null,
  error: null,
};
let state = INITIAL;
let started = false;
const listeners = new Set<() => void>();

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export class ApiError extends Error {
  status: number;
  fields?: Record<string, string>;
  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
  if (!response.ok) {
    if (response.status === 401 && state.session) set({ ...INITIAL, ready: true, signInAvailable: state.signInAvailable });
    throw new ApiError(response.status, body.error ?? "The request failed.", body.fields);
  }
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadAccount() {
  if (!state.session) return;
  try {
    const [{ plan }, mirror] = await Promise.all([
      api<{ plan: PlanView }>("/api/plan"),
      api<{ month: MonthView; history: HistoryEntry[] }>("/api/mirror"),
    ]);
    set({ plan, month: mirror.month, history: mirror.history, error: null });
  } catch (error) {
    set({ error: (error as Error).message });
  }
}

async function loadWallet() {
  if (!state.session) return;
  try {
    const { wallet } = await api<{ wallet: WalletView }>("/api/wallet");
    set({ wallet, walletError: null });
  } catch (error) {
    set({ walletError: (error as Error).message });
  }
}

async function boot() {
  try {
    const me = await api<{ address: string | null; signIn: boolean }>("/api/auth/me");
    set({ session: me.address, signInAvailable: me.signIn, ready: true, error: null });
    await Promise.all([loadAccount(), loadWallet()]);
  } catch (error) {
    set({ ready: true, error: (error as Error).message });
  }
}

const ERC20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

/** What the purchase flow is doing, for the progress list. */
export type BuyStep =
  | { kind: "approve"; state: "wallet" | "mining" }
  | { kind: "swap"; ticker: string; state: "quote" | "wallet" | "mining" };

export const appStore = {
  subscribe(listener: () => void) {
    if (!started && typeof window !== "undefined") {
      started = true;
      void boot();
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot: () => state,
  serverSnapshot: () => INITIAL,
  refresh: () => Promise.all([loadAccount(), loadWallet()]),

  /** Prove control of the connected wallet by signing a one-time message. */
  async signIn(address: string) {
    const { nonce, issuedAt, message } = await api<{ nonce: string; issuedAt: string; message: string }>(
      "/api/auth/nonce",
      json("POST", { address }),
    );
    const signature = await signMessage(message);
    const { address: session } = await api<{ address: string }>("/api/auth/verify", json("POST", { address, nonce, issuedAt, signature }));
    set({ session });
    await Promise.all([loadAccount(), loadWallet()]);
  },

  async signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    set({ ...INITIAL, ready: true, signInAvailable: state.signInAvailable });
  },

  async savePlan(plan: { rateBps: number; subscriptions: Subscription[] }) {
    const saved = await api<{ plan: PlanView }>("/api/plan", json("PUT", plan));
    set({ plan: saved.plan });
    await loadAccount();
  },

  /** A live, server-checked quote for one line. Reserves the purchase until submitted or cancelled. */
  async quote(ticker: string) {
    return api<{ month: string; amountMicro: string; swap: PreparedSwap }>(`/api/mirror/${ticker}`, json("POST", { action: "quote" }));
  },

  async cancel(month: string, ticker: string) {
    const result = await api<{ month: MonthView }>(`/api/mirror/${ticker}`, json("POST", { action: "cancel", month }));
    set({ month: result.month });
  },

  /** Attach a transaction hash to a purchase that is waiting for one. */
  async submit(month: string, ticker: string, txHash: string) {
    const result = await api<{ month: MonthView }>(`/api/mirror/${ticker}`, json("POST", { action: "submit", month, txHash }));
    set({ month: result.month });
  },

  /** Ask the server to check the chain once. */
  async confirm(month: string, ticker: string) {
    const result = await api<{ status: string; month: MonthView; history: HistoryEntry[] }>(
      `/api/mirror/${ticker}`,
      json("POST", { action: "confirm", month }),
    );
    set({ month: result.month, history: result.history });
    return result.status;
  },

  /** Poll until the chain has decided. Returns the final status, or "submitted" if it is still open. */
  async waitConfirmed(month: string, ticker: string, tries = 60) {
    for (let i = 0; i < tries; i++) {
      const status = await appStore.confirm(month, ticker).catch(() => "submitted");
      if (status !== "submitted") return status;
      await sleep(2000);
    }
    return "submitted";
  },

  /**
   * Approve the exact USDG amount for the swap contract — never more.
   * Resolves once the chain shows the allowance.
   */
  async approveExact(amountMicro: bigint, onStep: (step: BuyStep) => void) {
    await ensureChain();
    onStep({ kind: "approve", state: "wallet" });
    await sendTransaction(USDG.address, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [LIFI.diamond, amountMicro] }));
    onStep({ kind: "approve", state: "mining" });
    for (let i = 0; i < 60; i++) {
      await sleep(1500);
      await loadWallet();
      if (state.wallet && BigInt(state.wallet.allowance) >= amountMicro) return;
    }
    throw new ApiError(0, "The approval has not confirmed yet. Wait a moment and try again.");
  },

  /**
   * Buy one line: quote → wallet signature → record the hash → wait for the
   * chain. The line only becomes "confirmed" from what the server reads on chain.
   */
  async buy(ticker: string, onStep: (step: BuyStep) => void, onQuote: (swap: PreparedSwap) => void): Promise<string> {
    onStep({ kind: "swap", ticker, state: "quote" });
    const { month, swap } = await appStore.quote(ticker);
    onQuote(swap);
    let txHash: string;
    try {
      await ensureChain();
      onStep({ kind: "swap", ticker, state: "wallet" });
      txHash = await sendTransaction(swap.to, swap.data);
    } catch (error) {
      // A clear refusal means nothing was sent: release the purchase. Any other
      // error leaves it locked — the wallet may still have sent the transaction.
      if (isUserRejection(error)) await appStore.cancel(month, ticker).catch(() => {});
      else await loadAccount();
      throw error;
    }
    await appStore.submit(month, ticker, txHash);
    onStep({ kind: "swap", ticker, state: "mining" });
    const status = await appStore.waitConfirmed(month, ticker);
    await loadWallet();
    return status;
  },
};

export function useApp(): AppState {
  return useSyncExternalStore(appStore.subscribe, appStore.snapshot, appStore.serverSnapshot);
}
