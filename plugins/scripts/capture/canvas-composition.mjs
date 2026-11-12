#!/usr/bin/env node
/**
 * Canvas composition: real agent turns in ONE canvas, captured at two
 * window sizes in light and dark, and a hand-placed reference board for each
 * turn rendered through the same page, for comparison. In a staged BB:
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   CANVAS_COMPOSITION_OUT=<dir> node scripts/capture/canvas-composition.mjs
 *   CANVAS_COMPOSITION_OUT=<dir> CANVAS_COMPOSITION_REFS=<dir> CANVAS_COMPOSITION_THREAD=<thread> \
 *     node scripts/capture/canvas-composition.mjs
 *
 * - Turns (no CANVAS_COMPOSITION_THREAD): the prompts below, in one canvas,
 *   each a real turn in its hidden thread on the canvas default model (Haiku)
 *   in the staged BB's provider homes (never Pi). After each, stills at
 *   1800×1150 and 1200×800, light and dark (turn-<n>-<size>-<mode>.png), the
 *   board as JSON (turn-<n>.json, for writing its reference), and what the
 *   page measured: the composition, whether it scrolls, overlapping items and
 *   lines.
 * - A follow-up caught mid-morph (CANVAS_COMPOSITION_THREAD and _FOLLOWUP):
 *   sends that message to the canvas and pauses the page's animations
 *   about 260 ms into its first change (turn-<n>-mid-animation-wide-light.png),
 *   then takes the four stills.
 * - References (CANVAS_COMPOSITION_THREAD and _REFS): for each ref-<n>.json in
 *   _REFS ({look, title, caption, composition, items}, items with fixed: {x, y,
 *   w} as shares of the board, and fixedNarrow for the narrow window when it
 *   differs), the canvas page shows that board in place of its own (the page's
 *   bb-studio-canvas:preview event) and the same four stills are taken
 *   (ref-<n>-<size>-<mode>.png).
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CdpClient, ensureChrome } from "./driver.mjs";
import { cdpPort, pluginRpc, sleep } from "./bb.mjs";

const out = process.env.CANVAS_COMPOSITION_OUT;
if (!out) throw new Error("Set CANVAS_COMPOSITION_OUT to the folder for the stills.");
await mkdir(out, { recursive: true });
const refsDir = process.env.CANVAS_COMPOSITION_REFS ?? null;
const refThread = process.env.CANVAS_COMPOSITION_THREAD ?? null;
const TURN_MS = Number(process.env.CANVAS_COMPOSITION_TURN_MS ?? 10 * 60_000);
const only = process.env.CANVAS_COMPOSITION_ONLY ? new Set(process.env.CANVAS_COMPOSITION_ONLY.split(",").map(Number)) : null;

// Sample numbers, labelled as such in the prompt.
const TICKETS = [
  "week,email,chat,phone,in_app,median_first_reply_min,csat_pct,backlog",
  "W32,410,620,140,90,42,88,120", "W33,430,650,150,110,45,87,135", "W34,420,700,138,140,51,85,160", "W35,445,760,141,180,58,83,190",
  "W36,460,810,150,240,66,81,240", "W37,470,880,149,310,74,79,300", "W38,455,940,145,390,81,77,360", "W39,480,1010,152,470,88,76,420",
].join("\n");
const PROMPTS = [
  { id: "election", text: "give me a rundown of the election yesterday" },
  { id: "studio", text: "give me an overview of BB Studio" },
  { id: "plan", text: "Help me plan next week: a product launch on Thursday, two candidate interviews to run, a dentist appointment, and I want three gym sessions in." },
  { id: "data", text: `Here's sample data (made up, for a demo) of our support team's tickets by week and channel, with reply time, CSAT and backlog. How are we doing?\n\n${TICKETS}` },
  { id: "follow-up", text: "Which channel should we fix first, and what would it take?" },
  // From Patrick's BB: a showcase has to be visual (pictures, ratings drawn).
  { id: "showcase", text: "I just bought a Chromatic, give me a showcase of games including ratings" },
];
const SIZES = { wide: { width: 1800, height: 1150 }, narrow: { width: 1200, height: 800 } };
const TABS = [["wide", "light"], ["wide", "dark"], ["narrow", "light"], ["narrow", "dark"]];
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

async function until(read, done, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined && done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}; last ${JSON.stringify(value)?.slice(0, 400)}`);
    await sleep(500);
  }
}

const { webSocketUrl, process: chrome } = await ensureChrome();
const tabs = {};
for (const [index, [size, mode]] of TABS.entries()) {
  const url = index === 0 ? webSocketUrl : (await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" })).json()).webSocketDebuggerUrl;
  const client = new CdpClient(url);
  await client.connect();
  await client.command("Emulation.setDeviceMetricsOverride", { ...SIZES[size], deviceScaleFactor: 1, mobile: false });
  await client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] });
  await client.command("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  tabs[`${size}-${mode}`] = client;
}

async function open(threadId) {
  for (const client of Object.values(tabs)) {
    await client.navigate(`/plugins/studio-visual-chat/canvas/${threadId}`);
    await client.waitForSelector("[data-canvas-board], [data-canvas-page-frame][data-page-ready]", 30_000);
    await client.evaluate(`(() => { const sidebar = document.querySelector('[data-sidebar="sidebar"]'); const state = sidebar?.closest('[data-state]')?.getAttribute('data-state'); if (sidebar && state !== 'collapsed' && state !== 'closed') document.querySelector('button[aria-label^="Toggle sidebar" i]')?.click(); return true; })()`);
  }
  await sleep(800);
}

/** What the page shows: the composition, the frame, whether it scrolls, and any overlapping items (text over text) or lines. */
const measure = `(() => {
  const frame = document.querySelector("[data-canvas-page-frame]");
  if (frame) {
    const page = document.querySelector("[data-canvas-page]");
    return { rev: Number(page?.dataset.canvasRev ?? 0), look: page?.dataset.cvLook, page: true, ready: frame.dataset.pageReady !== undefined, pageRev: Number(frame.dataset.pageRev ?? 0), items: 0, measured: 0, running: 0, overlaps: [], scrolls: false, title: document.querySelector("[data-canvas-page] button[aria-haspopup=menu] span")?.textContent ?? null };
  }
  const page = document.querySelector("[data-canvas-page]");
  const board = document.querySelector("[data-canvas-board]");
  const scroll = document.querySelector("[data-canvas-scroll]");
  const items = [...document.querySelectorAll("[data-canvas-item]")].map((el) => ({ id: el.dataset.canvasItem, kind: el.dataset.canvasKind, scale: el.dataset.scale, floating: el.dataset.floating !== undefined, r: el.getBoundingClientRect() }));
  const overlaps = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i].r, b = items[j].r;
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 2 && h > 2) overlaps.push(items[i].id + "/" + items[j].id);
  }
  return {
    rev: Number(page?.dataset.canvasRev ?? 0), look: page?.dataset.cvLook, composition: board?.dataset.canvasComposition, frame: board?.dataset.frame,
    items: Number(board?.dataset.items ?? 0), measured: Number(board?.dataset.measured ?? 0),
    scrolls: scroll ? scroll.scrollHeight - scroll.clientHeight > 4 : false, overflow: scroll ? Math.max(0, scroll.scrollHeight - scroll.clientHeight) : 0,
    overlaps, lines: document.querySelectorAll("[data-canvas-link]").length, dots: document.querySelectorAll("[data-canvas-dot]").length,
    title: document.querySelector("[data-canvas-page] button[aria-haspopup=menu] span")?.textContent ?? null,
    running: document.getAnimations().filter((a) => a.playState === "running").length,
  };
})()`;

