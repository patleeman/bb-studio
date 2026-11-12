#!/usr/bin/env node
/**
 * Canvas plugin (prototype) demo in a staged BB: four text turns (yesterday's
 * election, the closest races, a chart, then the weekend weather) and one
 * hands-free voice turn, recorded from the real canvas page.
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   CANVAS_DEMO_OUT=<dir> node scripts/capture/canvas-demo.mjs
 *
 * - Each turn is a real agent turn in the canvas's hidden BB thread, on the
 *   staged BB's default provider (its own provider homes; never Pi).
 *   CANVAS_DEMO_TURN_MS bounds a turn (default 8 minutes).
 * - Light tab: recorded (CDP screencast → MP4) with a still after each turn
 *   and one mid-animation. Dark tab: the same canvas, a still after each turn.
 * - Voice: the staged BB runs with STUDIO_VOICE_MOCK_URL; this starts
 *   packages/bb-studio/scripts/voice-mock/server.ts with its canvas script,
 *   which plays GPT-Live's side; Studio's voice calls the Canvas plugin's
 *   canvas.voice / canvas.voiceRun RPCs, which edit the real board.
 *   It needs a Bot: the seeded thread becomes one (no agent run).
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, ensureChrome } from "./driver.mjs";
import { cdpPort, pluginRpc, sleep, threadId as seededThread } from "./bb.mjs";

const out = process.env.CANVAS_DEMO_OUT;
if (!out) throw new Error("Set CANVAS_DEMO_OUT to the folder for the demo.");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const frames = join(out, "frames");
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });
const TURN_MS = Number(process.env.CANVAS_DEMO_TURN_MS ?? 8 * 60_000);
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

const VIEW = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const { webSocketUrl, process: chrome, profileDir } = await ensureChrome();
const light = new CdpClient(webSocketUrl);
await light.connect();
const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" })).json();
const dark = new CdpClient(target.webSocketDebuggerUrl);
await dark.connect();
for (const [client, scheme] of [[light, "light"], [dark, "dark"]]) {
  await client.command("Emulation.setDeviceMetricsOverride", VIEW);
  await client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await client.command("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
}

// The recording: every screencast frame with its time.
const shots = [];
let recording = false;
light.socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method !== "Page.screencastFrame") return;
  light.socket.send(JSON.stringify({ id: 900_000_000 + shots.length, method: "Page.screencastFrameAck", params: { sessionId: message.params.sessionId } }));
  if (!recording) return;
  const file = join(frames, `f${String(shots.length).padStart(5, "0")}.jpg`);
  shots.push({ file, at: message.params.metadata.timestamp });
  void writeFile(file, Buffer.from(message.params.data, "base64"));
});

const page = (client, expression) => client.poll(`(() => { const page = document.querySelector("[data-canvas-page]"); return ${expression}; })()`);
async function collapseSidebar(client) {
  await client.evaluate(`(() => { const sidebar = document.querySelector('[data-sidebar="sidebar"]'); const state = sidebar?.closest('[data-state]')?.getAttribute('data-state'); if (sidebar && state !== 'collapsed' && state !== 'closed') document.querySelector('button[aria-label^="Toggle sidebar" i]')?.click(); return true; })()`);
  await sleep(500);
}
async function until(read, done, ms = 120_000, what = "condition") {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}; last ${JSON.stringify(value)}`);
    await sleep(120);
  }
}
const still = async (client, name) => { await client.capture(join(out, `${name}.png`)); log("still", name); };

/** Pauses every animation shortly after the board's next revision lands, for a mid-animation still. */
const armMidAnimation = (client) => client.evaluate(`(() => {
  window.__canvasMid = "armed";
  const page = document.querySelector("[data-canvas-page]");
  const start = page.dataset.canvasRev;
  const observer = new MutationObserver(() => {
    if (page.dataset.canvasRev === start) return;
    observer.disconnect();
    setTimeout(() => {
      const running = document.getAnimations().filter((animation) => animation.playState === "running");
      running.forEach((animation) => animation.pause());
      window.__canvasMidAnimations = running;
      window.__canvasMid = running.length ? "paused:" + running.length : "none";
    }, 230);
  });
  observer.observe(page, { attributes: true, attributeFilter: ["data-canvas-rev"] });
  return true;
})()`);
const resume = (client) => client.evaluate(`(() => { (window.__canvasMidAnimations ?? []).forEach((animation) => animation.play()); window.__canvasMid = "done"; return true; })()`);

