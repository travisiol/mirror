"use client";

import { useSyncExternalStore } from "react";
import { CHAIN } from "@/config/network";

/**
 * Wallet discovery (EIP-6963) and the few wallet calls the app needs.
 * No wallet library: the surface is small and stays readable.
 */

interface Eip1193 {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface DiscoveredWallet {
  id: string;
  name: string;
  icon: string | null;
  provider: Eip1193;
}

export interface WalletState {
  wallets: DiscoveredWallet[];
  address: string | null;
  walletName: string | null;
  dialogOpen: boolean;
}

const REMEMBER_KEY = "mirror.wallet";
const SERVER_STATE: WalletState = { wallets: [], address: null, walletName: null, dialogOpen: false };

let state: WalletState = SERVER_STATE;
let active: Eip1193 | null = null;
let started = false;
const listeners = new Set<() => void>();

function set(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(REMEMBER_KEY, id);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // storage unavailable — the connection simply is not remembered
  }
}

function attach(wallet: DiscoveredWallet, address: string) {
  active = wallet.provider;
  set({ address: address.toLowerCase(), walletName: wallet.name });
  wallet.provider.on?.("accountsChanged", (accounts) => {
    if (active !== wallet.provider) return;
    const next = (accounts as string[])[0];
    if (next) set({ address: next.toLowerCase() });
    else disconnectWallet();
  });
}

function addWallet(wallet: DiscoveredWallet) {
  if (state.wallets.some((w) => w.id === wallet.id)) return;
  set({ wallets: [...state.wallets, wallet] });
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(REMEMBER_KEY);
  } catch {
    remembered = null;
  }
  if (remembered === wallet.id && !state.address) {
    // Silent restore: eth_accounts never opens a prompt.
    wallet.provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        const first = (accounts as string[])[0];
        if (first && !state.address) attach(wallet, first);
      })
      .catch(() => {});
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = (event as CustomEvent).detail as {
      info: { uuid: string; name: string; icon?: string; rdns?: string };
      provider: Eip1193;
    };
    if (!detail?.provider || !detail.info) return;
    addWallet({
      id: detail.info.rdns || detail.info.uuid,
      name: detail.info.name,
      icon: detail.info.icon ?? null,
      provider: detail.provider,
    });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  // Older wallets only inject window.ethereum.
  window.setTimeout(() => {
    const legacy = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (legacy && state.wallets.length === 0) addWallet({ id: "injected", name: "Browser wallet", icon: null, provider: legacy });
  }, 400);
}

export function useWallet(): WalletState {
  return useSyncExternalStore(
    (listener) => {
      start();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => SERVER_STATE,
  );
}

export function openWalletDialog() {
  start();
  set({ dialogOpen: true });
}

export function closeWalletDialog() {
  set({ dialogOpen: false });
}

export async function connectWallet(wallet: DiscoveredWallet): Promise<string> {
  const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts[0]) throw new Error("The wallet returned no account.");
  attach(wallet, accounts[0]);
  remember(wallet.id);
  return accounts[0].toLowerCase();
}

export function disconnectWallet() {
  active = null;
  remember(null);
  set({ address: null, walletName: null });
}

export function isUserRejection(error: unknown): boolean {
  return (error as { code?: number })?.code === 4001;
}

export function walletErrorMessage(error: unknown): string {
  const code = (error as { code?: number })?.code;
  if (code === 4001) return "Request declined in your wallet.";
  if (code === -32002) return "Your wallet already has a request open. Check it.";
  return (error as { shortMessage?: string; message?: string })?.shortMessage ?? "The wallet request failed.";
}

function toHex(text: string): string {
  return `0x${Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function signMessage(message: string): Promise<string> {
  if (!active || !state.address) throw new Error("Connect a wallet first.");
  return (await active.request({ method: "personal_sign", params: [toHex(message), state.address] })) as string;
}

/** Make sure the wallet is on the configured chain before a transaction. */
export async function ensureChain(): Promise<void> {
  if (!active) throw new Error("Connect a wallet first.");
  const chainId = `0x${CHAIN.id.toString(16)}`;
  const current = (await active.request({ method: "eth_chainId" }).catch(() => null)) as string | null;
  if (current && Number(current) === CHAIN.id) return;
  try {
    await active.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if ((error as { code?: number })?.code !== 4902) throw error;
    await active.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: CHAIN.name,
          rpcUrls: [CHAIN.rpcUrl],
          blockExplorerUrls: [CHAIN.explorerUrl],
          nativeCurrency: CHAIN.nativeCurrency,
        },
      ],
    });
  }
}

/** Ask the wallet to sign and send. Never attaches ETH: a mirror only moves USDG. */
export async function sendTransaction(to: string, data: string): Promise<string> {
  if (!active || !state.address) throw new Error("Connect a wallet first.");
  return (await active.request({ method: "eth_sendTransaction", params: [{ from: state.address, to, data, value: "0x0" }] })) as string;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
