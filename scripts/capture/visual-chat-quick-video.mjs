#!/usr/bin/env node
/**
 * Visual Chat quick card: a recording of real use, and stills. In a staged
 * BB, from a thread page: press Visual Chat: Ask's shortcut (Control+Shift+Space),
 * type a quick question, watch the board stream into the card (a real agent
 * turn on the canvas default model), press Esc, summon it again (a fresh
 * chat), press ‹ to step back to the chat before, and press Expand.
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   node scripts/capture/visual-chat-quick-video.mjs --out <dir> [--turn-ms 360000] [--wait-speed 6]
 *
 * Writes <dir>/quick-card-raw.mp4 (full speed, no cuts), quick-card.mp4 (the
 * same, with the wait before the first streamed part sped up by --wait-speed
 * and marked in summary.json), and stills: card-light.png (over the thread),
 * card-dark.png and card-narrow.png (a 760 px wide window). 1600×1000, light.
 */
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CdpClient, ensureChrome } from "./driver.mjs";
import { pluginRpc, projectId, sleep, threadId as pageThread } from "./bb.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => { const at = argv.indexOf(`--${name}`); return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback; };
const OUT = resolve(option("out", "visual-chat-quick"));
const TURN_MS = Number(option("turn-ms", String(6 * 60_000)));
const WAIT_SPEED = Math.max(1, Number(option("wait-speed", "6")));
const QUESTION = option("question", "best Game Boy RPGs under $30?");
const VIEW = { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false };
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
if (!projectId || !pageThread) throw new Error("Source the staged BB's capture.env first (BB_CAPTURE_PROJECT_ID, BB_CAPTURE_THREAD_ID).");
const frames = join(OUT, "frames");
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });

