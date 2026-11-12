import { readFileSync } from "node:fs";
import { bundle, tailwindPage, withPage } from "./presence-harness.mjs";

const out = process.argv[2] ?? "/tmp/presence-picker-harness.png";
const code = readFileSync(process.argv[3] ?? "/tmp/presence-crane/draw.js", "utf8");
const light = process.argv.includes("--light");
const form = process.argv.find((arg) => arg.startsWith("--form="))?.slice(7) ?? "tesseract";
const script = await bundle("src/presence/harness/picker.tsx", { CUSTOM_CODE: JSON.stringify(code), START_FORM: JSON.stringify(form) });
await withPage({ html: tailwindPage(script, { dark: !light }), width: 960, height: 900, scale: 2, dark: !light }, async ({ waitFor, screenshot, page, logs }) => {
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const done = await waitFor("window.__done");
  if (!done.height) throw new Error(`Nothing rendered: ${logs.join(" / ").slice(0, 1500)}`);
  await page.send("Emulation.setDeviceMetricsOverride", { width: done.width, height: done.height, deviceScaleFactor: 2, mobile: false });
  await new Promise((next) => setTimeout(next, 500));
  await screenshot(out, { x: 0, y: 0, width: done.width, height: done.height });
  console.log(out, JSON.stringify(done), logs.slice(0, 5).join("\n"));
});