async function settle(client, rev) {
  await client.command("Page.bringToFront").catch(() => {});
  const state = await until(() => client.poll(measure), (s) => s.rev >= rev && (s.page ? s.ready && s.pageRev >= rev : s.measured >= s.items && s.running === 0), 45_000, "the board to settle").catch((error) => { log(String(error.message)); return null; });
  // A page's frame animates inside its own (cross-origin) document: give its morph time to finish.
  await sleep(state?.page ? 2600 : 1600);
  return (await client.poll(measure)) ?? state;
}

async function stills(prefix, rev) {
  const pages = {};
  for (const [size, mode] of TABS) {
    const client = tabs[`${size}-${mode}`];
    const state = await settle(client, rev);
    await client.capture(join(out, `${prefix}-${size}-${mode}.png`));
    pages[`${size}-${mode}`] = state;
    log("still", `${prefix}-${size}-${mode}.png`, JSON.stringify({ composition: state?.composition, scrolls: state?.scrolls, overlaps: state?.overlaps, lines: state?.lines }));
  }
  return pages;
}

/**
 * A page morph caught halfway: in the wide-light tab, an observer in the page's frame (an isolated world, so
 * the page's own scripts don't see it) pauses every animation ~260 ms after the page changes; the still is
 * taken, then they play on.
 */
