#!/usr/bin/env node
/**
 * Visual Chat demo video: ONE real conversation in a new canvas, recorded at
 * full speed with no cuts. Each prompt is typed into the chat field on camera
 * and sent with Enter, like a person would; every turn is a real agent turn
 * (the canvas default, Claude Code's Sonnet 5.5, in the staged BB's provider
 * homes). In a staged BB:
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   node scripts/capture/canvas-demo-video.mjs --out <dir> [--turn-ms 360000]
 *
 * Writes <dir>/visual-chat-demo.mp4 (H.264, 1600×1000, light), a still after
 * each turn (turn-N.png) and summary.json: per turn, the parts (data-cv-id)
 * kept from the board before it, added and removed, so a follow-up that
 * rebuilt the page with new ids instead of morphing shows up.
 */
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CdpClient, ensureChrome } from "./driver.mjs";
import { pluginRpc, sleep } from "./bb.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => { const at = argv.indexOf(`--${name}`); return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback; };
const OUT = resolve(option("out", "visual-chat-demo"));
const TURN_MS = Number(option("turn-ms", String(6 * 60_000)));
const PROMPTS = [
  "I just bought a Chromatic, give me a showcase of games including ratings",
  "Swap in more RPGs",
  "Which of these are under $30 used?",
  "What accessories should I get for it?",
];
const VIEW = { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false };
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const frames = join(OUT, "frames");
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });

const { webSocketUrl, process: chrome, profileDir } = await ensureChrome();
const tab = new CdpClient(webSocketUrl);
await tab.connect();
await tab.command("Emulation.setDeviceMetricsOverride", VIEW);
await tab.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await tab.command("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await tab.command("Page.bringToFront").catch(() => {});

// Every screencast frame with its time; the video shows each until the next.
const shots = [];
let recording = false;
tab.socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method !== "Page.screencastFrame") return;
  tab.socket.send(JSON.stringify({ id: 900_000_000 + shots.length, method: "Page.screencastFrameAck", params: { sessionId: message.params.sessionId } }));
  if (!recording) return;
  const file = join(frames, `f${String(shots.length).padStart(6, "0")}.jpg`);
  shots.push({ file, at: message.params.metadata.timestamp });
  void writeFile(file, Buffer.from(message.params.data, "base64"));
});

async function until(read, done, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined && done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}; last ${JSON.stringify(value)?.slice(0, 300)}`);
    await sleep(250);
  }
}
const ids = (page) => [...String(page ?? "").matchAll(/data-cv-id\s*=\s*"([^"]+)"/g)].map((match) => match[1]);

/** Types the prompt into the chat field a few characters at a time, then sends it with Enter. */
async function type(text) {
  await tab.evaluate(`document.querySelector("[data-canvas-input]")?.focus()`);
  for (const piece of text.match(/.{1,3}/g)) {
    await tab.command("Input.insertText", { text: piece });
    await sleep(45);
  }
  await sleep(500);
  await tab.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await tab.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

const summary = [];
let threadId = null;
let start = 0;
try {
  await tab.navigate("/plugins/studio-visual-chat/canvas/new");
  await tab.waitForSelector("[data-canvas-input]", 30_000);
  await tab.evaluate(`(() => { const sidebar = document.querySelector('[data-sidebar="sidebar"]'); const state = sidebar?.closest('[data-state]')?.getAttribute('data-state'); if (sidebar && state !== 'collapsed' && state !== 'closed') document.querySelector('button[aria-label^="Toggle sidebar" i]')?.click(); return true; })()`);
  await sleep(1000);
  await tab.command("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 });
  recording = true;
  start = Date.now();
  await sleep(1500);
  for (const [index, prompt] of PROMPTS.entries()) {
    const n = index + 1;
    const before = threadId ? (await pluginRpc("studio-visual-chat", "canvas.get", { threadId })).canvas : null;
    const sentAt = (Date.now() - start) / 1000;
    log(`turn ${n} at ${sentAt.toFixed(1)} s: ${prompt}`);
    await type(prompt);
    if (!threadId) threadId = (await until(() => tab.poll("location.pathname"), (path) => /\/canvas\/thr_/.test(path ?? ""), 60_000, "the new canvas")).split("/").pop();
    const view = await until(
      () => pluginRpc("studio-visual-chat", "canvas.get", { threadId }).then((result) => result.canvas),
      (canvas) => canvas.turn > (before?.turn ?? 0) && canvas.status === "idle" && canvas.history.at(-1)?.role === "agent",
      TURN_MS, `turn ${n}`,
    );
    const doneAt = (Date.now() - start) / 1000;
    // Let the page settle and the caption be read.
    await sleep(3500);
    await tab.capture(join(OUT, `turn-${n}.png`));
    const was = ids(before?.page), now = ids(view.page);
    const kept = now.filter((id) => was.includes(id));
    const entry = {
      turn: n, prompt, sentAt: Number(sentAt.toFixed(1)), doneAt: Number(doneAt.toFixed(1)),
      parts: now.length, kept: kept.length, added: now.filter((id) => !was.includes(id)), removed: was.filter((id) => !now.includes(id)),
      board: !before?.page ? "built" : kept.length ? "morphed" : "rebuilt (no part kept its id)",
      versions: view.versions.length, caption: view.caption, look: view.look, title: view.title,
    };
    summary.push(entry);
    log(`turn ${n}: ${entry.board}; ${entry.kept} kept, +${entry.added.length}, -${entry.removed.length}; ${entry.versions} versions; caption: ${view.caption}`);
  }
  await sleep(1500);
} finally {
  recording = false;
  await tab.command("Page.stopScreencast").catch(() => {});
  await writeFile(join(OUT, "summary.json"), `${JSON.stringify({ threadId, turns: summary }, null, 2)}\n`);
  tab.close?.();
  chrome?.kill();
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
await sleep(500);
const list = shots.map((shot, index) => `file '${shot.file}'\nduration ${Math.max(0.01, ((shots[index + 1]?.at ?? shot.at + 0.5) - shot.at)).toFixed(3)}`).join("\n");
await writeFile(join(frames, "list.txt"), `${list}\nfile '${shots.at(-1).file}'\n`);
const video = join(OUT, "visual-chat-demo.mp4");
execFileSync(process.env.FFMPEG ?? "ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(frames, "list.txt"), "-vf", `fps=30,scale=${VIEW.width}:-2:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video]);
await rm(frames, { recursive: true, force: true });
log(`recording: ${shots.length} frames, ${(shots.at(-1).at - shots[0].at).toFixed(1)} s → ${video}`);
process.exit(0);
