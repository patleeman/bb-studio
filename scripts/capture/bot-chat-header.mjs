#!/usr/bin/env node
/**
 * The Bot chat's header and the Loops pane, in a staged BB's web UI, for
 * before/after comparisons of header changes: light and dark crops of the
 * header row, the chat, the pane opened from the header's Loops button, and
 * the pane opened from the sidebar's All loops (three tries, timed).
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   # Seed a Bot with loops first:
 *   BB_CAPTURE_ONLY=studio-loops-pane node scripts/capture-plugin-screenshots.mjs --plugin studio
 *   BOT_HEADER_OUT=<dir> node scripts/capture/bot-chat-header.mjs
 *
 * Works on builds with the old header slot (Studio's own header components,
 * data-testid loops-header) and on SDK 0.6.104 header actions (BB's labelled
 * outline buttons). Writes header.json with the header's buttons and how the
 * pane opened.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CdpClient, ensureChrome } from "./driver.mjs";
import { bbCli, pluginRpc, sleep, threadId as otherThreadId } from "./bb.mjs";
import { BOT_PATH, dismissProblems, SIDEBAR } from "./captures/bb-studio-bot.mjs";

const out = process.env.BOT_HEADER_OUT;
if (!out) throw new Error("Set BOT_HEADER_OUT to the folder for the renders.");
if (!otherThreadId) throw new Error("Source the staged BB's capture.env first (BB_CAPTURE_THREAD_ID).");
await mkdir(out, { recursive: true });

const HEADER = '[data-testid="app-page-header-content-row"]';
const PANE = "[data-testid=loops-pane]";
const { webSocketUrl, process: chromeProcess, profileDir } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
const scheme = (value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
const report = { buttons: {}, header: {}, sidebar: [] };

const clipOf = (selector, pad = 6) => client.evaluate(`(() => {
  const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
  if (!rect) throw new Error("Nothing to crop: ${selector.replace(/"/g, "'")}");
  const x = Math.max(0, rect.left - ${pad}), y = Math.max(0, rect.top - ${pad});
  return { x, y, width: Math.min(innerWidth, rect.right + ${pad}) - x, height: Math.min(innerHeight, rect.bottom + ${pad}) - y };
})()`);
/** The header's buttons, as a user reads them. */
const headerButtons = () => client.evaluate(`[...(document.querySelector(${JSON.stringify(HEADER)})?.querySelectorAll("button") ?? [])].filter((b) => b.offsetParent).map((b) => (b.textContent.trim() || b.getAttribute("aria-label") || b.title || "").replace(/\\s+/g, " "))`);
/** Waits up to `ms` for the Loops pane; the time it took, or null. */
const paneWithin = async (ms) => {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await client.poll(`!!document.querySelector(${JSON.stringify(PANE)})`)) return Date.now() - started;
    await sleep(100);
  }
  return null;
};
/** Navigates; BB may rewrite the address (a project's /projects/<p>/threads/<id>), so a load that doesn't match exactly just gets more time. */
const go = async (path) => { try { await client.navigate(path); } catch { await sleep(3000); } };
/** Closes the side panel's Loops tab so the next open is a real open. */
const closePane = () => client.evaluate(`(() => {
  const pane = document.querySelector(${JSON.stringify(PANE)});
  if (!pane) return true;
  const tab = [...document.querySelectorAll('[role="tab"]')].find((each) => /^Loops/.test(each.textContent.trim()));
  const close = tab?.querySelector('button[aria-label^="Close"]') ?? tab?.parentElement?.querySelector('button[aria-label^="Close"]');
  close?.click();
  return true;
})()`);

