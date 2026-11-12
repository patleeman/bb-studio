// Captures the site's screenshots from the SCRATCH server (127.0.0.1:38994)
// in headless Chromium at 2x, with the desktop app's framed layout
// (window.bbDesktop = { platform: "macos" }). Themes are switched on the
// scratch Bots through Studio's RPCs; nothing here talks to any other server.
//
//   node capture.mjs <ids.json> <out-dir> [shot ...]
// Needs `playwright` resolvable (see README: npm i in a tools dir, NODE_PATH).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(join(process.env.TOOLS ?? "/tmp/bbsite-tools", "package.json"));
const { chromium } = require("playwright");

const here = dirname(fileURLToPath(import.meta.url));
const scratch = join(here, "scratch.sh");
const ORIGIN = "http://127.0.0.1:38994";
const [idsFile, outDir, ...only] = process.argv.slice(2);
const { ids } = JSON.parse(readFileSync(idsFile, "utf8"));
mkdirSync(outDir, { recursive: true });
const data = process.env.SCRATCH ? join(process.env.SCRATCH, "data") : "/tmp/bbsite/data";
const tmp = mkdtempSync(join(tmpdir(), "bbsite-cap-"));

const bb = (...args) => execFileSync(scratch, ["bb", ...args], { encoding: "utf8" });
let n = 0;
function rpc(method, input) {
  const file = join(tmp, `in${n++}.json`);
  writeFileSync(file, JSON.stringify(input));
  return JSON.parse(bb("plugin", "rpc", "call", "studio", method, "--input-file", file, "--json"));
}
const sql = (db, text) => execFileSync("sqlite3", [db], { input: text, encoding: "utf8" });
const bots = Object.fromEntries(sql(join(data, "plugins/studio/data.db"), "SELECT name, id FROM bots;").trim().split("\n").map((l) => l.split("|")));
const themes = rpc("themes_list", {}).themes.map((t) => t.theme);
function setTheme(botName, themeId) {
  const theme = themes.find((t) => t.id === themeId);
  rpc("bot_set_appearance", {
    botId: bots[botName],
    appearance: { themeId, intensity: theme.defaults.intensity, glass: theme.defaults.glass, motion: theme.defaults.motion, effects: { workers: true, finished: true, needsYou: true, error: true } },
  });
}
// Close every workbench tab on Atlas's Main (BB keeps them on the server).
function resetTabs() {
  const id = ids["atlas-main"];
  const { revision } = JSON.parse(bb("thread", "tabs", "show", id));
  bb("thread", "tabs", "set", id, "--expected-revision", String(revision), "--tabs-json", JSON.stringify([{ id: "plugin-fixed:core:info", kind: "plugin-fixed", pluginId: "core", tabId: "info" }]));
}
resetTabs();
const approval = (on) => sql(join(data, "bb.db"), `UPDATE pending_interactions SET status = '${on ? "pending" : "interrupted"}';`);

const STUB = `(() => { const noop = () => {}; const off = () => noop; const info = { platform: "macos", appVersion: "0.0.0", updateStatus: { state: "idle" } }; const browser = { attach: noop, detach: noop, navigate: noop, goBack: noop, goForward: noop, reload: noop, stop: noop, setBounds: noop, setVisible: noop, onState: off, onOpenTab: off }; window.bbDesktop = { ...info, browser, checkForUpdates: async () => info, getInfo: async () => info, installUpdate: async () => {}, onChange: off, onWindowStateChange: off, getWindowState: async () => ({ isFullScreen: false }), openExternalUrl: noop, setTheme: noop }; })();`;

