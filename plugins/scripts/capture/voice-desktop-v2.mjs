#!/usr/bin/env node
/**
 * Hands-free voice on the desktop, v2 (the composer button and the floating
 * pill), in a staged BB's web UI: renders in light and dark of the composer
 * button, the pill (connecting, listening, speaking, sent), the expanded
 * "yes" question and transcript, the pill over another Studio page and over
 * another thread, the voice thread under the Bot, and a short recording.
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   VOICE_DESKTOP_OUT=<dir> node scripts/capture/voice-desktop-v2.mjs
 *
 * The staged BB runs with STUDIO_VOICE_MOCK_URL, and
 * packages/bb-studio/scripts/voice-mock/server.ts --script desktop answers as
 * GPT-Live; the pill talks to the staged Studio's real tool layer. Needs the
 * staged Bot (bot_create) and loops. Moving between pages mid-session uses
 * the app's own router (history.pushState), so the session keeps running.
 */
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CdpClient, ensureChrome } from "./driver.mjs";
import { pluginRpc, sleep, threadId as orbitThreadId } from "./bb.mjs";

const out = process.env.VOICE_DESKTOP_OUT;
if (!out) throw new Error("Set VOICE_DESKTOP_OUT to the folder for the renders.");
const frames = join(out, "frames");
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });

const { bot } = await pluginRpc("studio", "bot_get", {});
if (!bot?.threadId) throw new Error("The staged BB has no Bot: run bot_create first.");

const { webSocketUrl, process: chromeProcess, profileDir } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
const scheme = (value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
const exists = (selector) => client.poll(`!!document.querySelector(${JSON.stringify(selector)})`);
const text = (selector) => client.poll(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);
const click = (selector) => client.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
/** In-app navigation: BB's router follows pushState, the page (and the session) stays. */
const go = async (path) => {
  await client.evaluate(`(() => { history.pushState({}, "", ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent("popstate")); return true; })()`);
  await sleep(1500);
};

async function render(name, clip) {
  for (const value of ["light", "dark"]) {
    await scheme(value);
    await sleep(220);
    await client.capture(join(out, `${name}${value === "dark" ? "-dark" : ""}.png`), clip ? await clip() : undefined);
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
  await client.waitForSelector('[data-testid="handsfree-composer"]', 60000);
  await sleep(800);

  // The composer button, in the composer's bottom row.
  const composerClip = async () => client.evaluate(`(() => { const r = document.querySelector('[data-testid="handsfree-composer"]').getBoundingClientRect(); return { x: Math.max(0, r.x - 520), y: Math.max(0, r.y - 110), width: 640, height: 170, scale: 1 }; })()`);
  await render("composer-button", composerClip);

  // Start from the composer: from now on it's the floating pill.
  await click('[data-testid="handsfree-composer"]');
  const seen = new Set();
  const started = Date.now();
  let movedAway = false;
  while (Date.now() - started < 120_000) {
    await recordFrame();
    if (!(await exists('[data-testid="handsfree-pill"]'))) { await sleep(100); continue; }
    // The pill as it appears, before the session is up.
    if (!seen.has("pill-idle")) { seen.add("pill-idle"); process.stdout.write("  pill-idle\n"); await render("pill-idle"); }
    const status = await text('[data-testid="handsfree-status"]');
    const speaker = await client.poll(`document.querySelector('[data-testid="handsfree-orb"]')?.dataset.speaker ?? ""`);
    const subtitle = await text('[data-testid="handsfree-subtitle"]');
    const states = {
      "pill-listening": status === "Listening" && !subtitle,
      "pill-speaking": speaker === "agent" && subtitle.length > 30,
      "pill-sent": await exists('[data-testid="handsfree-sent"]'),
      "expanded-yes": await exists('[data-testid="handsfree-confirm"]'),
    };
    for (const [name, now] of Object.entries(states)) {
      if (!now || seen.has(name)) continue;
      seen.add(name);
      process.stdout.write(`  ${name}\n`);
      await render(name);
      if (name === "pill-sent") {
        // On demand: the transcript, the model, cost and mic, and the voice thread's link.
        await click('[data-testid="handsfree-expand"]');
        await sleep(400);
        await render("expanded-transcript");
        await click('[data-testid="handsfree-expand"]');
      }
    }
    // Mid-session, away from the Bot's chat: another Studio page, then another thread. The pill stays.
    if (!movedAway && seen.has("pill-sent")) {
      movedAway = true;
      await go("/plugins/studio/studio");
      await recordFrame();
      if (await exists('[data-testid="handsfree-pill"]')) { process.stdout.write("  pill-other-page\n"); await render("pill-other-page"); }
      if (orbitThreadId) {
        await go(`/threads/${orbitThreadId}`);
        await recordFrame();
        if (await exists('[data-testid="handsfree-pill"]')) { process.stdout.write("  pill-other-thread\n"); await render("pill-other-thread"); }
      }
    }
    if (await exists('[data-testid="handsfree-close"]')) {
      for (let i = 0; i < 8; i++) { await recordFrame(); await sleep(120); }
      process.stdout.write(`  ended: ${await text('[data-testid="handsfree-status"]')}\n`);
      await click('[data-testid="handsfree-expand"]');
      await sleep(400);
      await render("pill-ended-transcript");
      // The transcript's link opens the session's voice thread (hidden from BB's list, under the Bot).
      await click('[data-testid="handsfree-thread"]');
      await client.waitForText("Hands-free voice session", 20000).then(async () => { await sleep(800); process.stdout.write("  voice-thread-opened\n"); await render("voice-thread-opened"); }, () => process.stdout.write("  (the voice thread didn't open)\n"));
      break;
    }
    await sleep(110);
  }

  // The voice thread lives under the Bot: its Recent, not BB's main list.
  await sleep(3000);
  await client.navigate("/plugins/studio/studio/bot");
  await client.waitForText("Voice ·", 30000).catch(() => process.stdout.write("  (the Bot page didn't show the voice thread)\n"));
  await sleep(800);
  await render("voice-thread-under-bot");

  const trace = await client.evaluate(`JSON.stringify(window.__studioVoiceLive?.trace ?? [])`).catch(() => "[]");
  await writeFile(join(out, "trace.json"), trace);
  const seconds = (Date.now() - started) / 1000;
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", String(Math.max(2, frame / seconds).toFixed(2)), "-i", join(frames, "f%05d.jpg"),
    "-vf", "scale=1280:-2,format=yuv420p", "-c:v", "libx264", "-crf", "26", "-preset", "veryfast", join(out, "handsfree-desktop-pill.mp4")]);
  await rm(frames, { recursive: true, force: true });
  process.stdout.write(`States: ${[...seen].join(", ")}; ${frame} frames in ${seconds.toFixed(0)} s.\n`);
} finally {
  client.socket?.close();
  if (chromeProcess) {
    const exited = new Promise((resolve) => chromeProcess.once("exit", resolve));
    chromeProcess.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
