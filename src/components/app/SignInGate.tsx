"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ApiError, appStore, useApp } from "@/lib/app-store";
import { openWalletDialog, shortAddress, useWallet, walletErrorMessage } from "@/lib/wallet";
import { LogoMark } from "../Logo";

export function Skeleton() {
  return (
    <div className="mx-auto max-w-[62rem] animate-pulse space-y-5" aria-busy="true" aria-label="Loading">
      <div className="h-14 w-2/3 rounded-2xl bg-line-soft" />
      <div className="h-6 w-1/2 rounded-xl bg-line-soft" />
      <div className="h-64 rounded-[24px] bg-line-soft" />
    </div>
  );
}

/**
 * Everything under /app needs a session. Without one this shows the connect
 * and sign-in screen — never placeholder content.
 */
export function SignInGate({ title, children }: { title: string; children: ReactNode }) {
  const app = useApp();
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!app.ready) return <Skeleton />;

  const switched = app.session && wallet.address && wallet.address !== app.session;
  if (app.session && !switched) return <>{children}</>;

  const signIn = async () => {
    if (!wallet.address) return openWalletDialog();
    setBusy(true);
    setError(null);
    try {
      if (app.session) await appStore.signOut();
      await appStore.signIn(wallet.address);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card rise mx-auto max-w-[38rem] p-[clamp(1.5rem,4vw,2.75rem)] text-center">
      <LogoMark className="mx-auto size-14 text-violet" />
      <h1 className="display mt-6 text-[clamp(2rem,5vw,2.75rem)] font-semibold">{title}</h1>
      <p className="mx-auto mt-4 max-w-[30rem] text-[1.0625rem] leading-relaxed text-ink-soft">
        {switched
          ? `Your wallet changed to ${shortAddress(wallet.address as string)}. Each wallet has its own subscriptions and history, so sign in with this one to continue.`
          : wallet.address
            ? "Your subscriptions and history are saved for your wallet address only. Sign a one-time message to open them — it costs no gas and moves no funds."
            : "Connect the wallet you want your stock tokens to arrive in. Nothing is bought until you approve a month yourself."}
      </p>

      {(error || (app.error && !app.session)) && (
        <p role="alert" className="note note-bad mt-5 text-left">
          {error ?? app.error}
        </p>
      )}
      {!app.signInAvailable && (
        <p role="alert" className="note note-warn mt-5 text-left">
          Sign-in is not configured on this server.
        </p>
      )}

      <button type="button" className="btn btn-accent mt-7" disabled={busy || !app.signInAvailable} onClick={signIn}>
        {busy && <span className="spinner" />}
        {wallet.address ? `Sign in as ${shortAddress(wallet.address)}` : "Connect wallet"}
      </button>
    </section>
  );
}
