import { readFileSync } from "node:fs";
import { bundle, pageHtml, withPage } from "./presence-harness.mjs";

const out = process.argv[2] ?? "/tmp/presence-halo.png";
const crane = readFileSync(process.argv[3] ?? "/tmp/presence-crane/draw.js", "utf8");
const lava = readFileSync(process.argv[4] ?? "/tmp/presence-lava/draw.js", "utf8");
const light = process.argv.includes("--light");
const off = process.argv.includes("--off");
const script = await bundle("src/presence/harness/halo.tsx", { HALO_LIGHT: String(light), HALO_OFF: String(off), CRANE_CODE: JSON.stringify(crane), LAVA_CODE: JSON.stringify(lava) });
await withPage({ html: pageHtml(script, { background: light ? "#ffffff" : "#06070e" }), width: 900, height: 900, scale: 2, dark: !light }, async ({ waitFor, screenshot, page, logs }) => {
  const done = await waitFor("window.__done");
  if (!done.height) throw new Error(`Nothing rendered: ${logs.join(" / ").slice(0, 1500)}`);
  await page.send("Emulation.setDeviceMetricsOverride", { width: done.width, height: done.height, deviceScaleFactor: 2, mobile: false });
  await new Promise((next) => setTimeout(next, 300));
  await screenshot(out, { x: 0, y: 0, width: done.width, height: done.height });
  console.log(out, JSON.stringify(done), logs.slice(0, 5).join("\n"));
});
