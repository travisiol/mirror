import "server-only";
import { createPublicClient, http, parseAbi } from "viem";
import { CHAIN, LIFI, PRICE_API, PURCHASE_CONFIRMATIONS, STOCK_TOKENS, USDG } from "@/config/network";
import type { ChainAdapter } from "@/core/ledger";
import { LedgerError } from "@/core/ledger";
import { quoteUrl, settle, SwapError, validateQuote } from "@/core/swap";
import type { PreparedSwap } from "@/core/swap";

/**
 * Everything the server reads from the outside world: the chain (read
 * only — the server holds no key and sends nothing), the swap route's quote
 * API and Robinhood's price API.
 */
const client = createPublicClient({
  transport: http(process.env.RPC_URL || CHAIN.rpcUrl, { batch: { wait: 10 }, timeout: 20_000 }),
});

const TOKEN_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function uiMultiplier() view returns (uint256)",
]);

export interface WalletView {
  block: number;
  eth: string;
  usdg: string;
  /** USDG the swap contract may currently pull from this wallet. */
  allowance: string;
  holdings: { ticker: string; raw: string; uiMultiplier: string }[];
}

/** Balances of one wallet, straight from the chain. Raw base units, as strings. */
export async function readWallet(address: string): Promise<WalletView> {
  const owner = address as `0x${string}`;
  const tokens = Object.values(STOCK_TOKENS);
  try {
    const [block, eth, usdg, allowance, ...rest] = await Promise.all([
      client.getBlockNumber(),
      client.getBalance({ address: owner }),
      client.readContract({ address: USDG.address, abi: TOKEN_ABI, functionName: "balanceOf", args: [owner] }),
      client.readContract({ address: USDG.address, abi: TOKEN_ABI, functionName: "allowance", args: [owner, LIFI.diamond] }),
      ...tokens.map((token) => client.readContract({ address: token.address, abi: TOKEN_ABI, functionName: "balanceOf", args: [owner] })),
      ...tokens.map((token) => client.readContract({ address: token.address, abi: TOKEN_ABI, functionName: "uiMultiplier" })),
    ]);
    return {
      block: Number(block),
      eth: eth.toString(),
      usdg: usdg.toString(),
      allowance: allowance.toString(),
      holdings: tokens.map((token, i) => ({
        ticker: token.symbol,
        raw: String(rest[i]),
        uiMultiplier: String(rest[tokens.length + i]),
      })),
    };
  } catch {
    throw new LedgerError(502, `Could not read ${CHAIN.name} right now. Try again in a moment.`);
  }
}

/** A live quote for exactly this purchase, already checked. */
export async function fetchQuote(input: { wallet: string; ticker: string; amountMicro: bigint }): Promise<PreparedSwap> {
  const token = STOCK_TOKENS[input.ticker];
  let body: unknown;
  let ok = false;
  let limited = false;
  // Without a key LI.FI allows only a small number of quotes per hour per IP.
  const key = process.env.LIFI_API_KEY;
  try {
    const response = await fetch(quoteUrl({ wallet: input.wallet, token, amountMicro: input.amountMicro }), {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: key ? { "x-lifi-api-key": key } : undefined,
    });
    ok = response.ok;
    limited = response.status === 429;
    body = await response.json();
  } catch {
    throw new LedgerError(502, "The swap route did not answer. Nothing was sent — try again.");
  }
  if (limited) throw new LedgerError(503, "The swap route is rate-limiting quotes right now. Nothing was sent — try again later.");
  if (!ok) throw new LedgerError(502, `No route can buy ${input.ticker} right now. Nothing was sent — try again later.`);
  try {
    return validateQuote(body, { wallet: input.wallet, token, amountMicro: input.amountMicro });
  } catch (error) {
    if (error instanceof SwapError) throw new LedgerError(502, `${error.message} Nothing was sent.`);
    throw error;
  }
}

export const chainAdapter: ChainAdapter = {
  async inspect(txHash, expected) {
    const token = STOCK_TOKENS[expected.ticker];
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => null);
    if (!receipt) {
      const known = await client.getTransaction({ hash: txHash as `0x${string}` }).catch(() => null);
      return known ? { state: "pending" } : { state: "unknown" };
    }
    const head = await client.getBlockNumber();
    if (head - receipt.blockNumber + BigInt(1) < BigInt(PURCHASE_CONFIRMATIONS)) return { state: "pending" };
    const outcome = settle(receipt, { wallet: expected.wallet, token, amountMicro: expected.amountMicro });
    if (!outcome.ok) return { state: "failed", reason: outcome.reason };
    const uiMultiplier = await client.readContract({ address: token.address, abi: TOKEN_ABI, functionName: "uiMultiplier" });
    return {
      state: "confirmed",
      tokenRaw: outcome.tokenReceived,
      usdgSpent: outcome.usdgSpent,
      block: Number(receipt.blockNumber),
      uiMultiplier,
    };
  },
};

// ───────────────────────────── prices

export interface PriceView {
  ticker: string;
  /** USD per token (multiplier-adjusted), decimal strings as published. */
  bid: string;
  ask: string;
  /** When Robinhood generated the quote (ISO-8601). */
  generatedAt: string;
  halted: boolean;
}

let priceCache: { at: number; prices: PriceView[] } | null = null;

/**
 * Token prices from Robinhood's official Stock Token API. Cached 15 s, like
 * the source. A token without a usable price is simply left out — callers
 * then show quantities only.
 */
export async function readPrices(): Promise<PriceView[]> {
  if (priceCache && Date.now() - priceCache.at < 15_000) return priceCache.prices;
  const results = await Promise.all(
    Object.keys(STOCK_TOKENS).map(async (ticker): Promise<PriceView | null> => {
      try {
        const response = await fetch(`${PRICE_API}/${ticker}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
        if (!response.ok) return null;
        const quote = ((await response.json()) as { quotes?: Record<string, unknown>[] }).quotes?.[0];
        if (!quote || quote.tokenSymbol !== ticker || quote.currency !== "USD") return null;
        const bid = String(quote.tokenBid ?? "");
        const ask = String(quote.tokenAsk ?? "");
        const generatedAt = String(quote.generatedAt ?? "");
        if (!(Number(bid) > 0) || !(Number(ask) > 0) || Number.isNaN(Date.parse(generatedAt))) return null;
        return { ticker, bid, ask, generatedAt, halted: quote.isTradingHalt === true };
      } catch {
        return null;
      }
    }),
  );
  const prices = results.filter((price): price is PriceView => price !== null);
  priceCache = { at: Date.now(), prices };
  return prices;
}
