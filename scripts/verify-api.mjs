// End-to-end checks against a running server (default http://localhost:3637).
// Uses throwaway wallets generated on the spot; signs messages only, sends no transaction.
// The quote step calls the real LI.FI API, and /api/wallet reads the configured chain.
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.BASE_URL || "http://localhost:3637";

function client() {
  const jar = new Map();
  return async (path, init = {}) => {
    const headers = { origin: BASE, ...(init.headers ?? {}) };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const response = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const [name, value] = pair.split("=");
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    const type = response.headers.get("content-type") ?? "";
    return { status: response.status, body: type.includes("json") ? await response.json() : null };
  };
}

const json = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function signIn(http, account, signer = account) {
  const nonce = await http("/api/auth/nonce", json("POST", { address: account.address }));
  assert.equal(nonce.status, 200);
  const signature = await signer.signMessage({ message: nonce.body.message });
  const request = { address: account.address, nonce: nonce.body.nonce, issuedAt: nonce.body.issuedAt, signature };
  return { verify: await http("/api/auth/verify", json("POST", request)), request };
}

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log("ok  -", name);
};

const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());
const a = client();
const b = client();
const anon = client();
const plan = { rateBps: 1000, subscriptions: [{ serviceId: "netflix", priceCents: 1549 }] };
const act = (ticker, body) => [`/api/mirror/${ticker}`, json("POST", body)];

await check("anonymous requests are refused everywhere data lives", async () => {
  assert.equal((await anon("/api/plan")).status, 401);
  assert.equal((await anon("/api/plan", json("PUT", plan))).status, 401);
  assert.equal((await anon("/api/mirror")).status, 401);
  assert.equal((await anon("/api/wallet")).status, 401);
  for (const action of ["quote", "submit", "confirm", "cancel"])
    assert.equal((await anon(...act("NFLX", { action, month: "2026-10", txHash: `0x${"1".repeat(64)}` }))).status, 401);
  assert.equal((await anon("/api/auth/me")).body.address, null);
});

await check("a forged or tampered session cookie is refused", async () => {
  const payload = Buffer.from(JSON.stringify({ sub: alice.address.toLowerCase(), exp: Date.now() + 1e9 })).toString("base64url");
  const response = await fetch(BASE + "/api/plan", { headers: { cookie: `mirror_session=${payload}.${"A".repeat(43)}` } });
  assert.equal(response.status, 401);
});

await check("cross-site mutations are refused", async () => {
  for (const origin of ["https://evil.example", undefined]) {
    const headers = { "content-type": "application/json", ...(origin ? { origin } : {}) };
    const response = await fetch(BASE + "/api/auth/nonce", { method: "POST", headers, body: JSON.stringify({ address: alice.address }) });
    assert.equal(response.status, 403);
  }
});

await check("a signature from another wallet does not open a session", async () => {
  const { verify } = await signIn(client(), alice, bob);
  assert.equal(verify.status, 401);
});

let aliceRequest;
await check("signing in opens a session for exactly that wallet", async () => {
  const { verify, request } = await signIn(a, alice);
  aliceRequest = request;
  assert.equal(verify.status, 200);
  assert.equal((await a("/api/auth/me")).body.address, alice.address.toLowerCase());
  assert.equal((await signIn(b, bob)).verify.status, 200);
});

await check("a sign-in nonce cannot be replayed", async () => {
  const replay = await client()("/api/auth/verify", json("POST", aliceRequest));
  assert.equal(replay.status, 401);
});

await check("a new account starts empty", async () => {
  assert.deepEqual((await a("/api/plan")).body.plan, { rateBps: null, subscriptions: [] });
  const mirror = (await a("/api/mirror")).body;
  assert.deepEqual(mirror.month.lines, []);
  assert.deepEqual(mirror.history, []);
});

await check("the server validates prices, rate and services", async () => {
  const bad = async (body) => assert.equal((await a("/api/plan", json("PUT", body))).status, 400);
  await bad({ rateBps: 20_000, subscriptions: [] });
  await bad({ rateBps: 0, subscriptions: [] });
  await bad({ rateBps: 1000, subscriptions: [{ serviceId: "netflix", priceCents: -5 }] });
  await bad({ rateBps: 1000, subscriptions: [{ serviceId: "netflix", priceCents: 12.5 }] });
  await bad({ rateBps: 1000, subscriptions: [{ serviceId: "netflix", priceCents: 99_999_999 }] });
  await bad({ rateBps: 1000, subscriptions: [{ serviceId: "spotify", priceCents: 1199 }] });
  assert.equal((await a("/api/plan", { method: "PUT", headers: { "content-type": "application/json" }, body: "{not json" })).status, 400);
  assert.equal((await a("/api/plan")).body.plan.rateBps, null);
});