async function type(client, text) {
  await client.evaluate(`document.querySelector("[data-canvas-input]")?.focus()`);
  for (const word of text.split(/(?<= )/)) {
    await client.command("Input.insertText", { text: word });
    await sleep(70);
  }
  await sleep(350);
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

let canvasPath = null;
async function turn(index, text, { mid = false } = {}) {
  log(`turn ${index}: ${text}`);
  const before = canvasPath ? Number(await page(light, "page?.dataset.canvasRev ?? 0")) : 0;
  const turnBefore = canvasPath ? (await pluginRpc("studio-visual-chat", "canvas.get", { threadId: canvasPath.split("/").pop() })).canvas.turn : 0;
  if (mid) { await armMidAnimation(light); if (canvasPath) await armMidAnimation(dark); }
  await type(light, text);
  if (!canvasPath) {
    canvasPath = await until(() => light.poll("location.pathname"), (path) => /\/canvas\/thr_/.test(path ?? ""), 60_000, "the new canvas");
    await dark.navigate(canvasPath);
    await collapseSidebar(dark);
  }
  const threadId = canvasPath.split("/").pop();
  if (mid) {
    const state = await until(() => light.poll("window.__canvasMid"), (value) => value !== "armed", TURN_MS, "a board change");
    if (String(state).startsWith("paused")) {
      await still(light, `mid-animation-turn-${index}`);
      const darkState = await dark.poll("window.__canvasMid");
      if (String(darkState).startsWith("paused")) await still(dark, `mid-animation-turn-${index}-dark`);
      await sleep(600);
      await resume(light);
      await resume(dark).catch(() => {});
    } else log("no animation was running at the pause", state);
  }
  const view = await until(() => pluginRpc("studio-visual-chat", "canvas.get", { threadId }).then((result) => result.canvas), (canvas) => canvas.turn > turnBefore && canvas.status === "idle" && canvas.history.at(-1)?.role === "agent", TURN_MS, `turn ${index} to finish`);
  log(`turn ${index}: rev ${view.rev}, ${view.items.length} items, caption: ${view.caption}`);
  await until(() => page(light, "Number(page?.dataset.canvasRev)"), (rev) => rev >= view.rev, 15_000, "the light tab");
  await until(() => page(dark, "Number(page?.dataset.canvasRev)"), (rev) => rev >= view.rev, 15_000, "the dark tab");
  await sleep(2200);
  await still(light, `turn-${index}-light`);
  await still(dark, `turn-${index}-dark`);
  return view;
}

let mock = null;
try {
  await light.navigate("/plugins/studio-visual-chat/canvas/new");
  await light.waitForSelector("[data-canvas-input]");
  await collapseSidebar(light);
  await sleep(800);
  await light.command("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 });
  recording = true;
  await sleep(1200);

  await turn(1, "How did yesterday's election go?");
  await sleep(1500);
  await turn(2, "Drill into the closest races");
  await sleep(1500);
  await turn(3, "Chart the margins and turnout", { mid: true });
  await sleep(1500);
  await turn(4, "OK, what's the weather this weekend in NYC?", { mid: true });
  await sleep(2000);

  // History peek.
  await light.evaluate(`document.querySelector('button[aria-label="History"]')?.click()`);
  await sleep(700);
  await still(light, "history-light");
  await light.evaluate(`document.querySelector('button[aria-label="History"]')?.click()`);
  await sleep(500);

  // Hands-free voice: the mock plays GPT-Live; each tool call is the staged Studio's real canvas tool.
  let { bot } = await pluginRpc("studio", "bot_get", {});
  if (!bot) ({ bot } = await pluginRpc("studio", "bot_create", { name: "Dot", avatar: "🟣", shape: "blob", color: "#7c66dc", threadId: seededThread }));
  mock = spawn(join(repo, "packages/bb-studio/node_modules/.bin/tsx"), ["scripts/voice-mock/server.ts", "--port", "8797", "--out", join(out, "voice-mock"), "canvas"], { cwd: join(repo, "packages/bb-studio"), stdio: ["ignore", "pipe", "pipe"] });
  mock.stdout.on("data", (chunk) => process.stdout.write(`[mock] ${chunk}`));
  mock.stderr.on("data", (chunk) => process.stderr.write(`[mock] ${chunk}`));
  await sleep(2500);
  const threadId = canvasPath.split("/").pop();
  log("voice turn");
  await light.evaluate(`document.querySelector("[data-canvas-handsfree]")?.click()`);
  await until(() => pluginRpc("studio-visual-chat", "canvas.get", { threadId }).then((result) => result.canvas.items.map((item) => item.id)), (ids) => ids.includes("voice-saturday-hourly"), 60_000, "the voice's first board edit");
  await sleep(1800);
  await still(light, "voice-1-light");
  await until(() => pluginRpc("studio-visual-chat", "canvas.get", { threadId }).then((result) => result.canvas.items.map((item) => item.id)), (ids) => ids.includes("voice-sunday-rain"), 60_000, "the voice's second board edit");
  await sleep(1800);
  await still(light, "voice-2-light");
  await still(dark, "voice-2-dark");
  await until(() => pluginRpc("studio-visual-chat", "canvas.get", { threadId }).then((result) => result.canvas.changes.filter((change) => change.by === "voice").length), (count) => count >= 3, 60_000, "the voice's last edit");
  await sleep(6000);
  await still(light, "voice-end-light");
  recording = false;
  await light.command("Page.stopScreencast");

  // The recording: each frame shown until the next one.
  await sleep(500);
  const list = shots.map((shot, index) => `file '${shot.file}'\nduration ${Math.max(0.01, ((shots[index + 1]?.at ?? shot.at + 0.5) - shot.at)).toFixed(3)}`).join("\n");
  await writeFile(join(frames, "list.txt"), `${list}\nfile '${shots.at(-1).file}'\n`);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(frames, "list.txt"), "-vf", "fps=30,scale=1440:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-movflags", "+faststart", join(out, "canvas-demo.mp4")]);
  log(`recording: ${shots.length} frames, ${(shots.at(-1).at - shots[0].at).toFixed(0)} s → ${join(out, "canvas-demo.mp4")}`);
  await rm(frames, { recursive: true, force: true });
} finally {
  mock?.kill();
  light.socket?.close();
  dark.socket?.close();
  if (chrome) {
    const exited = new Promise((resolvePromise) => chrome.once("exit", resolvePromise));
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
