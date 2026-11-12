#!/usr/bin/env node
/**
 * Canvas styles: real agent turns in ONE canvas, where the agent picks each
 * board's style itself. Light and dark stills of the real canvas page after
 * each turn, plus a still paused mid-switch. In a staged BB:
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   CANVAS_DIRECTIONS_OUT=<dir> node scripts/capture/canvas-directions.mjs
 *
 * - The canvas starts with canvas.create and continues with canvas.send, as
 *   the page does. Each turn is a real turn in its hidden thread on the
 *   canvas default model (Haiku), in the staged BB's provider homes (never
 *   Pi). CANVAS_DIRECTIONS_TURN_MS bounds a turn (default 10 minutes).
 *   CANVAS_DIRECTIONS_PROVIDER, _MODEL and _REASONING override the model.
 * - The prompts never name a style. results.json records, per turn, the
 *   style the agent picked and its reason (from the board's change log).
 * - Stills are full-board: the viewport grows to the board's height, up to
 *   2,600 px. The mid-switch still pauses every animation and transition
 *   ~350 ms after the first board change of the first turn that switches.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CdpClient, ensureChrome } from "./driver.mjs";
import { cdpPort, pluginRpc, sleep } from "./bb.mjs";

const out = process.env.CANVAS_DIRECTIONS_OUT;
if (!out) throw new Error("Set CANVAS_DIRECTIONS_OUT to the folder for the stills.");
await mkdir(out, { recursive: true });
const TURN_MS = Number(process.env.CANVAS_DIRECTIONS_TURN_MS ?? 10 * 60_000);
const pick = Object.fromEntries([["providerId", process.env.CANVAS_DIRECTIONS_PROVIDER], ["model", process.env.CANVAS_DIRECTIONS_MODEL], ["reasoningLevel", process.env.CANVAS_DIRECTIONS_REASONING]].filter(([, value]) => value));

// Sample numbers, labelled as such in the prompt: a staged BB has no real fleet to report on.
const METRICS = [
  "hour,cpu_pct,mem_gb,p95_ms,errors_per_min,active_agents,queued_turns",
  "00,22,3.1,180,0.2,4,0", "01,19,3.0,175,0.1,3,0", "02,18,3.0,170,0.1,2,0", "03,21,3.1,190,0.3,3,1",
  "04,35,3.4,240,0.4,6,2", "05,48,3.9,310,0.9,9,4", "06,61,4.4,420,1.8,12,7", "07,72,4.9,610,3.6,15,11",
  "08,78,5.2,880,6.1,17,16", "09,74,5.1,720,4.2,16,12", "10,66,4.8,520,2.4,14,8", "11,63,4.7,470,1.9,13,6",
].join("\n");
const PROMPTS = [
  { id: "election", text: "How did yesterday's election go?", expect: "editorial" },
  { id: "trip", text: "Help me plan a weekend trip to the Hudson Valley with my family", expect: "field" },
  { id: "server", text: `Here's a sample export of my BB server's stats for the last 12 hours (made-up numbers, for a demo). How are my server and agents doing right now?\n\n${METRICS}\n\nHosts: mac-mini (up 41 days, 9 agents), homelab (up 12 days, 4 agents), cloud-1 (restarted 2 h ago, 0 agents).`, expect: "instrument" },
  { id: "worry", text: "Which of these should I worry about?", expect: "instrument" },
];
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const VIEW = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };

async function until(read, done, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined && done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}; last ${JSON.stringify(value)?.slice(0, 400)}`);
    await sleep(500);
  }
}

const { webSocketUrl, process: chrome, profileDir } = await ensureChrome();
const tabs = {};
{
  const light = new CdpClient(webSocketUrl);
  await light.connect();
  const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" })).json();
  const dark = new CdpClient(target.webSocketDebuggerUrl);
  await dark.connect();
  for (const [client, scheme] of [[light, "light"], [dark, "dark"]]) {
    await client.command("Emulation.setDeviceMetricsOverride", VIEW);
    await client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    // Both tabs act focused and visible, so animations and frames run in each.
    await client.command("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    tabs[scheme] = client;
  }
}

async function collapseSidebar(client) {
  await client.evaluate(`(() => { const sidebar = document.querySelector('[data-sidebar="sidebar"]'); const state = sidebar?.closest('[data-state]')?.getAttribute('data-state'); if (sidebar && state !== 'collapsed' && state !== 'closed') document.querySelector('button[aria-label^="Toggle sidebar" i]')?.click(); return true; })()`);
  await sleep(500);
}

const boardState = `(() => { const page = document.querySelector("[data-canvas-page]"); const board = document.querySelector("[data-canvas-board]"); return { rev: Number(page?.dataset.canvasRev ?? 0), look: page?.dataset.cvLook, items: Number(board?.dataset.items ?? 0), measured: Number(board?.dataset.measured ?? 0), running: document.getAnimations().filter((a) => a.playState === "running").length }; })()`;

/** The canvas page, settled at this revision: every item measured, no animation running. */
async function settle(client, rev) {
  await client.command("Page.bringToFront").catch(() => {});
  await until(() => client.poll(boardState), (state) => state.rev >= rev && state.measured >= state.items && state.running === 0, 45_000, "the board to settle").catch((error) => log(String(error.message)));
  await sleep(1500);
}

