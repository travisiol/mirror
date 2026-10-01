// Full-page screenshot at an exact viewport width (works for phone widths, where
// plain --window-size cannot go below ~500 px).
// usage: node scripts/capture-page.mjs <name> <url> [width] [height] [mobile]
import { launch, sleep } from "./cdp.mjs";

const [name, url, width = "390", height = "844", mobile = "true"] = process.argv.slice(2);
if (!name || !url) {
  console.error("usage: node scripts/capture-page.mjs <name> <url> [width] [height] [mobile]");
  process.exit(1);
}
const page = await launch({ width: Number(width), height: Number(height), mobile: mobile === "true" });
try {
  await page.navigate(url);
  await page.waitFor(`document.readyState === "complete"`, "page load");
  await sleep(Number(process.env.SETTLE || 3500));
  const overflow = await page.evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  console.log(await page.shot(name, { fullPage: true }), `· horizontal overflow: ${overflow}px`);
} finally {
  page.close();
}
