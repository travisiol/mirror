// Re-reads every configured token on chain and asks LiFi for a real USDG → token quote.
// usage: node scripts/check-tokens.mjs            (writes research/token-check.json)
// Nothing is sent: eth_call and HTTP GET only.
import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
import { CHAIN, STOCK_TOKENS, USDG } from "../src/config/network.ts";
import { quoteUrl, validateQuote } from "../src/core/swap.ts";

const client = createPublicClient({ transport: http(process.env.RPC_URL || CHAIN.rpcUrl) });
const abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function uiMultiplier() view returns (uint256)",
  "function balanceOfUI(address) view returns (uint256)",
]);
const read = (address, functionName, args = []) => client.readContract({ address, abi, functionName, args });

const official = await fetch("https://api.robinhood.com/rhj/assets", { headers: { "user-agent": "mirror-check" } })
  .then((r) => r.json())
  .then((j) => j.assets);

const block = await client.getBlockNumber();
const probe = "0x1111111111111111111111111111111111111111";
// $0.25, $1.549 (Netflix at 10%), $10
const sizes = ["250000", "1549000", "10000000"];
const out = { block: Number(block), checkedAt: new Date().toISOString(), usdg: null, tokens: {} };

out.usdg = {
  address: USDG.address,
  name: await read(USDG.address, "name"),
  symbol: await read(USDG.address, "symbol"),
  decimals: await read(USDG.address, "decimals"),
};
console.log("USDG", out.usdg);

let failed = false;
for (const token of Object.values(STOCK_TOKENS)) {
  const listed = official.find((a) => a.tokenSymbol === token.symbol);
  const listedAddress = listed?.deployments.find((d) => d.chainId === CHAIN.id)?.contractAddress;
  const entry = {
    address: token.address,
    inOfficialList: listedAddress?.toLowerCase() === token.address.toLowerCase(),
    name: await read(token.address, "name"),
    symbol: await read(token.address, "symbol"),
    decimals: await read(token.address, "decimals"),
    uiMultiplier: String(await read(token.address, "uiMultiplier")),
    balanceOfUI: String(await read(token.address, "balanceOfUI", [probe])),
    quotes: [],
  };
  for (const fromAmount of sizes) {
    const url = quoteUrl({ wallet: probe, token, amountMicro: BigInt(fromAmount) });
    const response = await fetch(url);
    const body = await response.json();
    let invalid = null;
    try {
      if (response.ok) validateQuote(body, { wallet: probe, token, amountMicro: BigInt(fromAmount) });
    } catch (error) {
      invalid = error.message;
    }
    entry.quotes.push(
      invalid
        ? { fromAmount, error: invalid }
        : response.ok
        ? {
            fromAmount,
            tool: body.tool,
            to: body.transactionRequest?.to,
            approvalAddress: body.estimate?.approvalAddress,
            toAmount: body.estimate?.toAmount,
            toAmountMin: body.estimate?.toAmountMin,
            fees: body.estimate?.feeCosts?.map((f) => `${f.name}:${f.amount}`),
            gasUsd: body.estimate?.gasCosts?.[0]?.amountUSD,
          }
        : { fromAmount, error: body.message ?? response.status },
    );
    await new Promise((r) => setTimeout(r, 400));
  }
  out.tokens[token.symbol] = entry;
  const ok =
    entry.inOfficialList && entry.symbol === token.symbol && entry.name === token.onchainName && entry.decimals === token.decimals;
  if (!ok || entry.quotes.some((q) => q.error)) failed = true;
  console.log(
    token.symbol.padEnd(6),
    ok ? "config matches chain + official list" : "MISMATCH",
    "| mult",
    entry.uiMultiplier,
    "|",
    entry.quotes.map((q) => (q.error ? `ERR ${q.error}` : `${q.fromAmount}→${q.toAmount} via ${q.tool}`)).join(" ; "),
  );
}

mkdirSync("research", { recursive: true });
writeFileSync("research/token-check.json", JSON.stringify(out, null, 2));
console.log(failed ? "\nFAILED: see above" : `\nall ${Object.keys(out.tokens).length} tokens verified at block ${block}`);
process.exit(failed ? 1 : 0);