async function stillFull(client, file) {
  const board = await client.poll(`(() => { const scroll = document.querySelector("[data-canvas-scroll]"); return scroll ? { extra: Math.max(0, scroll.scrollHeight - scroll.clientHeight) } : { extra: 0 }; })()`);
  const height = Math.min(2600, VIEW.height + (board?.extra ?? 0));
  if (height !== VIEW.height) { await client.command("Emulation.setDeviceMetricsOverride", { ...VIEW, height }); await sleep(900); }
  await client.capture(file);
  if (height !== VIEW.height) await client.command("Emulation.setDeviceMetricsOverride", VIEW);
  log("still", file);
}

/** Pauses every animation and transition shortly after the next change of style on the page. */
const armMidSwitch = (client) => client.evaluate(`(() => {
  window.__canvasMid = "armed";
  const page = document.querySelector("[data-canvas-page]");
  const start = page.dataset.cvLook;
  const observer = new MutationObserver(() => {
    if (page.dataset.cvLook === start) return;
    observer.disconnect();
    setTimeout(() => {
      const running = document.getAnimations().filter((animation) => animation.playState === "running");
      running.forEach((animation) => animation.pause());
      window.__canvasMidAnimations = running;
      window.__canvasMid = "paused:" + running.length + ":" + start + ">" + page.dataset.cvLook;
    }, 350);
  });
  observer.observe(page, { attributes: true, attributeFilter: ["data-cv-look"] });
  return true;
})()`);
const resume = (client) => client.evaluate(`(() => { (window.__canvasMidAnimations ?? []).forEach((animation) => animation.play()); window.__canvasMid = "done"; return true; })()`);

const results = [];
let threadId = null;
let midDone = false;
try {
  for (const [index, prompt] of PROMPTS.entries()) {
    const n = index + 1;
    log(`turn ${n}: ${prompt.text.split("\n")[0]}`);
    const before = threadId ? (await pluginRpc("studio-visual-chat", "canvas.get", { threadId })).canvas : null;
    // Before turns 2+, both tabs watch for a style switch to pause mid-animation (once).
    if (threadId && !midDone) for (const mode of ["light", "dark"]) await armMidSwitch(tabs[mode]);
    const started = Date.now();
    if (!threadId) ({ threadId } = await pluginRpc("studio-visual-chat", "canvas.create", { text: prompt.text, ...pick }));
    else await pluginRpc("studio-visual-chat", "canvas.send", { threadId, text: prompt.text });
    if (n === 1) {
      for (const mode of ["light", "dark"]) {
        await tabs[mode].navigate(`/plugins/studio-visual-chat/canvas/${threadId}`);
        await tabs[mode].waitForSelector("[data-canvas-board]", 30_000);
        await collapseSidebar(tabs[mode]);
      }
    }
    const turnBefore = before?.turn ?? 0;
    let mid = null;
    const view = await until(async () => {
      if (threadId && !midDone && n > 1 && !mid) {
        const state = await tabs.light.poll("window.__canvasMid");
        if (String(state).startsWith("paused")) mid = state;
      }
      return (await pluginRpc("studio-visual-chat", "canvas.get", { threadId })).canvas;
    }, (canvas) => mid !== null || (canvas.turn > turnBefore && canvas.status === "idle" && canvas.history.at(-1)?.role === "agent"), TURN_MS, `turn ${n}`);
    if (mid) {
      midDone = true;
      log(`mid-switch: ${mid}`);
      await tabs.light.capture(join(out, `turn-${n}-mid-switch-light.png`));
      const darkMid = await tabs.dark.poll("window.__canvasMid");
      if (String(darkMid).startsWith("paused")) { await tabs.dark.command("Page.bringToFront").catch(() => {}); await tabs.dark.capture(join(out, `turn-${n}-mid-switch-dark.png`)); }
      log("still mid-switch");
      await sleep(400);
      await resume(tabs.light);
      await resume(tabs.dark).catch(() => {});
    } else if (n > 1 && !midDone) {
      for (const mode of ["light", "dark"]) await tabs[mode].evaluate("window.__canvasMid = 'off'; true");
    }
    const done = await until(() => pluginRpc("studio-visual-chat", "canvas.get", { threadId }).then((result) => result.canvas), (canvas) => canvas.turn > turnBefore && canvas.status === "idle" && canvas.history.at(-1)?.role === "agent", TURN_MS, `turn ${n}`);
    const seconds = Math.round((Date.now() - started) / 1000);
    const styleChanges = done.changes.filter((change) => change.op === "style" && change.turn === done.turn);
    const result = {
      turn: n, prompt: prompt.text.split("\n")[0], expected: prompt.expect, picked: done.look,
      matched: done.look === prompt.expect, switched: !!styleChanges.length,
      reason: styleChanges.at(-1)?.summary ?? null, seconds, items: done.items.map((item) => ({ id: item.id, kind: item.kind, accent: item.options?.accent ?? null })),
      caption: done.caption,
    };
    results.push(result);
    log(`turn ${n}: ${seconds}s, style ${done.look} (expected ${prompt.expect})${result.reason ? `; ${result.reason}` : ""}; ${done.items.length} items (${done.items.map((item) => item.kind + (item.options?.accent ? `:${item.options.accent}` : "")).join(", ")})`);
    await writeFile(join(out, `turn-${n}.json`), JSON.stringify({ ...result, view: done }, null, 2));
    for (const mode of ["light", "dark"]) {
      await settle(tabs[mode], done.rev);
      await stillFull(tabs[mode], join(out, `turn-${n}-${done.look}-${mode}.png`));
    }
  }
  await writeFile(join(out, "results.json"), JSON.stringify({ threadId, results }, null, 2));
} finally {
  tabs.light?.socket?.close();
  tabs.dark?.socket?.close();
  if (chrome) {
    const exited = new Promise((resolvePromise) => chrome.once("exit", resolvePromise));
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  void profileDir;
}
