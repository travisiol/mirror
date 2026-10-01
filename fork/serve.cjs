/**
 * Serves a fork of Robinhood Chain on http://127.0.0.1:8637 and gives the
 * test wallet (hardhat account #1, unlocked) real USDG by moving it from a
 * current holder on the fork. Nothing touches the real chain.
 *
 *   cd fork && npm run serve
 *
 * Point the app at it with RPC_URL=http://127.0.0.1:8637 (server side) and
 * load scripts/dev-wallet.js in the browser: it relays wallet calls here.
 */
const http = require("http");
const { network } = require("hardhat");

const PORT = Number(process.env.FORK_PORT || 8637);
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const TEST_WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const FUND_USDG = 500_000_000n; // 500 USDG
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const rpc = (method, params = []) => network.provider.request({ method, params });
const pad = (address) => address.toLowerCase().replace("0x", "").padStart(64, "0");
const balanceOf = async (holder) => BigInt(await rpc("eth_call", [{ to: USDG, data: `0x70a08231${pad(holder)}` }, "latest"]));

async function fund() {
  const head = Number(await rpc("eth_blockNumber"));
  const upstream = process.env.FORK_URL || "https://rpc.mainnet.chain.robinhood.com";
  // Recent USDG receivers, read from the real chain (the fork has no log index of its own).
  const response = await fetch(upstream, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [{ address: USDG, topics: [TRANSFER_TOPIC], fromBlock: `0x${(head - 1500).toString(16)}`, toBlock: `0x${head.toString(16)}` }],
    }),
  });
  const logs = (await response.json()).result ?? [];
  // The parties to the largest recent transfers are the likeliest to hold enough.
  logs.sort((x, y) => (BigInt(y.data) > BigInt(x.data) ? 1 : -1));
  const candidates = [...new Set(logs.slice(0, 40).flatMap((log) => [`0x${log.topics[2].slice(26)}`, `0x${log.topics[1].slice(26)}`]))];
  let best = null;
  for (const holder of candidates) {
    if (/^0x0+$/.test(holder)) continue;
    const balance = await balanceOf(holder);
    if (balance >= FUND_USDG) {
      best = { holder, balance };
      break;
    }
  }
  if (!best) throw new Error("no recent USDG holder with enough balance found");
  await rpc("hardhat_impersonateAccount", [best.holder]);
  await rpc("hardhat_setBalance", [best.holder, "0x56BC75E2D63100000"]);
  await rpc("eth_sendTransaction", [
    { from: best.holder, to: USDG, data: `0xa9059cbb${pad(TEST_WALLET)}${FUND_USDG.toString(16).padStart(64, "0")}` },
  ]);
  await rpc("hardhat_stopImpersonatingAccount", [best.holder]);
  console.log(`funded ${TEST_WALLET} with ${Number(await balanceOf(TEST_WALLET)) / 1e6} USDG (moved from ${best.holder} on the fork)`);
}

function serve() {
  const server = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end("bad json");
        return;
      }
      const handle = async (call) => {
        try {
          return { jsonrpc: "2.0", id: call.id ?? null, result: await rpc(call.method, call.params ?? []) };
        } catch (e) {
          if (call.method === "eth_sendTransaction" || call.method === "eth_estimateGas") console.log(`${call.method} failed: ${e.message}`);
          return { jsonrpc: "2.0", id: call.id ?? null, error: { code: typeof e.code === "number" ? e.code : -32000, message: e.message ?? "error", data: e.data } };
        }
      };
      const out = Array.isArray(payload) ? await Promise.all(payload.map(handle)) : await handle(payload);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  server.listen(PORT, "127.0.0.1", () => console.log(`fork serving on http://127.0.0.1:${PORT} (chain ${network.config.chainId}) — Ctrl+C to stop`));
}

async function main() {
  await rpc("evm_mine");
  console.log(`forked at block ${Number(await rpc("eth_blockNumber"))}`);
  await fund();
  serve();
  // The real chain produces a block every ~0.1 s; without this a lone transaction would never gain confirmations.
  setInterval(() => rpc("evm_mine").catch(() => {}), 1500);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
