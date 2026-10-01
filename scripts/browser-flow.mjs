// The whole journey in a real (headless) browser, with a test wallet on the local fork:
// connect → sign in → add subscriptions → approve the month → confirmed purchases → history.
//
// Needs, in this order:
//   1. cd fork && npm run serve                      (fork on :8637, funds the test wallet)
//   2. the app started with RPC_URL=http://127.0.0.1:8637 and its own data dir, e.g.
//        RPC_URL=http://127.0.0.1:8637 MIRROR_DATA_DIR=data-fork npx next dev -p 3637
//   3. node scripts/browser-flow.mjs
// Quotes are real (LI.FI); every transaction lands on the fork only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch, sleep } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3637";
const wallet = readFileSync(new URL("./dev-wallet.js", import.meta.url), "utf8");
const page = await launch({ width: 1280, height: 1000, inject: [wallet] });
const step = (name) => console.log("ok  -", name);

try {
  // ── no wallet connected: the app shows the connect screen, nothing else
  await page.navigate(`${BASE}/app/dashboard`);
  await page.waitFor(`document.body.innerText.includes("Connect wallet")`, "connect screen");
  let text = await page.text();
  assert.ok(!text.includes("This month’s mirror"), "dashboard content must not render without a session");
  await page.shot("flow-1-connect");
  step("without a wallet the dashboard shows only the connect screen");

  // ── connect + sign in
  await page.clickText("Connect wallet", "section button");
  await page.waitFor(`document.body.innerText.includes("Fork test wallet")`, "wallet dialog");
  await page.clickText("Fork test wallet");
  await page.waitFor(`document.body.innerText.includes("Sign in as 0x7099")`, "sign-in button");
  await page.clickText("Sign in as");
  await page.waitFor(`document.body.innerText.includes("Nothing to mirror yet")`, "empty dashboard");
  text = await page.text();
  assert.match(text, /holds none of the catalogue|Reading/);
  assert.ok(text.includes("No purchases yet"));
  await page.shot("flow-2-empty-dashboard");
  step("a new account sees empty states");

  // ── subscriptions
  await page.clickText("List my subscriptions");
  await page.waitFor(`document.body.innerText.includes("Your subscriptions")`, "setup page");
  await page.clickText("Netflix", "label");
  await page.typeInto("Netflix monthly price", "15.49");
  await page.clickText("Apple Music", "label");
  await page.typeInto("Apple Music monthly price", "10.99");
  await page.clickText("iCloud+", "label");
  await page.typeInto("iCloud+ monthly price", "2.99");
  await page.waitFor(`document.body.innerText.includes("$2.95")`, "monthly total"); // 1.549 + 1.398 = 2.947
  await page.shot("flow-3-setup");
  await page.clickText("Save", "aside button");
  await page.waitFor(`document.body.innerText.includes("Saved.")`, "saved");
  step("subscriptions and rate saved (Netflix $15.49, Apple Music $10.99, iCloud+ $2.99 at 10%)");

  // ── this month's mirror
  await page.clickText("See this month’s mirror");
  await page.waitFor(`document.body.innerText.includes("Approve this month’s mirror")`, "approve button");
  text = await page.text();
  assert.ok(text.includes("exactly 2.947 USDG"), "exact amount shown");
  assert.match(text, /In your wallet: [\d.,]+ USDG/);
  await page.shot("flow-4-month-due");

  // A refusal in the wallet stops everything and buys nothing.
  await page.evaluate(`window.__WALLET_REJECT = "eth_sendTransaction"`);
  await page.clickText("Approve this month’s mirror");
  await page.waitFor(`document.body.innerText.includes("Maximum slippage 1%")`, "review dialog");
  await page.shot("flow-5-review");
  await page.clickText("Approve and sign");
  await page.waitFor(`document.body.innerText.includes("Request declined in your wallet.")`, "decline message");
  await page.clickText("Done");
  await sleep(500);
  text = await page.text();
  assert.ok(text.includes("exactly 2.947 USDG") && !text.includes("Bought"), "nothing bought after a refusal");
  step("declining in the wallet buys nothing and leaves the month due");

  // ── approve for real (on the fork)
  await page.evaluate(`window.__WALLET_REJECT = null; window.__WALLET_LOG.length = 0`);
  await page.clickText("Approve this month’s mirror");
  await page.waitFor(`document.body.innerText.includes("Approve and sign")`, "review dialog");
  await page.clickText("Approve and sign");
  await page.waitFor(`document.body.innerText.includes("you receive at least")`, "minimum received shown", 60_000);
  await page.shot("flow-6-signing");
  await page.waitFor(`[...document.querySelectorAll("dialog button")].some((b) => b.textContent.trim() === "Done")`, "run finished", 180_000);
  await page.shot("flow-7-run-done");
  const sent = await page.evaluate(`window.__WALLET_LOG.filter((c) => c.method === "eth_sendTransaction").map((c) => c.params[0])`);
  // approve(spender, amount): the amount is the exact total, never the max uint.
  assert.equal(sent.length, 3, "one approval and two swaps");
  assert.equal(sent[0].to.toLowerCase(), "0x5fc5360d0400a0fd4f2af552add042d716f1d168");
  assert.equal(sent[0].data.slice(0, 10), "0x095ea7b3");
  assert.equal(BigInt("0x" + sent[0].data.slice(74)), 2_947_000n);
  assert.ok(sent.slice(1).every((tx) => tx.to.toLowerCase() === "0xb477751b76cf82d00a686a1232f5fcd772414af3" && BigInt(tx.value) === 0n));
  step("wallet was asked for one exact approval (2.947 USDG) and two swaps to the LI.FI Diamond");

  await page.clickText("Done");
  await page.waitFor(`document.body.innerText.includes("Done") && document.body.innerText.split("Bought").length >= 3`, "both lines bought");
  text = await page.text();
  assert.match(text, /Received [\d.]+ NFLX for 1\.549 USDG/);
  assert.match(text, /Received [\d.]+ AAPL for 1\.398 USDG/);
  assert.match(text, /\+[\d.]+ NFLX/);
  assert.match(text, /share-equivalents/); // AAPL's ERC-8056 multiplier is not 1
  assert.ok(!text.includes("holds none of the catalogue"));
  await page.shot("flow-8-dashboard-bought", { fullPage: true });
  step("both purchases confirmed on chain; holdings and history show them");

  // ── same month again: nothing left to approve, and the API refuses
  await page.navigate(`${BASE}/app/dashboard`);
  await page.waitFor(`document.body.innerText.includes("History")`, "dashboard reloaded");
  await sleep(1500);
  text = await page.text();
  assert.ok(!text.includes("Approve this month’s mirror"));
  const again = await page.evaluate(
    `fetch("/api/mirror/NFLX", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "quote" }) }).then((r) => r.status)`,
  );
  assert.equal(again, 409);
  step("the same month cannot be bought a second time");

  if (page.consoleErrors.length) console.log("console errors:", page.consoleErrors.slice(0, 5));
  console.log("\nbrowser flow passed");
} catch (error) {
  await page.shot("flow-failure", { fullPage: true }).catch(() => {});
  console.error("FAILED:", error.message);
  console.error((await page.text().catch(() => "")).slice(0, 1500));
  process.exitCode = 1;
} finally {
  page.close();
}
