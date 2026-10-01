// Headless Chrome screenshot (SwiftShader renders the three.js disc without a GPU).
// usage: node scripts/capture.mjs <name> <url> [width] [height]
// For phone widths or full pages use scripts/capture-page.mjs.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [name, url, width = "1200", height = "896"] = process.argv.slice(2);
if (!name || !url) {
  console.error("usage: node scripts/capture.mjs <name> <url> [width] [height]");
  process.exit(1);
}
mkdirSync("shots", { recursive: true });
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const out = resolve("shots", `${name}.png`);
const result = spawnSync(
  chrome,
  [
    "--headless=new",
    "--no-first-run",
    `--user-data-dir=${join(tmpdir(), "mirror-shot")}`,
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${process.env.BUDGET || 12000}`,
    `--screenshot=${out}`,
    url,
  ],
  { stdio: "ignore" },
);
console.log(result.status === 0 ? out : `chrome exited with ${result.status}`);
