/**
 * The single place for network, token and swap-route configuration.
 * This file has no imports so scripts and tests can load it directly.
 *
 * Nothing here is guessed:
 * - Chain ID, RPC and explorer come from the official Robinhood Chain docs
 *   (https://docs.robinhood.com/chain/connecting); the chain ID was also read
 *   from the RPC with eth_chainId (0x1237 = 4663).
 * - Stock token addresses come from Robinhood's official asset list
 *   (GET https://api.robinhood.com/rhj/assets) and were re-read on chain with
 *   name() / symbol() / decimals() / uiMultiplier(). A token that is not in
 *   that list cannot be configured here. `npm run check:tokens` repeats both
 *   checks and asks for a live quote for every token.
 * - The purchase route is LI.FI, one of the RFQ/aggregator venues named in
 *   https://docs.robinhood.com/chain/building-with-stock-tokens. The contract
 *   address below is the `diamondAddress` LI.FI publishes for chain 4663
 *   (GET https://li.quest/v1/chains) and the address every quote returned as
 *   both `transactionRequest.to` and `estimate.approvalAddress`.
 */

export interface ChainConfig {
  id: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

export const CHAIN: ChainConfig = {
  id: 4663,
  name: "Robinhood Chain",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

export interface TokenConfig {
  symbol: string;
  /** name() as returned by the contract. */
  onchainName: string;
  address: `0x${string}`;
  decimals: number;
}

/** Read with eth_call on 2026-10-01; research/token-check.json records the block. */
export const USDG: TokenConfig = {
  symbol: "USDG",
  onchainName: "Global Dollar",
  address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  decimals: 6,
};

export const STOCK_TOKENS: Record<string, TokenConfig> = {
  NFLX: {
    symbol: "NFLX",
    onchainName: "Netflix • Robinhood Token",
    address: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8",
    decimals: 18,
  },
  AMZN: {
    symbol: "AMZN",
    onchainName: "Amazon • Robinhood Token",
    address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
    decimals: 18,
  },
  GOOGL: {
    symbol: "GOOGL",
    onchainName: "Alphabet Class A • Robinhood Token",
    address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",
    decimals: 18,
  },
  AAPL: {
    symbol: "AAPL",
    onchainName: "Apple • Robinhood Token",
    address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    decimals: 18,
  },
  MSFT: {
    symbol: "MSFT",
    onchainName: "Microsoft • Robinhood Token",
    address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
    decimals: 18,
  },
  ADBE: {
    symbol: "ADBE",
    onchainName: "Adobe • Robinhood Token",
    address: "0x232B8ed6377BE97813853B0Ac104c4Cda8378d1B",
    decimals: 18,
  },
  RBLX: {
    symbol: "RBLX",
    onchainName: "Roblox • Robinhood Token",
    address: "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8",
    decimals: 18,
  },
  ZM: {
    symbol: "ZM",
    onchainName: "Zoom • Robinhood Token",
    address: "0x44c4F142009036cF477eD2d09932051843137CF1",
    decimals: 18,
  },
};

/** The swap route. The server refuses any quote that points anywhere else. */
export const LIFI = {
  apiUrl: "https://li.quest/v1",
  /** LI.FI Diamond on chain 4663: the only spender ever approved, the only swap target. */
  diamond: "0xB477751B76CF82d00a686A1232f5fCD772414Af3" as `0x${string}`,
  integrator: "mirror",
  /**
   * Venues a purchase may route through. Only venues whose swap was rehearsed
   * end to end on a fork are listed (scripts/fork-buy.mjs, research/fork-buy.json):
   * - "kyberswap" settles in the same transaction for all eight tokens.
   * - "lifiIntentsDex" is left out on purpose: it takes the USDG and a solver
   *   delivers the tokens later, so a purchase could not be confirmed from
   *   its own transaction.
   * - "fly" reverted on the fork; the others were never returned by a quote.
   */
  exchanges: ["kyberswap"],
};

/** Official Robinhood Stock Token price endpoint (15 s cache on their side). */
export const PRICE_API = "https://api.robinhood.com/rhj/prices";

/** Confirmations required before a purchase is shown as done. */
export const PURCHASE_CONFIRMATIONS = 2;

export function explorerTx(hash: string): string {
  return `${CHAIN.explorerUrl}/tx/${hash}`;
}

export function explorerToken(address: string): string {
  return `${CHAIN.explorerUrl}/token/${address}`;
}