/** The header's Loops button: Studio's own (old slot) or BB's labelled header action. */
const clickHeaderLoops = () => client.evaluate(`(() => {
  const old = document.querySelector("[data-testid=loops-header]");
  if (old) { old.click(); return "old header slot"; }
  const header = document.querySelector(${JSON.stringify(HEADER)});
  const button = [...(header?.querySelectorAll("button") ?? [])].find((each) => /^Loops( · \\d+)?$/.test(each.textContent.trim()));
  if (button) { button.click(); return "header action"; }
  return null;
})()`);
/** Opens the header split button's menu (its "More actions"), where Loops follows the Bot's button; null when there's none. */
const openHeaderMenu = () => client.evaluate(`(() => {
  const header = document.querySelector(${JSON.stringify(HEADER)});
  const more = [...(header?.querySelectorAll("button") ?? [])].find((each) => each.offsetParent && each.getAttribute("aria-label") === "More actions");
  if (!more) return false;
  more.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
  more.click();
  return true;
})()`);
/** The open menu's Loops row, clicked; its label. */
const clickMenuLoops = () => client.evaluate(`(() => {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((each) => /^Loops/.test(each.textContent.trim()));
  if (!item) return null;
  const label = item.textContent.trim();
  item.click();
  return label;
})()`);
/** The open menu with the header above it, for the render. */
const clipMenu = () => client.evaluate(`(() => {
  const header = document.querySelector(${JSON.stringify(HEADER)}).getBoundingClientRect();
  const menu = document.querySelector('[role="menu"]')?.getBoundingClientRect() ?? header;
  const x = Math.max(0, Math.min(header.left, menu.left) - 6), y = Math.max(0, header.top - 6);
  return { x, y, width: Math.min(innerWidth, Math.max(header.right, menu.right) + 6) - x, height: Math.min(innerHeight, menu.bottom + 6) - y };
})()`);

try {
  await client.connect();
  await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await bbCli(["studio", "settings", "set", "loopsEnabled", "true"]);
  const { bot } = await pluginRpc("studio", "bot_get", {});
  if (!bot?.threadId) throw new Error("The staged BB has no Bot with a chat; run a Bot or Loops capture first.");

  for (const mode of ["light", "dark"]) {
    await scheme(mode);
    await go(BOT_PATH);
    await client.waitForSelector(SIDEBAR, 60000);
    await dismissProblems(client);
    await client.evaluate(`(() => { document.querySelector('${SIDEBAR} [data-testid=bot-main]').click(); return true; })()`);
    await client.waitForSelector(HEADER, 60000);
    await sleep(4000);
    await closePane();
    await sleep(500);
    report.buttons[mode] = await headerButtons();
    await client.capture(join(out, `header-${mode}.png`), await clipOf(HEADER));
    await client.capture(join(out, `chat-${mode}.png`));

    // Loops is its own button on main; after the header change it's in the Bot button's menu.
    report.header[mode] = await clickHeaderLoops();
    if (!report.header[mode]) {
      if (!(await openHeaderMenu())) throw new Error("No Loops button in the Bot chat's header, and no menu to find it in");
      await sleep(500);
      await client.capture(join(out, `header-menu-${mode}.png`), await clipMenu());
      const label = await clickMenuLoops();
      if (!label) throw new Error("No Loops in the header button's menu");
      report.header[mode] = `header menu: ${label}`;
    }
    const took = await paneWithin(15000);
    report.header[`${mode}Ms`] = took;
    if (took === null) throw new Error(`The Loops pane didn't open from the header (${mode})`);
    await sleep(1200);
    await client.capture(join(out, `loops-pane-${mode}.png`));
  }

  // All loops from the sidebar, while another thread is open: the sidebar
  // isn't in the thread view, so this is the cross-view request path.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await closePane();
    await go(`/threads/${otherThreadId}`);
    await client.waitForSelector(SIDEBAR, 60000).catch(() => {});
    await sleep(1500);
    const clicked = await client.evaluate(`(() => { const row = document.querySelector("[data-testid=bot-all-loops]"); if (!row) return false; row.click(); return true; })()`);
    const took = clicked ? await paneWithin(20000) : null;
    const toast = await client.evaluate(`[...document.querySelectorAll("[data-sonner-toast]")].map((each) => each.textContent.trim()).join(" | ")`);
    report.sidebar.push({ attempt, clicked, openedMs: took, path: await client.evaluate("location.pathname"), toast });
    if (attempt === 1 && took !== null) { await sleep(1200); await client.capture(join(out, "loops-pane-from-sidebar-dark.png")); }
  }
} finally {
  await writeFile(join(out, "header.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  client.socket?.close();
  if (chromeProcess) {
    const exited = new Promise((resolve) => chromeProcess.once("exit", resolve));
    chromeProcess.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
