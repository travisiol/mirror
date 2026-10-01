// Minimal Chrome DevTools Protocol driver: real time, real network, real clicks, screenshots.
// Zero dependencies — Node 22+ has WebSocket and fetch.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1280, height = 900, mobile = false, inject = [] } = {}) {
  const port = 9400 + Math.floor(Math.random() * 300);
  const proc = spawn(
    chrome,
    [
      "--headless=new",
      "--no-first-run",
      `--user-data-dir=${path.join(process.env.TEMP ?? "/tmp", `mirror-cdp-${port}`)}`,
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--hide-scrollbars",
      `--window-size=${width},${height}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const version = await (async () => {
    for (let i = 0; i < 60; i++) {
      try {
        return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      } catch {
        await sleep(250);
      }
    }
    throw new Error("chrome did not answer");
  })();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, S);
  await send("Runtime.enable", {}, S);
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }, S);
  for (const source of inject) await send("Page.addScriptToEvaluateOnNewDocument", { source }, S);

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, S);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
    return r.result.value;
  };
  const outDir = path.resolve("shots");
  mkdirSync(outDir, { recursive: true });
  const shot = async (name, { fullPage = false } = {}) => {
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: fullPage }, S);
    const file = path.join(outDir, `${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  };
  const waitFor = async (expression, label, timeout = 40_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expression).catch(() => false)) return;
      await sleep(250);
    }
    throw new Error(`timeout waiting for ${label}`);
  };
  /** Real mouse click on the centre of the first element whose text matches. */
  const clickText = async (text, selector = "button, a, label") => {
    const point = await evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.offsetParent !== null && !e.disabled && e.textContent.trim().includes(${JSON.stringify(text)}));
      if (!el) return null;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!point) throw new Error(`nothing to click with text "${text}"`);
    for (const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 }, S);
  };
  /** Focus an input (by aria-label or placeholder substring) and type real key events. */
  const typeInto = async (label, text) => {
    const found = await evaluate(`(() => {
      const el = [...document.querySelectorAll("input")].find((e) => e.offsetParent !== null && ((e.getAttribute("aria-label") ?? "") + " " + (e.labels?.[0]?.textContent ?? "") + " " + e.placeholder).includes(${JSON.stringify(label)}));
      if (!el) return false;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      el.focus();
      el.select();
      return true;
    })()`);
    if (!found) throw new Error(`no input for "${label}"`);
    await send("Input.insertText", { text }, S);
  };
  const text = () => evaluate("document.body.innerText");
  const navigate = (url) => send("Page.navigate", { url }, S);
  const close = () => {
    try {
      ws.close();
    } catch {}
    proc.kill();
  };
  return { send, S, evaluate, shot, waitFor, clickText, typeInto, text, navigate, close, consoleErrors };
}
