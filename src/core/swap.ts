/**
 * The purchase route: a LI.FI quote for USDG → stock token, checked before
 * it reaches a wallet, and the confirmed transaction checked after.
 * Framework-free so the fork rehearsal (scripts/fork-buy.mjs) runs the very
 * same checks as the server.
 */
import { MAX_SLIPPAGE_BPS } from "../config/mirror-policy.ts";
import { CHAIN, LIFI, USDG } from "../config/network.ts";
import type { TokenConfig } from "../config/network.ts";

export class SwapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SwapError";
  }
}

export interface PreparedSwap {
  /** Always the LI.FI Diamond. */
  to: `0x${string}`;
  data: `0x${string}`;
  /** Estimated tokens out, base units. */
  toAmount: string;
  /** The least the swap can deliver without reverting, base units. */
  toAmountMin: string;
  /** The venue LI.FI routed through (e.g. "kyberswap"). */
  tool: string;
  /** Route fees taken from the USDG sent, base units. */
  feeMicro: string;
  slippageBps: number;
}

const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

export function quoteUrl(input: { wallet: string; token: TokenConfig; amountMicro: bigint }): string {
  const url = new URL(`${LIFI.apiUrl}/quote`);
  url.search = new URLSearchParams({
    fromChain: String(CHAIN.id),
    toChain: String(CHAIN.id),
    fromToken: USDG.address,
    toToken: input.token.address,
    fromAmount: input.amountMicro.toString(),
    fromAddress: input.wallet,
    toAddress: input.wallet,
    slippage: String(MAX_SLIPPAGE_BPS / 10_000),
    integrator: LIFI.integrator,
    allowExchanges: LIFI.exchanges.join(","),
  }).toString();
  return url.toString();
}

/**
 * Accept a quote only if it does exactly what was asked: this wallet's USDG,
 * this exact amount, this token, back to this wallet, through the known
 * contract, with no ETH attached.
 */
export function validateQuote(body: unknown, expected: { wallet: string; token: TokenConfig; amountMicro: bigint }): PreparedSwap {
  const quote = body as {
    tool?: string;
    action?: {
      fromToken?: { address?: string };
      toToken?: { address?: string };
      fromAmount?: string;
      fromChainId?: number;
      toChainId?: number;
      fromAddress?: string;
      toAddress?: string;
    };
    estimate?: { approvalAddress?: string; toAmount?: string; toAmountMin?: string; feeCosts?: { amount?: string; included?: boolean; token?: { address?: string } }[] };
    transactionRequest?: { to?: string; data?: string; value?: string; chainId?: number; from?: string };
  };
  const { action, estimate, transactionRequest: tx } = quote ?? {};
  if (!action || !estimate || !tx) throw new SwapError("The route returned an incomplete quote.");

  if (action.fromChainId !== CHAIN.id || action.toChainId !== CHAIN.id || tx.chainId !== CHAIN.id)
    throw new SwapError("The quote is for another network.");
  if (!same(action.fromToken?.address, USDG.address)) throw new SwapError("The quote does not spend USDG.");
  if (!same(action.toToken?.address, expected.token.address)) throw new SwapError("The quote buys a different token.");
  if (action.fromAmount !== expected.amountMicro.toString()) throw new SwapError("The quote is for a different amount.");
  if (!same(action.fromAddress, expected.wallet) || !same(action.toAddress, expected.wallet) || !same(tx.from, expected.wallet))
    throw new SwapError("The quote is for a different wallet.");
  if (!same(tx.to, LIFI.diamond) || !same(estimate.approvalAddress, LIFI.diamond))
    throw new SwapError("The quote points at an unknown contract.");
  if (typeof tx.data !== "string" || !/^0x[0-9a-fA-F]{8,}$/.test(tx.data)) throw new SwapError("The quote has no transaction data.");
  if (BigInt(tx.value ?? "0x0") !== BigInt(0)) throw new SwapError("The quote attaches ETH, which a mirror never does.");

  if (!LIFI.exchanges.includes(String(quote.tool))) throw new SwapError("The quote routes through a venue that is not allowed.");

  const toAmount = BigInt(estimate.toAmount ?? "0");
  const toAmountMin = BigInt(estimate.toAmountMin ?? "0");
  if (toAmountMin <= BigInt(0) || toAmount < toAmountMin) throw new SwapError("The quote delivers nothing.");
  // The floor may sit at most MAX_SLIPPAGE_BPS under the estimate.
  if (toAmountMin * BigInt(10_000) < toAmount * BigInt(10_000 - MAX_SLIPPAGE_BPS) - BigInt(10_000))
    throw new SwapError("The quote allows more slippage than the limit.");

  let fee = BigInt(0);
  for (const cost of estimate.feeCosts ?? []) {
    if (cost.included && same(cost.token?.address, USDG.address)) fee += BigInt(cost.amount ?? "0");
  }

  return {
    to: LIFI.diamond,
    data: tx.data as `0x${string}`,
    toAmount: toAmount.toString(),
    toAmountMin: toAmountMin.toString(),
    tool: String(quote.tool ?? "unknown"),
    feeMicro: fee.toString(),
    slippageBps: MAX_SLIPPAGE_BPS,
  };
}

// ───────────────────────────── after the transaction

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface ReceiptLike {
  status: "success" | "reverted" | string;
  from: string;
  to: string | null;
  logs: { address: string; topics: readonly string[]; data: string }[];
}

export type Settlement =
  | { ok: true; tokenReceived: bigint; usdgSpent: bigint }
  | { ok: false; reason: string };

const topicAddress = (topic: string | undefined) => (topic ? `0x${topic.slice(26)}`.toLowerCase() : "");

/** Net ERC-20 movement of `token` for `wallet` in a receipt (positive = received). */
export function netTransfer(receipt: ReceiptLike, token: string, wallet: string): bigint {
  let net = BigInt(0);
  const who = wallet.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== token.toLowerCase() || log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
    const value = BigInt(log.data === "0x" ? "0x0" : log.data.slice(0, 66));
    if (topicAddress(log.topics[2]) === who) net += value;
    if (topicAddress(log.topics[1]) === who) net -= value;
  }
  return net;
}

/**
 * Does a confirmed transaction really settle this purchase? It must come
 * from the wallet, go to the known contract, spend no more USDG than the
 * amount due, and deliver the token to the same wallet.
 */
export function settle(receipt: ReceiptLike, expected: { wallet: string; token: TokenConfig; amountMicro: bigint }): Settlement {
  if (receipt.status !== "success") return { ok: false, reason: "The transaction reverted. Nothing was bought." };
  if (!same(receipt.from, expected.wallet)) return { ok: false, reason: "That transaction was sent by another wallet." };
  if (!same(receipt.to, LIFI.diamond)) return { ok: false, reason: "That transaction is not a mirror purchase." };
  const usdgSpent = -netTransfer(receipt, USDG.address, expected.wallet);
  const tokenReceived = netTransfer(receipt, expected.token.address, expected.wallet);
  if (usdgSpent <= BigInt(0) || usdgSpent > expected.amountMicro)
    return { ok: false, reason: "That transaction does not spend this month's amount." };
  if (tokenReceived <= BigInt(0)) return { ok: false, reason: `That transaction delivered no ${expected.token.symbol}.` };
  return { ok: true, tokenReceived, usdgSpent };
}
