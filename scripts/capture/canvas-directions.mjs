#!/usr/bin/env node
/**
 * Canvas looks (round 2 directions): the same three real agent turns in a
 * canvas per look, with light and dark stills of the real canvas page after
 * each turn. In a staged BB:
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   CANVAS_DIRECTIONS_OUT=<dir> node scripts/capture/canvas-directions.mjs
 *
 * - Each canvas starts with canvas.create {look} and continues with
 *   canvas.send, as the page does; each turn is a real turn in its hidden
 *   thread on the canvas default model (Haiku), in the staged BB's own
 *   provider homes (never Pi). CANVAS_DIRECTIONS_LOOKS picks looks
 *   (default editorial,field,instrument); CANVAS_DIRECTIONS_TURN_MS bounds a
 *   turn (default 10 minutes). The looks run side by side.
 * - CANVAS_DIRECTIONS_PROVIDER, _MODEL and _REASONING override the canvas
 *   default model, e.g. codex / gpt-6-luna / low where the staged BB has no
 *   Claude Code sign-in.
 * - Stills are full-board: the viewport grows to the board's height, up to
 *   2,600 px. Each turn's board is saved as JSON next to its stills.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CdpClient, ensureChrome } from "./driver.mjs";
import { cdpPort, pluginRpc, sleep } from "./bb.mjs";

const out = process.env.CANVAS_DIRECTIONS_OUT;
if (!out) throw new Error("Set CANVAS_DIRECTIONS_OUT to the folder for the stills.");
await mkdir(out, { recursive: true });
const LOOKS = (process.env.CANVAS_DIRECTIONS_LOOKS ?? "editorial,field,instrument").split(",").map((look) => look.trim()).filter(Boolean);
const TURN_MS = Number(process.env.CANVAS_DIRECTIONS_TURN_MS ?? 10 * 60_000);
const PROMPTS = [
  "How did yesterday's election go?",
  "Drill into the closest races",
  "OK, what's the weather this weekend in NYC?",
];
const pick = Object.fromEntries([["providerId", process.env.CANVAS_DIRECTIONS_PROVIDER], ["model", process.env.CANVAS_DIRECTIONS_MODEL], ["reasoningLevel", process.env.CANVAS_DIRECTIONS_REASONING]].filter(([, value]) => value));
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const VIEW = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };

async function until(read, done, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined && done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}; last ${JSON.stringify(value)?.slice(0, 400)}`);
    await sleep(1000);
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

/** The canvas page for this thread, settled: every item measured, no animation running. */
async function settle(client, threadId, rev) {
  await client.command("Page.bringToFront").catch(() => {});
  await client.navigate(`/plugins/canvas/canvas/${threadId}`);
  await client.waitForSelector("[data-canvas-board]", 30_000);
  await collapseSidebar(client);
  await until(() => client.poll(`(() => { const page = document.querySelector("[data-canvas-page]"); const board = document.querySelector("[data-canvas-board]"); return { rev: Number(page?.dataset.canvasRev ?? 0), items: Number(board?.dataset.items ?? 0), measured: Number(board?.dataset.measured ?? 0), running: document.getAnimations().filter((a) => a.playState === "running").length }; })()`), (state) => state.rev >= rev && state.measured >= state.items && state.running === 0, 30_000, "the board to settle").catch((error) => log(String(error.message)));
  await sleep(1800);
}

async function stillFull(client, file) {
  const board = await client.poll(`(() => { const scroll = document.querySelector("[data-canvas-scroll]"); return scroll ? { extra: Math.max(0, scroll.scrollHeight - scroll.clientHeight) } : { extra: 0 }; })()`);
  const height = Math.min(2600, VIEW.height + (board?.extra ?? 0));
  if (height !== VIEW.height) { await client.command("Emulation.setDeviceMetricsOverride", { ...VIEW, height }); await sleep(900); }
  await client.capture(file);
  if (height !== VIEW.height) await client.command("Emulation.setDeviceMetricsOverride", VIEW);
  log("still", file);
}

const canvases = new Map();
async function turn(look, index) {
  const text = PROMPTS[index - 1];
  const before = canvases.get(look);
  log(`${look} turn ${index}: ${text}`);
  let threadId = before?.threadId;
  if (!threadId) ({ threadId } = await pluginRpc("canvas", "canvas.create", { text, look, ...pick }));
  else await pluginRpc("canvas", "canvas.send", { threadId, text });
  const started = Date.now();
  const view = await until(() => pluginRpc("canvas", "canvas.get", { threadId }).then((result) => result.canvas), (canvas) => canvas.turn >= index && canvas.status === "idle" && canvas.history.at(-1)?.role === "agent", TURN_MS, `${look} turn ${index}`);
  const seconds = Math.round((Date.now() - started) / 1000);
  canvases.set(look, { threadId });
  const kinds = view.items.map((item) => item.kind);
  log(`${look} turn ${index}: ${seconds}s, rev ${view.rev}, ${view.items.length} items (${kinds.join(", ")}); caption: ${view.caption}`);
  await writeFile(join(out, `${look}-turn-${index}.json`), JSON.stringify({ look, turn: index, prompt: text, seconds, ...view }, null, 2));
  return { look, index, threadId, view, seconds };
}

try {
  await tabs.light.navigate("/plugins/canvas/canvas");
  await tabs.light.waitForSelector("[data-canvas-input]", 30_000);
  for (let index = 1; index <= PROMPTS.length; index++) {
    const results = await Promise.all(LOOKS.map((look) => turn(look, index)));
    for (const { look, threadId, view } of results) {
      for (const mode of ["light", "dark"]) {
        await settle(tabs[mode], threadId, view.rev);
        await stillFull(tabs[mode], join(out, `${look}-turn-${index}-${mode}.png`));
      }
    }
  }
  await writeFile(join(out, "canvases.json"), JSON.stringify(Object.fromEntries(canvases), null, 2));
} finally {
  tabs.light?.socket?.close();
  tabs.dark?.socket?.close();
  if (chrome) {
    const exited = new Promise((resolvePromise) => chrome.once("exit", resolvePromise));
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
  }
}