// Accounts: the scratch server has no Account Pooler and no provider signed
// in, so its accounts.status is empty plus a "No provider signed in" card.
// Every page gets a made-up status instead: fictional accounts with demo
// thread titles, no emails, no tokens. The Accounts panel draws it as it
// would draw a real one.
const NOW = Date.now();
const HOUR_MS = 3_600_000;
const win = (id, label, percent, inHours) => ({ id, label, percent, resetAt: NOW + inHours * HOUR_MS, rejected: percent >= 100 });
const pinned = (...keys) => keys.map((key) => ({ threadId: ids[key], title: { "atlas-main": "Main", "w-links": "Fix broken docs links", "w-settings": "Refactor the settings form" }[key] ?? key })).filter((t) => t.threadId);
const ACCOUNTS = {
  checkedAt: NOW,
  sources: [
    { source: "studio", name: "BB Studio", state: "on" },
    { source: "bb", name: "bb", state: "off" },
    { source: "local", name: "This Mac", state: "on" },
  ],
  accounts: [
    { key: "studio:demo-claude-1", id: "demo-claude-1", source: "studio", provider: "claude", name: "Claude", label: "Personal", state: "ready", message: null,
      windows: [win("five_hour", "5h", 34, 2.5), win("seven_day", "7d", 61, 70)], models: [win("opus", "Opus", 48, 70)], pinned: pinned("atlas-main", "w-links"), signIn: "demo-claude-1" },
    { key: "studio:demo-claude-2", id: "demo-claude-2", source: "studio", provider: "claude", name: "Claude", label: "Studio", state: "limited", message: null,
      windows: [win("five_hour", "5h", 100, 1.2), win("seven_day", "7d", 83, 30)], models: [], pinned: [], signIn: "demo-claude-2" },
    { key: "studio:demo-codex-1", id: "demo-codex-1", source: "studio", provider: "codex", name: "Codex", label: "Personal", state: "ready", message: null,
      windows: [win("primary", "5h", 8, 4), win("secondary", "7d", 22, 120)], models: [], pinned: pinned("w-settings"), signIn: "demo-codex-1" },
  ],
  warnings: [],
  dismissed: [],
};

const browser = await chromium.launch({ args: ["--use-mock-keychain", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, reducedMotion: "no-preference" });
await ctx.addInitScript(STUB);
await ctx.route("**/api/v1/plugins/studio/rpc/accounts.status", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, result: ACCOUNTS }) }));
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
async function go(path, settle = 7000) {
  await page.goto(ORIGIN + path, { waitUntil: "domcontentloaded" });
  await wait(settle);
  // Studio's plugin health card (a Smart Queue key the demo has no use for).
  const hide = page.getByRole("button", { name: "Hide", exact: true });
  if (await hide.count()) { await hide.first().click().catch(() => {}); await wait(500); }
}
async function shot(name, clip) {
  await page.screenshot({ path: join(outDir, `${name}.png`), ...(clip ? { clip } : {}) });
  console.log("shot", name);
}
const main = (bot = "atlas") => `/threads/${ids[`${bot}-main`]}`;
const want = (name) => only.length === 0 || only.some((o) => name.startsWith(o));

// ---- Every scene theme, and two classic ones, on Atlas's Main ------------
const SCENES = ["miami-1985", "event-horizon", "grid", "kyoto-garden", "forest", "aurora-fjord", "tonights-sky", "data-city", "deep-sea"];
const CLASSIC = ["github-light", "catppuccin-mocha"];
if ([...SCENES, ...CLASSIC].some((id) => want(`theme-${id}`))) {
  approval(false);
  for (const id of [...SCENES, ...CLASSIC]) {
    if (!want(`theme-${id}`)) continue;
    // Tonight's Sky at night; Kyoto Garden by day; the rest follow the clock.
    if (id === "tonights-sky") bb("studio", "theme", "sky", "--date", "2026-11-12T21:30");
    else bb("studio", "theme", "sky", "--clear");
    if (id === "kyoto-garden") bb("studio", "theme", "preview", "--date", "2026-11-12T10:30");
    setTheme("Atlas", id);
    await go(main(), 9000);
    await page.mouse.move(1590, 990);
    await shot(`theme-${id}`);
  }
  bb("studio", "theme", "sky", "--clear");
  approval(true);
}