const { webSocketUrl, process: chrome, profileDir } = await ensureChrome();
const tab = new CdpClient(webSocketUrl);
await tab.connect();
await tab.command("Emulation.setDeviceMetricsOverride", VIEW);
const scheme = (value) => tab.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
await scheme("light");
await tab.command("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await tab.command("Page.bringToFront").catch(() => {});

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
const now = () => Date.now() / 1000;

async function until(read, done, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined && done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}; last ${JSON.stringify(value)?.slice(0, 300)}`);
    await sleep(150);
  }
}

/** A key with modifiers (1 Alt, 2 Ctrl, 4 Meta, 8 Shift), down and up, as the keyboard sends it. */
async function press(key, code, keyCode, modifiers = 0) {
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
  await tab.command("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await tab.command("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
/** Visual Chat: Ask's default shortcut, Control+Shift+Space. */
const summon = () => press(" ", "Space", 32, 2 | 8);
const escape = () => press("Escape", "Escape", 27);
const card = (expression) => tab.poll(`(() => { const card = document.querySelector("[data-canvas-card]"); return ${expression}; })()`);
const openCard = (thread) => until(() => card(`card && card.contains(document.activeElement) && document.activeElement.matches("[data-canvas-input]") ? card.getAttribute("data-thread") : null`), (value) => value === thread, 30_000, `the card on ${thread}`);
async function click(selector) {
  const box = await tab.poll(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  if (!box) throw new Error(`Nothing at ${selector}`);
  await tab.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
  await sleep(250);
  for (const type of ["mousePressed", "mouseReleased"]) await tab.command("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
}
async function type(text) {
  for (const piece of text.match(/.{1,3}/g)) {
    await tab.command("Input.insertText", { text: piece });
    await sleep(45);
  }
  await sleep(400);
  await tab.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await tab.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

const marks = {};
let chat = null;
let start = 0;
const threadPath = `/projects/${projectId}/threads/${pageThread}`;
try {
  await tab.navigate(threadPath);
  await tab.waitForSelector("[data-bb-plugin-root], main", 30_000);
  await sleep(2500);
  await tab.command("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 });
  recording = true;
  start = now();
  await sleep(1500);

  // 1. On a thread page, the shortcut opens the card with the field focused.
  log("summon");
  await summon();
  await openCard("new");
  marks.opened = now() - start;
  await sleep(900);
  // 2. A quick question; the board streams into the card.
  log(`ask: ${QUESTION}`);
  await type(QUESTION);
  marks.sent = now() - start;
  chat = await until(() => card(`card?.getAttribute("data-thread")`), (value) => /^thr_/.test(value ?? ""), 60_000, "the new chat");
  await until(() => card(`!!card?.querySelector("[data-canvas-page-frame][data-page-streaming], [data-canvas-page-frame][data-page-rev]:not([data-page-rev='0'])")`), Boolean, TURN_MS, "the first streamed part");
  marks.streaming = now() - start;
  log(`streaming at ${marks.streaming.toFixed(1)} s`);
  const view = await until(() => pluginRpc("studio-visual-chat", "canvas.get", { threadId: chat }).then((result) => result.canvas), (canvas) => canvas.status === "idle" && canvas.history.at(-1)?.role === "agent" && !!canvas.page, TURN_MS, "the turn");
  marks.done = now() - start;
  log(`done at ${marks.done.toFixed(1)} s: ${view.title} — ${view.caption}`);
  await sleep(3500);
  recording = false;
  await tab.capture(join(OUT, "card-light.png"));
  recording = true;
  // 3. Esc closes it; focus goes back to the page.
  await escape();
  await until(() => card("!card"), Boolean, 5000, "the card to close");
  marks.closed = now() - start;
  await sleep(1400);
  // 4. Summoned again: a fresh chat. ‹ steps back to the one before, still in the list.
  await summon();
  await openCard("new");
  marks.fresh = now() - start;
  await sleep(1600);
  await click("[data-canvas-card] [data-canvas-card-back]");
  await until(() => card(`card?.getAttribute("data-thread")`), (value) => value === chat, 10_000, "the previous chat");
  await until(() => card(`!!card?.querySelector("[data-canvas-page-frame][data-page-ready]")`), Boolean, 10_000, "its board");
  marks.back = now() - start;
  await sleep(2600);
  // 5. Expand: the same chat in the full page.
  await click("[data-canvas-card] [data-canvas-card-expand]");
  await until(() => tab.poll("location.pathname"), (path) => path?.endsWith(`/canvas/${chat}`), 10_000, "the full page");
  await until(() => card("!card"), Boolean, 5000, "the card to close on Expand");
  marks.expanded = now() - start;
  await sleep(3200);
  recording = false;
  await tab.command("Page.stopScreencast").catch(() => {});

  // Stills: dark over the thread, and a narrow window.
  await tab.navigate(threadPath);
  await sleep(2500);
  await scheme("dark");
  await sleep(800);
  await summon();
  await openCard("new");
  await sleep(700);
  await click("[data-canvas-card] [data-canvas-card-back]");
  await until(() => card(`!!card?.querySelector("[data-canvas-page-frame][data-page-ready]")`), Boolean, 10_000, "the board, dark");
  await sleep(2500);
  await tab.capture(join(OUT, "card-dark.png"));
  await escape();
  await scheme("light");
  await tab.command("Emulation.setDeviceMetricsOverride", { ...VIEW, width: 760, height: 900 });
  await sleep(1200);
  await summon();
  await openCard("new");
  await sleep(700);
  await click("[data-canvas-card] [data-canvas-card-back]");
  await until(() => card(`!!card?.querySelector("[data-canvas-page-frame][data-page-ready]")`), Boolean, 10_000, "the board, narrow");
  await sleep(2500);
  await tab.capture(join(OUT, "card-narrow.png"));
  marks.rect = await card(`(() => { const r = card.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  await escape();
} finally {
  recording = false;
  await tab.command("Page.stopScreencast").catch(() => {});
  await writeFile(join(OUT, "summary.json"), `${JSON.stringify({ chat, question: QUESTION, waitSpeed: WAIT_SPEED, marks }, null, 2)}\n`);
  tab.close?.();
  chrome?.kill();
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
await sleep(500);

/** The frames as a video; `speed(t)` how much faster the moment t seconds in plays. */
function encode(name, speed) {
  const list = shots.map((shot, index) => {
    const t = shot.at - shots[0].at;
    const span = (shots[index + 1]?.at ?? shot.at + 0.5) - shot.at;
    return `file '${shot.file}'\nduration ${Math.max(0.005, span / speed(t)).toFixed(4)}`;
  }).join("\n");
  const listFile = join(frames, `${name}.txt`);
  execFileSync("sh", ["-c", `cat > ${JSON.stringify(listFile)}`], { input: `${list}\nfile '${shots.at(-1).file}'\n` });
  const video = join(OUT, `${name}.mp4`);
  execFileSync(process.env.FFMPEG ?? "ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", `fps=30,scale=${VIEW.width}:-2:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video]);
  return video;
}
// The recording's clock starts at the first frame, a moment after `start`.
const offset = shots.length ? shots[0].at - (start) : 0;
const waitFrom = (marks.sent ?? 0) + 1.5 - offset;
const waitTo = (marks.streaming ?? 0) - 0.6 - offset;
log(`recording: ${shots.length} frames, ${(shots.at(-1).at - shots[0].at).toFixed(1)} s`);
log(encode("quick-card-raw", () => 1));
log(encode("quick-card", (t) => (t > waitFrom && t < waitTo ? WAIT_SPEED : 1)));
process.exit(0);
