import { bundle, pageHtml, withPage } from "./presence-harness.mjs";

const out = process.argv[2] ?? "/tmp/presence-contact-sheet.png";
const light = process.argv.includes("--light");
const zoom = process.argv.includes("--zoom");
const script = await bundle("src/presence/harness/sheet.ts", { SHEET_LIGHT: String(light), SHEET_ZOOM: String(zoom) });
await withPage({ html: pageHtml(script, { background: light ? "#ffffff" : "#0b0716" }), width: 1500, height: 1700, scale: zoom ? 1 : 2, dark: !light }, async ({ waitFor, screenshot, page }) => {
  const size = await waitFor("window.__done");
  await page.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: zoom ? 1 : 2, mobile: false });
  await screenshot(out, { x: 0, y: 0, width: size.width, height: size.height });
  console.log(out, size.width, size.height);
});