// ---- The approval card and the workers line, Miami 1985 -----------------
setTheme("Atlas", "miami-1985");
if (want("approval")) {
  approval(true);
  await go(main());
  await shot("approval", { x: 560, y: 40, width: 820, height: 178 });
  await shot("main-with-approval");
}

// ---- Conversations and workers: the sidebar, and a worker thread --------
if (want("sidebar")) {
  await go(main());
  await page.getByText(/\d+ done/).first().click().catch(() => {});
  await wait(800);
  await shot("sidebar", { x: 40, y: 40, width: 290, height: 950 });
}
if (want("worker")) {
  await go(`/threads/${ids["w-links"]}`);
  await shot("worker");
}

// ---- Bot pages ----------------------------------------------------------
const PAGES = {
  "page-memory": `/plugins/studio/studio/memory/${bots.Atlas}`,
  "page-library": `/plugins/studio/studio`,
  "page-todos": `/plugins/studio/studio/bot/${bots.Atlas}/loops`,
  "page-automations": `/plugins/studio/automations`,
};
for (const [name, path] of Object.entries(PAGES)) {
  if (!want(name)) continue;
  await go(path);
  await shot(name);
}

// ---- Studio items: each in its own tab ------------------------------------
const features = existsSync(join(dirname(idsFile), "features.json")) ? JSON.parse(readFileSync(join(dirname(idsFile), "features.json"), "utf8")) : null;
if (features) {
  const ITEMS = {
    "item-page": `/plugins/studio/studio/pages/${features.page}`,
    "item-design": `/plugins/studio/studio/designs/${features.design}`,
    "item-whiteboard": `/plugins/studio/studio/drawings/${features.whiteboard}`,
    "item-dashboard": `/plugins/studio/studio/dashboards/${features.dashboard}`,
    "item-mini": `/plugins/studio/studio/minis/${features.mini}`,
    "item-artifact": `/plugins/studio/studio/artifacts/${features.artifacts["release-timeline.svg"]}`,
    "item-recording": `/plugins/studio/studio/recordings/${features.recording}`,
    "item-collection": `/plugins/studio/studio`,
    "item-canvas": `/plugins/studio-visual-chat/canvas/${features.canvasThread}`,
    "item-code": `/plugins/studio/studio/workspaces/${features.workspace}`,
  };
  for (const [name, path] of Object.entries(ITEMS)) {
    if (!want(name)) continue;
    await go(path, name === "item-code" ? 15000 : 9000);
    if (name === "item-design") {
      // Zoom out until the round's three screens fit.
      for (let i = 0; i < 5; i++) { await page.getByRole("button", { name: "Zoom out" }).first().click().catch(() => {}); await wait(300); }
      await wait(1500);
    }
    if (name === "item-code") {
      rpc("code.reveal", { id: features.workspace, path: join(features.repo, "src/sync/queue.ts"), startLine: 9, endLine: 14 });
      await wait(6000);
    }
    await page.mouse.move(1590, 990);
    await shot(name);
  }
  // The page, scrolled to its whiteboard and the mini app embedded in it.
  if (want("item-page-embeds")) {
    await go(`/plugins/studio/studio/pages/${features.page}`, 9000);
    await page.getByText("Rollout", { exact: true }).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.getByText("Rollout", { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: "start" })).catch(() => {});
    await wait(3000);
    await page.mouse.move(1590, 990);
    await shot("item-page-embeds");
  }
}

// ---- Skills, in the Bot's controls ----------------------------------------
if (want("page-skills")) {
  await go(`/plugins/studio/studio/bot/${bots.Atlas}/controls#skills`);
  await page.mouse.move(1590, 990);
  await shot("page-skills");
}

