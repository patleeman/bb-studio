#!/usr/bin/env node
/**
 * Before and after renders for Needs you (REDO.md), from a staged BB. It
 * reuses the Bot captures' fixtures (scripts/capture/captures/bb-studio-bot.mjs):
 * a Bot whose thread "Rotate the ORBIT-42 deploy key" asks a question, and the
 * Deploy watch runner with an urgent report. Each view is saved in dark and
 * light as docs/needs-you/<label>/<view>-<scheme>.png; the after run also
 * records Mark handled and Undo as dismiss-undo.mp4 and .gif.
 *
 *   BB_STAGED_DIR=$TMPDIR/bb-studio-staged-<you> BB_STAGED_PORT=<port> node scripts/staged-bb.mjs start --ref <commit>
 *   . "$BB_STAGED_DIR/capture.env"
 *   node docs/needs-you/render.mjs before [view,...]
 *
 * For after, install this branch's Studio into the same staged BB from a
 * local copy (`bb plugin install <copy>/packages/bb-studio --yes` with the
 * staged CLI), then run it with `after`.
 */
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCapture } from "../../scripts/capture/lifecycle.mjs";
import { CdpClient, ensureChrome } from "../../scripts/capture/driver.mjs";
import { projectId, pluginRpc, bbCli, sleep } from "../../scripts/capture/bb.mjs";
import { BOT_PATH, SIDEBAR, botFixtures, dismissProblems } from "../../scripts/capture/captures/bb-studio-bot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
if (label !== "before" && label !== "after") throw new Error("Usage: node docs/needs-you/render.mjs <before|after> [view,...]");
const only = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
if (!projectId) throw new Error("Source the staged BB's capture.env first.");

const fixtures = botFixtures({ projectId, pluginRpc, bbCli, sleep });
const NEEDS = `${SIDEBAR} section[aria-label="Needs you"]`;

const size = (client, width, height, scale = 1) => client.command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
const mouse = (client, type, point, extra = {}) => client.command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, buttons: 0, ...extra });
const center = (client, selector) => client.evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) throw new Error("Nothing at " + ${JSON.stringify(selector)});
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
const click = async (client, selector) => {
  const point = await center(client, selector);
  await mouse(client, "mouseMoved", point);
  await mouse(client, "mousePressed", point, { button: "left", buttons: 1, clickCount: 1 });
  await mouse(client, "mouseReleased", point, { button: "left", clickCount: 1 });
};
/** The first Needs you row, by the thread it opens. */
const firstRow = (client) => client.evaluate(`document.querySelector('${NEEDS} [data-thread]')?.getAttribute("data-thread")`);

/** The Bots list with Needs you: the question thread and Deploy watch's urgent report. */
const needsView = async (client) => {
  await fixtures.seededRunners();
  for (let i = 0; i < 40 && (await pluginRpc("studio", "bot_activity", {})).needsYou.length < 2; i++) await sleep(3000);
  await client.navigate(BOT_PATH);
  await client.waitForSelector(NEEDS, 60000);
  await dismissProblems(client);
  await sleep(1000);
};
const sidebarClip = (client) => client.evaluate(`(() => { const r = document.querySelector('${SIDEBAR}').getBoundingClientRect(); return { x: r.x, y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 420) }; })()`);

/** Hover on the first Needs you row, then on its ✕, so its tooltip shows. */
const hoverView = async (client) => {
  await needsView(client);
  const id = await firstRow(client);
  await mouse(client, "mouseMoved", await center(client, `${NEEDS} [data-thread="${id}"]`));
  await sleep(300);
  await mouse(client, "mouseMoved", await center(client, `${NEEDS} [data-thread="${id}"] [data-testid=needs-you-handled]`));
  await sleep(900);
};
const hoverClip = async (client) => {
  const r = await client.evaluate(`(() => { const r = document.querySelector('${NEEDS}').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 160, height: r.height + 24 };
};

/** Right-click on the first Needs you row. */
const menuView = async (client) => {
  await needsView(client);
  const id = await firstRow(client);
  const point = await center(client, `${NEEDS} [data-thread="${id}"] button`);
  await mouse(client, "mousePressed", point, { button: "right", clickCount: 1 });
  await mouse(client, "mouseReleased", { x: point.x + 400, y: point.y }, { button: "right", clickCount: 1 });
  await client.waitForSelector('[role="menu"]', 10000);
  await sleep(500);
};
const menuClip = async (client) => {
  const r = await client.evaluate(`(() => { const s = document.querySelector('${NEEDS}').getBoundingClientRect(); const m = document.querySelector('[role="menu"]').getBoundingClientRect(); const x = Math.min(s.x, m.x), y = Math.min(s.y, m.y); return { x, y, width: Math.max(s.right, m.right) - x, height: Math.max(s.bottom, m.bottom) - y }; })()`);
  return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 };
};

/** Bot info beside the Bot's chat, scrolled to its Activity. */
const infoView = async (client) => {
  await needsView(client);
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
  sidebar: { setup: needsView, clip: sidebarClip },
  info: { setup: infoView, clip: infoClip },
  hover: { setup: hoverView, clip: hoverClip, after: true },
  menu: { setup: menuView, clip: menuClip, after: true },
};

/** Mark handled on the first row, the toast, Undo, and the row back, as an MP4 and a GIF (dark, 1x, the whole window). */
async function recordDismissUndo(client, outDir) {
  await size(client, 1280, 800, 1);
  await scheme(client, "dark");
  await runCapture(client, needsView, async () => {
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
    const id = await firstRow(client);
    await sleep(800);
    await mouse(client, "mouseMoved", await center(client, `${NEEDS} [data-thread="${id}"]`));
    await sleep(700);
    await click(client, `${NEEDS} [data-thread="${id}"] [data-testid=needs-you-handled]`);
    await client.waitForText("Undo", 10000);
    await sleep(1500);
    await client.clickElementWithTextAndPointer("button", "Undo");
    await client.waitForSelector(`${NEEDS} [data-thread="${id}"]`, 15000);
    await sleep(1800);
    recording = false;
    await loop;
    const list = shots.map((shot, i) => `file '${shot.frame}'\nduration ${(((shots[i + 1]?.at ?? shot.at + 80) - shot.at) / 1000).toFixed(3)}`).join("\n");
    await writeFile(join(frames, "list.txt"), `ffconcat version 1.0\n${list}\nfile '${shots.at(-1).frame}'\n`);
    const mp4 = join(outDir, "dismiss-undo.mp4");
    const gif = join(outDir, "dismiss-undo.gif");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(frames, "list.txt"), "-vf", "fps=20,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", mp4]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(frames, "list.txt"), "-vf", "fps=12,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none", gif]);
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
    if ((only && !only.has(name)) || (view.after && label !== "after")) continue;
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
    try { await recordDismissUndo(client, outDir); } catch (error) { failures.push(`clip: ${error.message}`); }
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
