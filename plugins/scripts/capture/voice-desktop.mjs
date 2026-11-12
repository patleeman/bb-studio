#!/usr/bin/env node
/**
 * Hands-free voice on the desktop, in a staged BB's web UI (capture Chrome):
 * renders of each state in light and dark, a short screen recording, the
 * page's console errors and CSP violations, and the session's trace.
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   VOICE_DESKTOP_OUT=<dir> node scripts/capture/voice-desktop.mjs mock
 *   VOICE_DESKTOP_OUT=<dir> BB_CAPTURE_CHROME_ARGS="--use-file-for-fake-audio-capture=<wav>" node scripts/capture/voice-desktop.mjs live
 *
 * mock: the staged BB runs with STUDIO_VOICE_MOCK_URL and
 * packages/bb-studio/scripts/voice-mock/server.ts --script desktop answers as
 * GPT-Live (the panel talks to the staged Studio's real tool layer). live:
 * the staged BB has OPENAI_API_KEY; Chrome's fake mic plays a synthetic voice
 * file, and the panel talks WebRTC to GPT-Live. Everything clicks the real
 * header button and panel. Needs the staged Bot (bot_create) and loops.
 */
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CdpClient, ensureChrome } from "./driver.mjs";
import { pluginRpc, sleep } from "./bb.mjs";

const mode = process.argv[2] ?? "mock";
const out = process.env.VOICE_DESKTOP_OUT;
if (!out) throw new Error("Set VOICE_DESKTOP_OUT to the folder for the renders.");
const frames = join(out, `frames-${mode}`);
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });

const { bot } = await pluginRpc("studio", "bot_get", {});
if (!bot?.threadId) throw new Error("The staged BB has no Bot: run bot_create first.");

const { webSocketUrl, process: chromeProcess, profileDir } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
const scheme = (value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
const exists = (selector) => client.poll(`!!document.querySelector(${JSON.stringify(selector)})`);
const text = (selector) => client.poll(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);

/** The panel and the chat beside it, in light and dark. */
async function render(name) {
  for (const value of ["light", "dark"]) {
    await scheme(value);
    await sleep(220);
    await client.capture(join(out, `${name}${value === "dark" ? "-dark" : ""}.png`));
  }
  await scheme("light");
}

let frame = 0;
async function recordFrame() {
  const shot = await client.command("Page.captureScreenshot", { format: "jpeg", quality: 70 });
  await writeFile(join(frames, `f${String(frame++).padStart(5, "0")}.jpg`), Buffer.from(shot.data, "base64"));
}

try {
  await client.connect();
  await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await scheme("light");
  await client.navigate(`/threads/${bot.threadId}`);
  // Console errors and CSP violations: anything in BB's window that blocks the mic, WebRTC or the socket.
  await client.evaluate(`(() => {
    window.__voiceProblems = [];
    const note = (kind, detail) => window.__voiceProblems.push({ kind, detail: String(detail).slice(0, 400), at: Date.now() });
    addEventListener("securitypolicyviolation", (event) => note("csp", event.violatedDirective + " " + event.blockedURI));
    addEventListener("error", (event) => note("error", event.message));
    addEventListener("unhandledrejection", (event) => note("rejection", event.reason?.message ?? event.reason));
    const error = console.error.bind(console);
    console.error = (...args) => { note("console", args.map(String).join(" ")); error(...args); };
    return true;
  })()`);
  await client.waitForSelector('[data-testid="handsfree-header"]', 60000);
  await sleep(800);

  // The header button, close up.
  const box = await client.evaluate(`(() => { const r = document.querySelector('[data-testid="handsfree-header"]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  for (const value of ["light", "dark"]) {
    await scheme(value);
    await sleep(220);
    await client.capture(join(out, `header-button${value === "dark" ? "-dark" : ""}.png`), { x: Math.max(0, box.x - 420), y: Math.max(0, box.y - 16), width: 520, height: box.height + 32 });
  }
  await scheme("light");

  // Idle: the panel open, before Start.
  await client.evaluate(`document.querySelector('[data-testid="handsfree-header"]').click()`);
  await client.waitForSelector('[data-testid="handsfree-start"]');
  await sleep(400);
  await render("idle");

  // A session: Start, then no clicks. Each state is rendered the first time it shows.
  await client.evaluate(`document.querySelector('[data-testid="handsfree-start"]').click()`);
  const seen = new Set();
  const started = Date.now();
  while (Date.now() - started < (mode === "live" ? 150_000 : 120_000)) {
    await recordFrame();
    const status = await text('[data-testid="handsfree-status"]');
    const speaker = await client.poll(`document.querySelector('[data-testid="handsfree-orb"]')?.dataset.speaker ?? ""`);
    const subtitle = await text('[data-testid="handsfree-subtitle"]');
    const states = {
      listening: status === "Listening" && !subtitle,
      speaking: speaker === "agent" && subtitle.length > 40 && !(await exists('[data-testid="handsfree-card"]')),
      confirm: await exists('[data-testid="handsfree-confirm"]'),
      sent: await exists('[data-testid="handsfree-sent"]'),
    };
    for (const [name, now] of Object.entries(states)) {
      if (now && !seen.has(name)) {
        seen.add(name);
        process.stdout.write(`  ${name}\n`);
        await render(name);
      }
    }
    // A live session doesn't end by itself: VOICE_DESKTOP_END_AFTER clicks End after that many seconds.
    const endAfter = Number(process.env.VOICE_DESKTOP_END_AFTER ?? 0);
    if (endAfter && Date.now() - started > endAfter * 1000 && await exists('[data-testid="handsfree-end"]')) {
      await client.evaluate(`document.querySelector('[data-testid="handsfree-end"]').click()`);
    }
    // The session is over once Start is back (ended, failed or closed by the voice).
    if (Date.now() - started > 3000 && await exists('[data-testid="handsfree-start"]')) {
      for (let i = 0; i < 8; i++) { await recordFrame(); await sleep(120); }
      process.stdout.write(`  ended: ${status}\n`);
      break;
    }
    await sleep(110);
  }
  await render("ended");

  const trace = await client.evaluate(`JSON.stringify(window.__studioVoiceLive?.trace ?? [])`);
  const problems = await client.evaluate(`JSON.stringify(window.__voiceProblems ?? [])`);
  await writeFile(join(out, `trace-${mode}.json`), trace);
  await writeFile(join(out, `problems-${mode}.json`), problems);
  const seconds = (Date.now() - started) / 1000;
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", String(Math.max(2, frame / seconds).toFixed(2)), "-i", join(frames, "f%05d.jpg"),
    "-vf", "scale=1280:-2,format=yuv420p", "-c:v", "libx264", "-crf", "26", "-preset", "veryfast", join(out, `handsfree-desktop-${mode}.mp4`)]);
  process.stdout.write(`States: ${[...seen].join(", ")}; ${frame} frames in ${seconds.toFixed(0)} s. Problems: ${problems}\n`);
} finally {
  client.socket?.close();
  if (chromeProcess) {
    const exited = new Promise((resolve) => chromeProcess.once("exit", resolve));
    chromeProcess.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
