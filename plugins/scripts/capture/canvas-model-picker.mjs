#!/usr/bin/env node
/**
 * The Canvas model picker in a staged BB: a real turn on the default
 * (Claude Code, Haiku 5.5), stills of the top bar with the picker closed
 * and with its menu open, then a switch to another provider in the menu
 * (Codex, CANVAS_PICKER_MODEL, default gpt-6-luna) and a real turn typed in
 * the page, which starts the canvas's fresh thread on that model.
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   CANVAS_PICKER_OUT=<dir> node scripts/capture/canvas-model-picker.mjs
 *
 * results.json records each turn's thread and the execution Canvas has for
 * it, plus the thread's provider as BB reports it. Never pick Pi here: its
 * sessions can't be kept out of the real history.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CdpClient, ensureChrome } from "./driver.mjs";
import { bbCli, cdpPort, pluginRpc, sleep } from "./bb.mjs";

const out = process.env.CANVAS_PICKER_OUT;
if (!out) throw new Error("Set CANVAS_PICKER_OUT to the folder for the stills.");
await mkdir(out, { recursive: true });
const SWITCH_TO = { providerId: "codex", model: process.env.CANVAS_PICKER_MODEL ?? "gpt-6-luna" };
const TURN_MS = 10 * 60_000;
const VIEW = { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false };
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

async function until(read, done, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined && done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}; last ${JSON.stringify(value)?.slice(0, 300)}`);
    await sleep(500);
  }
}
const view = (threadId) => pluginRpc("studio-visual-chat", "canvas.get", { threadId }).then((result) => result.canvas);
const idleAfter = (threadId, turn) => until(() => view(threadId), (canvas) => canvas.turn > turn && canvas.status === "idle" && canvas.history.at(-1)?.role === "agent", TURN_MS, "the turn");
async function providerOf(threadId) {
  const thread = JSON.parse(await bbCli(["thread", "get", threadId, "--json"]));
  return (thread.thread ?? thread).providerId ?? null;
}

const { webSocketUrl, process: chrome } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
await client.connect();
void cdpPort;
await client.command("Emulation.setDeviceMetricsOverride", VIEW);
await client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: process.env.CANVAS_PICKER_SCHEME ?? "light" }] });
await client.command("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
const results = [];
const still = async (name, clip) => { await client.capture(join(out, `${name}.png`), clip); log("still", name); };
const TOP = { x: 0, y: 0, width: VIEW.width, height: 150 };

try {
  // Turn 1, on the canvas default.
  const { threadId } = await pluginRpc("studio-visual-chat", "canvas.create", { text: "How did yesterday's election go?" });
  log("turn 1 on", threadId);
  const first = await idleAfter(threadId, 0);
  results.push({ turn: 1, threadId, execution: first.execution, threadProvider: await providerOf(threadId), caption: first.caption });
  await client.navigate(`/plugins/studio-visual-chat/canvas/${threadId}`);
  await client.waitForSelector("[data-canvas-model-picker] button", 30_000);
  await client.evaluate(`(() => { const sidebar = document.querySelector('[data-sidebar="sidebar"]'); const state = sidebar?.closest('[data-state]')?.getAttribute('data-state'); if (sidebar && state !== 'collapsed' && state !== 'closed') document.querySelector('button[aria-label^="Toggle sidebar" i]')?.click(); return true; })()`);
  await until(() => client.poll(`document.querySelector("[data-canvas-model]")?.textContent ?? ""`), (text) => /Haiku 5\.5/.test(text), 20_000, "the picker's label");
  await sleep(2500);
  await still("1-picker-closed-top", TOP);
  await still("1-picker-closed-full");

  // The menu, open.
  await client.evaluate(`document.querySelector("[data-canvas-model]").click(); true`);
  await client.waitForSelector("[data-canvas-model-menu]", 10_000);
  await until(() => client.poll(`document.querySelectorAll("[data-canvas-model-option]").length`), (count) => count > 3, 20_000, "the menu's models");
  await sleep(600);
  await still("2-picker-menu-open", { x: 520, y: 0, width: 920, height: VIEW.height });
  await still("2-picker-menu-open-full");

  // Switch to Codex in the menu: it waits for the next message.
  await client.evaluate(`(() => { const option = document.querySelector('[data-canvas-model-option="${SWITCH_TO.providerId}/${SWITCH_TO.model}"]'); option.scrollIntoView({ block: "center" }); option.click(); return true; })()`);
  const picked = await until(() => view(threadId), (canvas) => canvas.pendingExecution?.model === SWITCH_TO.model, 20_000, "the waiting switch");
  log("picked", JSON.stringify(picked.pendingExecution));
  await client.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); true`);
  await sleep(1200);
  await still("3-picker-switch-waiting-top", TOP);

  // Turn 2, typed in the page: it starts the canvas's fresh thread on Codex, and the page follows it.
  const turnBefore = picked.turn;
  await client.evaluate(`document.querySelector("[data-canvas-input]")?.focus()`);
  await client.command("Input.insertText", { text: "Drill into the closest races" });
  await sleep(300);
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  const path = await until(() => client.poll("location.pathname"), (value) => value && !value.endsWith(threadId), 60_000, "the page to follow the new thread");
  const fresh = path.split("/").pop();
  log("turn 2 on", fresh);
  const second = await idleAfter(fresh, turnBefore);
  results.push({ turn: 2, threadId: fresh, execution: second.execution, pendingExecution: second.pendingExecution, threadProvider: await providerOf(fresh), oldThreadFindsCanvas: (await view(threadId))?.id === second.id, items: second.items.length, caption: second.caption });
  await until(() => client.poll(`Number(document.querySelector("[data-canvas-page]")?.dataset.canvasRev ?? 0)`), (rev) => rev >= second.rev, 20_000, "the page to catch up");
  await sleep(3000);
  await still("4-after-switch-codex-full");
  await client.evaluate(`document.querySelector("[data-canvas-model]").click(); true`);
  await client.waitForSelector("[data-canvas-model-menu]", 10_000);
  await sleep(600);
  await still("4-after-switch-menu", { x: 520, y: 0, width: 920, height: VIEW.height });
  await writeFile(join(out, "results.json"), JSON.stringify(results, null, 2));
  log(JSON.stringify(results.map(({ caption, ...rest }) => rest)));
} finally {
  client.socket?.close();
  if (chrome) {
    const exited = new Promise((resolvePromise) => chrome.once("exit", resolvePromise));
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
  }
}