await check("a plan is saved for its wallet and computed server-side", async () => {
  // Extra fields naming another wallet or an amount are ignored.
  const saved = await a("/api/plan", json("PUT", { ...plan, wallet: bob.address, amountMicro: "1" }));
  assert.equal(saved.status, 200);
  const line = (await a("/api/mirror")).body.month.lines[0];
  assert.equal(line.ticker, "NFLX");
  assert.equal(line.amountMicro, "1549000");
  assert.equal(line.status, "due");
});

await check("one wallet cannot read or change another wallet's records", async () => {
  assert.deepEqual((await b("/api/plan")).body.plan, { rateBps: null, subscriptions: [] });
  assert.deepEqual((await b("/api/mirror")).body.month.lines, []);
  // Bob has no Netflix line: he cannot quote, submit, confirm or cancel Alice's.
  assert.equal((await b(...act("NFLX", { action: "quote" }))).status, 409);
  const month = (await a("/api/mirror")).body.month.month;
  assert.equal((await b(...act("NFLX", { action: "submit", month, txHash: `0x${"2".repeat(64)}` }))).status, 409);
  assert.equal((await b(...act("NFLX", { action: "confirm", month }))).status, 404);
  await b("/api/plan", json("PUT", { rateBps: 2500, subscriptions: [{ serviceId: "zoom", priceCents: 1599 }] }));
  assert.deepEqual((await a("/api/plan")).body.plan, plan);
});

await check("each wallet reads only its own balances from the chain", async () => {
  const wallet = (await a("/api/wallet")).body.wallet;
  assert.equal(wallet.usdg, "0");
  assert.equal(wallet.holdings.length, 8);
  assert.ok(wallet.holdings.every((h) => h.raw === "0" && BigInt(h.uiMultiplier) > 0n));
  assert.equal((await a(`/api/wallet?address=${bob.address}`)).body.wallet.usdg, "0");
});

let month;
await check("a quote is real, for the exact amount, and reserves the month", async () => {
  const quote = await a(...act("NFLX", { action: "quote" }));
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  month = quote.body.month;
  assert.equal(quote.body.amountMicro, "1549000");
  assert.equal(quote.body.swap.to.toLowerCase(), "0xb477751b76cf82d00a686a1232f5fcd772414af3");
  assert.ok(BigInt(quote.body.swap.toAmountMin) > 0n);
  assert.equal((await a("/api/mirror")).body.month.lines[0].status, "signing");
});

await check("the same month cannot be started twice", async () => {
  assert.equal((await a(...act("NFLX", { action: "quote" }))).status, 409);
  assert.equal((await a(...act("TSLA", { action: "quote" }))).status, 404);
  assert.equal((await a(...act("AAPL", { action: "quote" }))).status, 409);
});

await check("cancelling releases it; a bad hash is refused", async () => {
  assert.equal((await a(...act("NFLX", { action: "submit", month, txHash: "0x1234" }))).status, 400);
  assert.equal((await a(...act("NFLX", { action: "cancel", month }))).status, 200);
  assert.equal((await a("/api/mirror")).body.month.lines[0].status, "due");
});

await check("a transaction the chain has never seen is never shown as bought", async () => {
  assert.equal((await a(...act("NFLX", { action: "quote" }))).status, 200);
  const txHash = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`;
  assert.equal((await a(...act("NFLX", { action: "submit", month, txHash }))).status, 200);
  const confirm = await a(...act("NFLX", { action: "confirm", month }));
  assert.equal(confirm.body.status, "submitted");
  assert.deepEqual(confirm.body.history, []);
  assert.equal((await a(...act("NFLX", { action: "quote" }))).status, 409); // and it still blocks a second purchase
  // The same hash cannot be attached to Bob's purchase.
  assert.equal((await b(...act("ZM", { action: "quote" }))).status, 200);
  assert.equal((await b(...act("ZM", { action: "submit", month, txHash }))).status, 409);
  await b(...act("ZM", { action: "cancel", month }));
});

await check("signing out ends the session", async () => {
  assert.equal((await a("/api/auth/logout", { method: "POST" })).status, 200);
  assert.equal((await a("/api/plan")).status, 401);
});

await check("public pages and prices load without a session", async () => {
  for (const path of ["/", "/app", "/app/dashboard"]) assert.equal((await fetch(BASE + path)).status, 200);
  const prices = (await anon("/api/prices")).body.prices;
  assert.ok(Array.isArray(prices));
  for (const price of prices) assert.ok(Number(price.bid) > 0 && !Number.isNaN(Date.parse(price.generatedAt)));
});

console.log(`\n${passed} checks passed against ${BASE}`);
