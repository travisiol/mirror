// Rehearses real purchases on the local fork (cd fork && npm run serve).
// For each token: live LI.FI quote → the app's own validateQuote → exact
// approval → swap → the app's own settle() on the mined receipt.
// usage: node scripts/fork-buy.mjs [TICKER ...]      (default: every token)
// Nothing is sent to the real chain: the fork RPC signs with an unlocked test account.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { CHAIN, LIFI, STOCK_TOKENS, USDG } from "../src/config/network.ts";
import { formatTokens, formatUsdgExact } from "../src/core/mirror.ts";
import { quoteUrl, settle, validateQuote } from "../src/core/swap.ts";

const RPC = process.env.FORK_RPC || "http://127.0.0.1:8637";
const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const AMOUNT = BigInt(process.env.AMOUNT_MICRO || 1_549_000); // Netflix $15.49 at 10%

const chain = { id: CHAIN.id, name: "fork", nativeCurrency: CHAIN.nativeCurrency, rpcUrls: { default: { http: [RPC] } } };
const reader = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ chain, transport: http(RPC), account: WALLET });
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOfUI(address) view returns (uint256)",
]);
const read = (address, functionName, args) => reader.readContract({ address, abi: erc20, functionName, args });

if ((await reader.getChainId()) !== CHAIN.id) throw new Error("fork is not serving chain 4663");
const tickers = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(STOCK_TOKENS);
const results = [];
console.log(`fork block ${await reader.getBlockNumber()} · wallet USDG ${formatUsdgExact(await read(USDG.address, "balanceOf", [WALLET]))}`);

for (const ticker of tickers) {
  const token = STOCK_TOKENS[ticker];
  const row = { ticker, amountMicro: AMOUNT.toString() };
  try {
    const response = await fetch(quoteUrl({ wallet: WALLET, token, amountMicro: AMOUNT }));
    const body = await response.json();
    if (!response.ok) throw new Error(`quote refused: ${body.message ?? response.status}`);
    const prepared = validateQuote(body, { wallet: WALLET, token, amountMicro: AMOUNT });
    row.tool = prepared.tool;
    row.toAmountMin = prepared.toAmountMin;

    // Exact approval, never unlimited.
    const approveHash = await wallet.sendTransaction({
      to: USDG.address,
      data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [LIFI.diamond, AMOUNT] }),
    });
    await reader.waitForTransactionReceipt({ hash: approveHash });

    const before = await read(token.address, "balanceOf", [WALLET]);
    const hash = await wallet.sendTransaction({ to: prepared.to, data: prepared.data, value: 0n });
    const receipt = await reader.waitForTransactionReceipt({ hash });
    const outcome = settle(receipt, { wallet: WALLET, token, amountMicro: AMOUNT });
    if (!outcome.ok) throw new Error(outcome.reason);

    const after = await read(token.address, "balanceOf", [WALLET]);
    const allowanceLeft = await read(USDG.address, "allowance", [WALLET, LIFI.diamond]);
    if (after - before !== outcome.tokenReceived) throw new Error("balance change does not match the Transfer logs");
    if (outcome.tokenReceived < BigInt(prepared.toAmountMin)) throw new Error("received less than the quoted minimum");
    Object.assign(row, {
      ok: true,
      txHash: hash,
      usdgSpent: outcome.usdgSpent.toString(),
      tokenReceived: outcome.tokenReceived.toString(),
      balanceOfUI: String(await read(token.address, "balanceOfUI", [WALLET])),
      allowanceLeft: allowanceLeft.toString(),
      gasUsed: receipt.gasUsed.toString(),
    });
    console.log(
      `ok   ${ticker.padEnd(5)} ${formatUsdgExact(outcome.usdgSpent)} USDG → ${formatTokens(outcome.tokenReceived, 18, 8)} ${ticker} via ${prepared.tool} · allowance left ${allowanceLeft} · gas ${receipt.gasUsed}`,
    );
  } catch (error) {
    row.ok = false;
    row.error = String(error.shortMessage ?? error.message).slice(0, 400);
    console.log(`FAIL ${ticker.padEnd(5)} ${row.tool ?? ""} ${row.error}`);
  }
  results.push(row);
}

// Keep the latest successful rehearsal of every token across runs (a fork only lives a few minutes).
mkdirSync("research", { recursive: true });
const file = "research/fork-buy.json";
const proven = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).proven ?? {}) : {};
const at = new Date().toISOString();
for (const row of results) if (row.ok) proven[row.ticker] = { ...row, at };
writeFileSync(file, JSON.stringify({ wallet: WALLET, proven }, null, 2));
console.log(`proven on a fork so far: ${Object.keys(proven).join(", ") || "none"}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
