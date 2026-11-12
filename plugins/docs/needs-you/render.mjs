#!/usr/bin/env node
/**
 * Before and after renders for docs/needs-you/REDO.md, from a staged BB. It
 * reuses the Bot captures' fixtures (scripts/capture/captures/bb-studio-bot.mjs):
 * the Bot "Dot", its thread "Rotate the ORBIT-42 deploy key" asking a
 * question, and the Deploy watch runner's urgent report. Each view is saved
 * dark and light as docs/needs-you/<label>/<view>-<scheme>.png at 2x.
 *
 *   BB_STAGED_DIR=$TMPDIR/bb-studio-staged-<you> BB_STAGED_PORT=<port> node scripts/staged-bb.mjs start --ref <commit>
 *   . "$BB_STAGED_DIR/capture.env"
 *   node docs/needs-you/render.mjs before [view,...]
 *
 * For after, install this branch's Studio into the same staged BB from a
 * local copy (`bb plugin remove studio`, then `bb plugin install
 * <copy>/packages/bb-studio --yes` with the staged CLI; Studio's data stays),
 * give the Bot something for the user (REDO.md), then run it with `after`.
 * After views open a project thread, not the Bot's chat: an open chat is a
 * read one, and the Bot's badge clears. The after run also records the badge
 * clearing as the Bot's chat is opened (read-clears.mp4 and .gif).
 */
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCapture } from "../../scripts/capture/lifecycle.mjs";
import { CdpClient, ensureChrome } from "../../scripts/capture/driver.mjs";
import { projectId, threadId, pluginRpc, bbCli, sleep } from "../../scripts/capture/bb.mjs";
import { BOT_PATH, SIDEBAR, botFixtures, dismissProblems } from "../../scripts/capture/captures/bb-studio-bot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
if (label !== "before" && label !== "after") throw new Error("Usage: node docs/needs-you/render.mjs <before|after> [view,...]");
const only = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
if (!projectId || !threadId) throw new Error("Source the staged BB's capture.env first.");

const fixtures = botFixtures({ projectId, pluginRpc, bbCli, sleep });
const START = label === "before" ? BOT_PATH : `/projects/${projectId}/threads/${threadId}`;

const size = (client, width, height, scale = 1) => client.command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });

/** The Bots list with the seeded Bot, its runners and the thread asking a question. */
const botsView = async (client) => {
  await fixtures.seededRunners();
  await client.navigate(START);
  await client.waitForSelector(SIDEBAR, 60000);
  await dismissProblems(client);
  if (label === "after") await client.waitForSelector(`${SIDEBAR} [data-testid=bot-attention]`, 60000);
  await sleep(1000);
};
const sidebarClip = (client) => client.evaluate(`(() => { const r = document.querySelector('${SIDEBAR}').getBoundingClientRect(); return { x: r.x, y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 420) }; })()`);

/** Bot info, scrolled to its Activity. */
const infoView = async (client) => {
  await botsView(client);
  await client.evaluate(`(() => { document.querySelector('${SIDEBAR} [data-testid=bot-main] + [data-testid=bot-info]').click(); return true; })()`);
  await client.waitForSelector('[aria-label="Dot info"]', 30000);
  await client.evaluate(`(() => {
    const heading = [...document.querySelectorAll('[aria-label="Dot info"] h3')].find((each) => each.textContent.trim() === "Activity");
    if (!heading) throw new Error("No Activity in Bot info");
    heading.scrollIntoView({ block: "start" });
    return true;
  })()`);
  await sleep(1200);
};
const infoClip = (client) => client.evaluate(`(() => {
  const heading = [...document.querySelectorAll('[aria-label="Dot info"] h3')].find((each) => each.textContent.trim() === "Activity");
  const panel = document.querySelector('[aria-label="Dot info"]').getBoundingClientRect();
  const r = heading.getBoundingClientRect();
  return { x: panel.x, y: r.y - 8, width: panel.width, height: Math.min(360, innerHeight - r.y) };
})()`);

const VIEWS = {
  sidebar: { setup: botsView, clip: sidebarClip },
  info: { setup: infoView, clip: infoClip },
};

/** The Bot's badge, then its chat opened (read): the badge clears. MP4 and GIF, dark, the whole window. */
async function recordReadClears(client, outDir) {
  await size(client, 1280, 800, 1);
  await scheme(client, "dark");
  await runCapture(client, botsView, async () => {
    const frames = join(tmpdir(), `needs-you-frames-${process.pid}`);
    await mkdir(frames, { recursive: true });
    const shots = [];
    let recording = true;
    const loop = (async () => {
      while (recording) {
        const frame = join(frames, `${String(shots.length).padStart(4, "0")}.png`);
        await client.capture(frame);
        shots.push({ frame, at: Date.now() });
      }
    })();
    await sleep(1500);
    await client.evaluate(`(() => { document.querySelector('${SIDEBAR} [data-testid=bot-main]').click(); return true; })()`);
    // The sidebar polls every 15 s; reading the chat clears the badge by the next one.
    for (let i = 0; i < 40 && await client.evaluate(`!!document.querySelector('${SIDEBAR} [data-testid=bot-attention]')`); i++) await sleep(1000);
    await sleep(1500);
    recording = false;
    await loop;
    const list = shots.map((shot, i) => `file '${shot.frame}'\nduration ${(((shots[i + 1]?.at ?? shot.at + 80) - shot.at) / 1000).toFixed(3)}`).join("\n");
    await writeFile(join(frames, "list.txt"), `ffconcat version 1.0\n${list}\nfile '${shots.at(-1).frame}'\n`);
    const mp4 = join(outDir, "read-clears.mp4");
    const gif = join(outDir, "read-clears.gif");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(frames, "list.txt"), "-vf", "fps=20,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", mp4]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-vf", "fps=12,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none", gif]);
    await rm(frames, { recursive: true, force: true });
    process.stdout.write(`${resolve(mp4)}\n${resolve(gif)}\n`);
  });
}

const outDir = join(here, label);
await mkdir(outDir, { recursive: true });
const { webSocketUrl, process: chromeProcess, profileDir } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
const failures = [];
try {
  await client.connect();
  for (const [name, view] of Object.entries(VIEWS)) {
    if (only && !only.has(name)) continue;
    for (const mode of ["dark", "light"]) {
      process.stdout.write(`${name} (${mode})… `);
      try {
        await size(client, 1440, 900, 2);
        await scheme(client, mode);
        await runCapture(client, async (c) => {
          await view.setup(c);
          await scheme(c, mode);
          await sleep(300);
        }, async () => {
          const file = join(outDir, `${name}-${mode}.png`);
          await client.capture(file, await view.clip(client));
          process.stdout.write(`${resolve(file)}\n`);
        });
      } catch (error) {
        failures.push(`${name} (${mode}): ${error.message}`);
        process.stdout.write(`failed: ${error.message}\n`);
      }
    }
  }
  if (label === "after" && (!only || only.has("clip"))) {
    try { await recordReadClears(client, outDir); } catch (error) { failures.push(`clip: ${error.message}`); }
  }
} finally {
  client.socket?.close();
  if (chromeProcess) {
    const exited = new Promise((done) => chromeProcess.once("exit", done));
    chromeProcess.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