// ---- Accounts, opened from the sidebar footer ----------------------------
if (want("accounts")) {
  // A taller window, so the panel shows all three accounts.
  await page.setViewportSize({ width: 1600, height: 1700 });
  await go(main());
  await page.getByText("Accounts", { exact: true }).last().click();
  await wait(2500);
  // The panel caps its height and scrolls; lift the cap so one shot holds every account.
  // (Studio's list caps at 70vh; bb's footer disclosure at 20rem with a measured height.)
  await page.evaluate(() => {
    let el = document.querySelector("[data-account]");
    for (let i = 0; el && i < 8; i++, el = el.parentElement) {
      el.style.maxHeight = "none";
      if (el.style.height) el.style.height = "auto";
    }
  });
  await wait(800);
  await page.mouse.move(1590, 1690);
  await shot("accounts", { x: 40, y: 40, width: 290, height: 1650 });
  await page.setViewportSize({ width: 1600, height: 1000 });
}

// ---- Cmd+K ---------------------------------------------------------------
if (want("cmdk")) {
  approval(false);
  await go(main());
  await page.keyboard.press("Meta+k");
  await wait(800);
  await page.keyboard.type("lis");
  await wait(1500);
  await shot("cmdk");
  approval(true);
}

// ---- Edit space, with the presence forms and the theme picker ------------
if (want("edit-space")) {
  await go(main());
  // The ··· at the right of the Bot's header in the sidebar.
  await page.mouse.click(293, 77);
  await wait(600);
  await page.getByText("Edit space").first().click();
  await wait(5000);
  await shot("edit-space");
}

// ---- The composer: dictation and hands-free voice -----------------------
if (want("composer")) {
  approval(false);
  await go(main());
  await page.mouse.move(1590, 990);
  await shot("composer");
  approval(true);
}

// ---- The workbench beside Main, split in two panes -----------------------
if (want("workbench")) {
  approval(false);
  resetTabs();
  await go(main());
  await page.keyboard.press("Meta+k");
  await wait(800);
  await page.keyboard.type("launch plan");
  await wait(1500);
  await page.keyboard.press("Enter");
  await wait(3000);
  await page.keyboard.press("Meta+k");
  await wait(800);
  await page.keyboard.type("orbit-web health");
  await wait(1500);
  await page.keyboard.press("Meta+Enter");
  await wait(4000);
  await page.locator("aside").getByText(/launch plan/).first().click().catch(() => {});
  await wait(3000);
  await shot("workbench");
  approval(true);
}

// ---- Reply in thread: the hover icon, the replies row, the thread beside --
if (want("replies")) {
  approval(false);
  resetTabs();
  await go(main());
  await page.mouse.move(900, 500);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -2000); await wait(150); }
  await wait(1200);
  await page.getByText("Morning. Here is where things stand.").first().hover();
  await wait(800);
  await shot("replies");
  const row = page.getByText(/\d+ repl(y|ies)/).first();
  if (await row.count()) {
    await row.click();
    await wait(5000);
    await page.mouse.move(1590, 990);
    await shot("replies-open");
  } else console.log("no replies row");
  approval(true);
}

// ---- Short clips of scene motion (raw webm; build.mjs encodes them) -----
const CLIPS = ["miami-1985", "event-horizon", "aurora-fjord"];
if (CLIPS.some((id) => want(`clip-${id}`))) {
  approval(false);
  resetTabs();
  for (const id of CLIPS) {
    if (!want(`clip-${id}`)) continue;
    setTheme("Atlas", id);
    const rec = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: join(tmp, id), size: { width: 1280, height: 800 } } });
    await rec.addInitScript(STUB);
    await rec.route("**/api/v1/plugins/studio/rpc/accounts.status", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, result: ACCOUNTS }) }));
    const p = await rec.newPage();
    await p.goto(ORIGIN + main(), { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(16000);
    const video = p.video();
    await rec.close();
    execFileSync("cp", [await video.path(), join(outDir, `clip-${id}.webm`)]);
    console.log("clip", id);
  }
  setTheme("Atlas", "miami-1985");
  approval(true);
}

await browser.close();
