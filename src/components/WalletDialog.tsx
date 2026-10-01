"use client";

import { useState } from "react";
import { CHAIN } from "@/config/network";
import {
  closeWalletDialog,
  connectWallet,
  disconnectWallet,
  openWalletDialog,
  shortAddress,
  useWallet,
  walletErrorMessage,
} from "@/lib/wallet";
import type { DiscoveredWallet } from "@/lib/wallet";
import { Modal } from "./Modal";
import { WalletIcon } from "./icons";

export function WalletDialog() {
  const wallet = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    closeWalletDialog();
  };

  const connect = async (candidate: DiscoveredWallet) => {
    setBusy(candidate.id);
    setError(null);
    try {
      await connectWallet(candidate);
      close();
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={wallet.dialogOpen} onClose={close} title={wallet.address ? "Your wallet" : "Connect a wallet"}>
      {wallet.address ? (
        <div className="space-y-5">
          <div className="card flex items-center gap-4 p-5">
            <span className="tile size-12">
              <WalletIcon className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="text-lg font-semibold tabular-nums">{shortAddress(wallet.address)}</p>
              <p className="text-[0.9375rem] text-ink-soft">Connected with {wallet.walletName}</p>
            </div>
          </div>
          <p className="text-[0.9375rem] leading-relaxed text-ink-soft">
            Purchases settle on {CHAIN.name}. Connecting only shares your address — nothing moves until you sign a
            transaction yourself.
          </p>
          <button
            type="button"
            className="btn btn-quiet w-full"
            onClick={() => {
              disconnectWallet();
              close();
            }}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[0.9375rem] leading-relaxed text-ink-soft">
            Your wallet is how you sign in, and where the stock tokens you buy arrive.
          </p>
          {wallet.wallets.length > 0 ? (
            <ul className="space-y-2.5">
              {wallet.wallets.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => connect(candidate)}
                    className="card flex w-full items-center gap-4 p-4 text-left transition-transform hover:-translate-y-0.5 disabled:opacity-60"
                  >
                    {candidate.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element -- wallet-provided data URI
                      <img src={candidate.icon} alt="" className="size-10 rounded-xl" />
                    ) : (
                      <span className="tile size-10">
                        <WalletIcon className="size-5" />
                      </span>
                    )}
                    <span className="flex-1 text-lg font-semibold">{candidate.name}</span>
                    {busy === candidate.id ? <span className="spinner" /> : <span className="text-[0.9375rem] text-ink-soft">Detected</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="card-flat p-5">
              <p className="font-semibold">No wallet detected in this browser</p>
              <p className="mt-1 text-[0.9375rem] leading-relaxed text-ink-soft">
                Install a browser wallet that supports {CHAIN.name}, then reopen this window.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="note note-bad">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

export function WalletButton({ className = "btn btn-accent" }: { className?: string }) {
  const wallet = useWallet();
  return (
    <button type="button" className={className} onClick={openWalletDialog}>
      {wallet.address ? (
        <>
          <span className="size-2 rounded-full bg-white" aria-hidden="true" />
          <span className="tabular-nums">{shortAddress(wallet.address)}</span>
        </>
      ) : (
        "Connect wallet"
      )}
    </button>
  );
}