async function midMorph(threadId, text, n) {
  const client = tabs["wide-light"];
  await client.command("Page.bringToFront").catch(() => {});
  // The page's frame is sandboxed, so it runs as its own (out-of-process) target under this tab.
  const { targetInfo } = await client.command("Target.getTargetInfo");
  const { targetInfos } = await client.command("Target.getTargets");
  const frame = targetInfos.find((target) => target.type === "iframe" && target.parentId === targetInfo.targetId && target.url === "about:srcdoc");
  if (!frame) throw new Error("No page frame to catch mid-morph.");
  const { sessionId } = await client.command("Target.attachToTarget", { targetId: frame.targetId, flatten: true });
  const inFrame = (expression) => client.command("Runtime.evaluate", { expression, returnByValue: true }, 10_000, sessionId).then((result) => result.result?.value);
  await inFrame(`(() => { const root = document.getElementById("cv-page"); const observer = new MutationObserver(() => { observer.disconnect(); setTimeout(() => { document.getAnimations().forEach((a) => a.pause()); document.documentElement.dataset.captureMid = String(document.getAnimations().length); }, 260); }); observer.observe(root, { childList: true }); return true; })()`);
  const before = (await pluginRpc("studio-visual-chat", "canvas.get", { threadId })).canvas;
  await pluginRpc("studio-visual-chat", "canvas.send", { threadId, text });
  const paused = await until(() => inFrame(`document.documentElement.dataset.captureMid ?? null`), (value) => value !== null && value !== undefined, TURN_MS, "the page to change").catch(() => null);
  log(`mid-morph: ${paused} animations paused`);
  await client.capture(join(out, `turn-${n}-mid-animation-wide-light.png`));
  await inFrame(`(() => { document.getAnimations().forEach((a) => a.play()); delete document.documentElement.dataset.captureMid; return true; })()`);
  const done = await until(() => pluginRpc("studio-visual-chat", "canvas.get", { threadId }).then((result) => result.canvas), (canvas) => canvas.turn > before.turn && canvas.status === "idle" && canvas.history.at(-1)?.role === "agent", TURN_MS, "the follow-up");
  const pages = await stills(`turn-${n}`, done.rev);
  await writeFile(join(out, `turn-${n}.json`), JSON.stringify({ turn: n, prompt: text, look: done.look, title: done.title, caption: done.caption, parts: [...(done.page ?? "").matchAll(/data-cv-id=["']?([^"'\s>]+)/g)].map((match) => match[1]), mid: paused, pages, view: done }, null, 2));
}

try {
  if (process.env.CANVAS_COMPOSITION_FOLLOWUP && refThread) {
    await open(refThread);
    await midMorph(refThread, process.env.CANVAS_COMPOSITION_FOLLOWUP, Number(process.env.CANVAS_COMPOSITION_TURN ?? 7));
  } else if (refThread) {
    if (!refsDir) throw new Error("Set CANVAS_COMPOSITION_REFS to the folder with ref-<n>.json.");
    await open(refThread);
    const rev = (await pluginRpc("studio-visual-chat", "canvas.get", { threadId: refThread })).canvas.rev;
    const files = (await readdir(refsDir)).filter((name) => /^ref-\d+\.json$/.test(name)).sort();
    const report = {};
    for (const file of files) {
      const n = Number(/\d+/.exec(file)[0]);
      if (only && !only.has(n)) continue;
      const ref = JSON.parse(await readFile(join(refsDir, file), "utf8"));
      for (const [size, mode] of TABS) {
        const items = ref.items.map((item) => ({ ...item, fixed: size === "narrow" && item.fixedNarrow ? item.fixedNarrow : item.fixed }));
        await tabs[`${size}-${mode}`].evaluate(`window.dispatchEvent(new CustomEvent("bb-studio-canvas:preview", { detail: ${JSON.stringify({ ...ref, items })} })); true`);
      }
      await sleep(600);
      report[n] = await stills(`ref-${n}`, rev);
    }
    await writeFile(join(out, "references.json"), JSON.stringify(report, null, 2));
  } else {
    const results = [];
    let threadId = null;
    let opened = false;
    // CANVAS_COMPOSITION_PROMPTS=election,showcase runs only those (numbered as in the full list).
    const pick = process.env.CANVAS_COMPOSITION_PROMPTS ? new Set(process.env.CANVAS_COMPOSITION_PROMPTS.split(",")) : null;
    for (const [index, prompt] of PROMPTS.entries()) {
      if (pick && !pick.has(prompt.id)) continue;
      const n = index + 1;
      log(`turn ${n}: ${prompt.text.split("\n")[0]}`);
      const before = threadId ? (await pluginRpc("studio-visual-chat", "canvas.get", { threadId })).canvas : null;
      const started = Date.now();
      if (!threadId) ({ threadId } = await pluginRpc("studio-visual-chat", "canvas.create", { text: prompt.text }));
      else await pluginRpc("studio-visual-chat", "canvas.send", { threadId, text: prompt.text });
      if (!opened) { await open(threadId); opened = true; }
      const turnBefore = before?.turn ?? 0;
      const done = await until(() => pluginRpc("studio-visual-chat", "canvas.get", { threadId }).then((result) => result.canvas), (canvas) => canvas.turn > turnBefore && canvas.status === "idle" && canvas.history.at(-1)?.role === "agent", TURN_MS, `turn ${n}`);
      const seconds = Math.round((Date.now() - started) / 1000);
      const compositionChanges = done.changes.filter((change) => change.turn === done.turn).map((change) => change.summary);
      log(`turn ${n}: ${seconds}s, ${done.look}, title "${done.title}", ${done.page ? `page ${done.page.length} chars` : `${done.items.length} items`}`);
      const pages = await stills(`turn-${n}`, done.rev);
      const result = { turn: n, id: prompt.id, prompt: prompt.text.split("\n")[0], seconds, look: done.look, title: done.title, caption: done.caption, changes: compositionChanges, parts: [...(done.page ?? "").matchAll(/data-cv-id=["']?([^"'\s>]+)/g)].map((match) => match[1]), pages };
      results.push(result);
      await writeFile(join(out, `turn-${n}.json`), JSON.stringify({ ...result, view: done }, null, 2));
    }
    await writeFile(join(out, "results.json"), JSON.stringify({ threadId, results }, null, 2));
    log(`thread ${threadId}`);
  }
} finally {
  for (const client of Object.values(tabs)) client.socket?.close();
  if (chrome) {
    const exited = new Promise((resolvePromise) => chrome.once("exit", resolvePromise));
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
  }
}
