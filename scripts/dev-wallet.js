// Test wallet for the fork rehearsal. Injected into the page by scripts/browser-flow.mjs —
// the site never loads it. It announces itself with EIP-6963 and relays every
// wallet call to the local fork (fork/serve.cjs), whose unlocked test account
// does the signing. It cannot reach the real chain and holds no key.
(() => {
  const RPC = "http://127.0.0.1:8637";
  const ACCOUNT = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
  let id = 0;
  const rpc = async (method, params = []) => {
    const response = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const body = await response.json();
    if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code });
    return body.result;
  };
  window.__WALLET_LOG = [];
  const provider = {
    async request({ method, params }) {
      window.__WALLET_LOG.push({ method, params });
      if (window.__WALLET_REJECT === method) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      return rpc(method, params ?? []);
    },
    on() {},
  };
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info: { uuid: "b7c4f1de-fork-test-wallet", name: "Fork test wallet", rdns: "local.fork.test" }, provider }),
      }),
    );
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();
