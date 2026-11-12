#!/usr/bin/env node
/**
 * The hands-free waveform button beside BB's mic, and its right-click quick
 * settings, in a staged BB's web UI: crops in light and dark of the composer
 * row, the menu open, and the voice submenu.
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   HANDSFREE_MENU_OUT=<dir> node scripts/capture/handsfree-menu.mjs
 *
 * Writes composer-row(-dark).png always, and menu(-dark).png and
 * voice-submenu(-dark).png when the button has a menu (before it did not).
 * order.json lists the composer row's buttons left to right.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CdpClient, ensureChrome } from "./driver.mjs";
import { sleep, threadId } from "./bb.mjs";

const out = process.env.HANDSFREE_MENU_OUT;
if (!out) throw new Error("Set HANDSFREE_MENU_OUT to the folder for the crops.");
if (!threadId) throw new Error("Source the staged BB's capture.env first (BB_CAPTURE_THREAD_ID).");
await mkdir(out, { recursive: true });

const BUTTON = '[data-testid="handsfree-composer"]';
const { webSocketUrl, process: chromeProcess, profileDir } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
const scheme = (value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });

/** The bounding box of every element matching the selectors, padded and kept on screen. */
const clipOf = (selectors, pad = 12) => client.evaluate(`(() => {
  const rects = ${JSON.stringify(selectors)}.flatMap((selector) => [...document.querySelectorAll(selector)]).map((element) => element.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
  if (!rects.length) throw new Error("Nothing to crop: " + ${JSON.stringify(selectors.join(", "))});
  const x = Math.max(0, Math.min(...rects.map((rect) => rect.left)) - ${pad});
  const y = Math.max(0, Math.min(...rects.map((rect) => rect.top)) - ${pad});
  const right = Math.min(innerWidth, Math.max(...rects.map((rect) => rect.right)) + ${pad});
  const bottom = Math.min(innerHeight, Math.max(...rects.map((rect) => rect.bottom)) + ${pad});
  return { x, y, width: right - x, height: bottom - y };
})()`);

async function render(name, clip) {
  for (const value of ["light", "dark"]) {
    await scheme(value);
    await sleep(250);
    await client.capture(join(out, `${name}${value === "dark" ? "-dark" : ""}.png`), await clip());
  }
}

try {
  await client.connect();
  await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await scheme("light");
  await client.navigate(`/threads/${threadId}`);
  await client.waitForSelector(BUTTON, 60000);
  await sleep(1000);

  // The composer's action row, left to right: the waveform must sit just before the mic.
  await client.evaluate(`document.querySelector(${JSON.stringify(BUTTON)}).closest("[data-promptbox-standard-actions]").setAttribute("data-capture-row", "")`);
  const order = await client.evaluate(`[...document.querySelector("[data-capture-row]").querySelectorAll("button")].filter((button) => button.offsetParent).map((button) => button.getAttribute("aria-label") || button.textContent.trim())`);
  await writeFile(join(out, "order.json"), `${JSON.stringify(order, null, 2)}\n`);
  process.stdout.write(`Composer row: ${order.join(" | ")}\n`);
  // The whole composer, so the row reads in context.
  await client.evaluate(`(() => { let element = document.querySelector("[data-capture-row]"); while (element && element.getBoundingClientRect().width < 520) element = element.parentElement; while (element && element.getBoundingClientRect().height < 90) element = element.parentElement; element.setAttribute("data-capture-composer", ""); })()`);
  await render("composer-row", () => clipOf(["[data-capture-composer]"], 10));

  await client.openContextMenu(BUTTON);
  if (!(await client.poll(`!!document.querySelector('[data-testid="handsfree-menu"]')`))) {
    process.stdout.write("No quick-settings menu on this build.\n");
  } else {
    await client.waitForSelector('[data-testid="handsfree-menu-spend"]', 15000);
    const menu = await client.evaluate(`document.querySelector('[data-testid="handsfree-menu"]').innerText`);
    for (const label of ["Changes apply to the next session.", "gpt-live-1", "marin", "gpt-5.6-luna", "This month", "of $20.00", "Voice settings…"]) {
      if (!menu.includes(label)) throw new Error(`The menu is missing "${label}":\n${menu}`);
    }
    await render("menu", () => clipOf([BUTTON, '[data-testid="handsfree-menu"]']));

    // Hover Voice: its submenu, the model's own voices with marin checked.
    const point = await client.evaluate(`(() => { const rect = document.querySelector('[data-testid="handsfree-menu-voice"]').getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
    await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x - 30, y: point.y, buttons: 0 });
    await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, buttons: 0 });
    await client.waitForSelector('[data-testid="handsfree-voices"]', 10000);
    await sleep(400);
    const checked = await client.evaluate(`document.querySelector('[data-testid="handsfree-voices"] [aria-checked="true"]')?.textContent`);
    const voices = await client.evaluate(`document.querySelectorAll('[data-testid="handsfree-voices"] [role="menuitemradio"]').length`);
    if (checked !== "marin" || voices !== 22) throw new Error(`Voice submenu: ${voices} voices, checked ${checked}`);
    const offscreen = await client.evaluate(`(() => { const rect = document.querySelector('[data-testid="handsfree-voices"]').getBoundingClientRect(); return rect.top < 0 || rect.bottom > innerHeight; })()`);
    if (offscreen) throw new Error("The voice submenu runs off the screen.");
    await render("voice-submenu", () => clipOf([BUTTON, '[data-testid="handsfree-menu"]', '[data-testid="handsfree-voices"]']));
  }
} finally {
  client.socket?.close();
  if (chromeProcess) {
    const exited = new Promise((resolve) => chromeProcess.once("exit", resolve));
    chromeProcess.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
