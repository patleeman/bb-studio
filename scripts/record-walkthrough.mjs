#!/usr/bin/env node
/**
 * Record a vertical, phone-ready video walkthrough of BB Studio from a staged
 * BB. Each scene reuses a README capture's setup, so the video shows the same
 * seeded surfaces as the screenshots. Seeding and loading happen off camera;
 * only the finished surface is recorded. ffmpeg then sets each scene in a
 * 1080x1920 frame: a big headline on top and the live app in a card below.
 *
 *   node scripts/staged-bb.mjs start
 *   . "$TMPDIR/bb-studio-staged/capture.env"
 *   node scripts/record-walkthrough.mjs [--out docs/walkthrough.mp4]
 *
 * BB_WALKTHROUGH_ONLY takes comma-separated scene IDs to record a subset, and
 * BB_WALKTHROUGH_SKIP_FAILED=1 leaves out scenes whose setup fails.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, ensureChrome } from "./capture/driver.mjs";
import { projectId, threadId, pluginRpc, bbCli, launchSpace, getLaunchSpaceId, sleep } from "./capture/bb.mjs";
import { seedPages, seedDrawing, seedArtifact, seedTalkRecording, talkRpc } from "./capture/seed.mjs";
import { loadCaptures } from "./capture/entries.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outFlag = process.argv.indexOf("--out");
const outPath = resolve(repoRoot, outFlag >= 0 ? process.argv[outFlag + 1] : "docs/walkthrough.mp4");
const only = process.env.BB_WALKTHROUGH_ONLY ? new Set(process.env.BB_WALKTHROUGH_ONLY.split(",").map((id) => id.trim())) : null;

// The 1080x1920 frame: headline above, the app in a card below. The app
const FRAME_W = 1080;
const FRAME_H = 1920;
const CARD_W = 1000;
const CARD_Y = 560;
const CARD_H = FRAME_H - CARD_Y - 64;
const CARD_X = (FRAME_W - CARD_W) / 2;
// The app renders this many CSS pixels wide, sharp at 2x, and scales into the
// card; narrower means bigger type. Scenes whose layout needs room set more.
const VIEW_W = 720;
const viewHeight = (width) => Math.round((width * CARD_H) / CARD_W);
const FPS = 30;
const BG = "#0a0a0a";
const ACCENT = "#c8ff3d";

// [capture ID, headline (*accent*), line under it, seconds, CSS width]
const SCENES = [
  ["studio", "*Everything* in one place.", "Pages, recordings, drawings and tables.", 3.5, 1040],
  ["studio-search", "Search *all* of it.", "⌘⇧K looks inside every item.", 3.5],
  ["pages", "Pages you write *with* agents.", "Live stats, charts and checklists.", 4],
  ["talk", "Talk. It *transcribes*.", "Long recordings, saved as you speak.", 3.5],
  ["excalidraw", "*Sketch* it together.", "Excalidraw, shared with your agents.", 3],
  ["studio-tables", "Real *tables*.", "Typed columns, views, CSV and agent tools.", 3],
  ["artifacts", "Keep what they *make*.", "Reports, images and files, all saved.", 3],
  ["bots", "Bots that work as a *team*.", "A Command view, delegation and memory.", 4, 900],
  ["reactions-smart", "Answer in *one tap*.", "Replies come with suggested answers.", 3.5],
  ["float", "Keep it all *open*.", "Threads and items as floating tabs.", 3.5, 960],
  ["studio-chat", "Chat about *what you see*.", "The agent knows what's on screen.", 3.5],
];
const INTRO = ["Your agents make *a lot*.", "BB Studio keeps it all in one place.", 2.5];
const OUTRO = ["BB *Studio*", "Plugins for BB · github.com/patleeman/bb-studio", 3.5];

// Video-only setups where a README capture asserts more than the video needs.
const ownScenes = {
  pages: async (client) => {
    const { page, cleanup } = await seedPages();
    try {
      await client.navigate(`/plugins/pages/pages/${page.id}`);
      for (const text of ["Offline mode launch", "Crash-free sessions", "Launch checklist"]) await client.waitForText(text);
      await client.waitForSelector(".recharts-bar-rectangle");
      await sleep(800);
    } catch (error) {
      await cleanup();
      throw error;
    }
    return cleanup;
  },
  float: async (client) => {
    // Earlier scenes leave a filter on the collection that shows behind the panel.
    await client.navigate("/plugins/studio/studio");
    await client.evaluate(`Object.keys(localStorage).filter((key) => key.startsWith("studio:query")).forEach((key) => localStorage.removeItem(key))`);
    return captures.find((capture) => capture.id === "float").setup(client);
  },
};

const context = { projectId, threadId, pluginRpc, bbCli, launchSpace, getLaunchSpaceId, sleep, seedPages, seedDrawing, seedArtifact, seedTalkRecording, talkRpc };
const captures = loadCaptures(context);

/** Scrolls the page's tallest scroller down a little and back, so long surfaces move. */
const drift = (progress) => `(() => {
  const scrollers = [...document.querySelectorAll("main *, [role=main] *")].filter((el) => {
    const style = getComputedStyle(el);
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight - el.clientHeight > 120 && el.clientHeight > 300;
  });
  const el = scrollers.sort((a, b) => b.clientHeight - a.clientHeight)[0];
  if (!el) return;
  const room = Math.min(el.scrollHeight - el.clientHeight, 360);
  el.scrollTop = Math.round(room * Math.sin(Math.PI * ${progress}) ** 2);
})()`;

const workDir = await mkdtemp(join(tmpdir(), "bb-walkthrough-"));
const { webSocketUrl, process: chromeProcess, profileDir } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
await client.connect();
const setView = (width) => client.command("Emulation.setDeviceMetricsOverride", { width, height: viewHeight(width), deviceScaleFactor: 2, mobile: false });
await setView(VIEW_W);

// Screencast frames arrive only when the page paints. Keep the ones shown
// while a scene is on camera, timed by when they arrived.
const frames = [];
const writes = [];
let recording = false;
client.socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method !== "Page.screencastFrame") return;
  const { data, sessionId } = message.params;
  client.socket.send(JSON.stringify({ id: ++client.nextId, method: "Page.screencastFrameAck", params: { sessionId } }));
  if (!recording) return;
  const file = join(workDir, `frame-${String(frames.length).padStart(6, "0")}.jpg`);
  frames.push({ file, at: Date.now() });
  writes.push(writeFile(file, Buffer.from(data, "base64")));
});
await client.command("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 4000, maxHeight: 4000, everyNthFrame: 1 });

// BB remembers the sidebar across navigations, so set it rather than toggle it.
const setSidebar = async (open) => {
  const expanded = () => client.evaluate(`document.querySelector('button[aria-label^="Toggle sidebar"]')?.getAttribute("aria-expanded") ?? null`);
  if ((await expanded()) === null) {
    await client.navigate("/");
    await client.waitForSelector('button[aria-label^="Toggle sidebar"]');
  }
  if ((await expanded()) !== String(open)) {
    await client.evaluate(`document.querySelector('button[aria-label^="Toggle sidebar"]').click()`);
    await sleep(400);
  }
};

// Each shot is a run of frames ending at a known time, so stills hold.
const shots = [];
async function shoot(scene, seconds) {
  const start = frames.length;
  // A screencast sends frames only on paint, so keep one hidden pixel changing.
  const tick = `(() => {
    let dot = document.getElementById("walkthrough-tick");
    if (!dot) {
      dot = Object.assign(document.createElement("div"), { id: "walkthrough-tick" });
      dot.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;pointer-events:none;z-index:2147483647";
      document.body.appendChild(dot);
    }
    dot.style.opacity = dot.style.opacity === "0.01" ? "0.02" : "0.01";
    dot.style.background = "#000";
  })()`;
  recording = true;
  const began = Date.now();
  while (Date.now() - began < seconds * 1000) {
    await client.evaluate(drift((Date.now() - began) / (seconds * 1000))).catch(() => {});
    await client.evaluate(tick).catch(() => {});
    await sleep(50);
  }
  recording = false;
  await client.evaluate(`document.getElementById("walkthrough-tick")?.remove()`).catch(() => {});
  if (frames.length === start) throw new Error(`No frames for ${scene[0]}`);
  shots.push({ scene, start, end: frames.length, until: Date.now() });
}

const scenes = SCENES.filter(([id]) => !only || only.has(id));
// The collection's filter rail lists Spaces once one exists.
const { space } = await pluginRpc("studio", "createSpace", { name: "Q4 planning", icon: "🗂️", description: "Plans for the quarter.", defaultProjectId: projectId });
try {
  for (const scene of scenes) {
    const [id] = scene;
    const capture = ownScenes[id] ? { setup: ownScenes[id] } : captures.find((candidate) => candidate.id === id);
    if (!capture) throw new Error(`No capture named ${id}`);
    process.stdout.write(`Recording ${id}...\n`);
    // The card is too narrow for the sidebar, so the surface gets the room.
    // Float's setup floats a thread from its sidebar row, so it collapses after.
    const sidebarDuringSetup = id === "float";
    await setView(scene[4] ?? VIEW_W);
    await setSidebar(sidebarDuringSetup);
    let cleanup;
    try {
      cleanup = await capture.setup(client);
    } catch (error) {
      if (!process.env.BB_WALKTHROUGH_SKIP_FAILED) throw error;
      process.stdout.write(`  SKIPPED ${id}: ${error.message.split("\n")[0]}\n`);
      continue;
    }
    try {
      await client.evaluate(`document.activeElement?.blur?.()`).catch(() => {});
      await setSidebar(false);
      await shoot(scene, scene[3]);
    } finally {
      if (cleanup) await cleanup();
    }
  }
  await client.command("Page.stopScreencast");
  await Promise.all(writes);
  await setSidebar(true);

  // Draw the type and the card's corners in the same Chrome, as transparent PNGs.
  await client.navigate("/");
  await client.command("Emulation.setDeviceMetricsOverride", { width: FRAME_W, height: FRAME_H, deviceScaleFactor: 1, mobile: false });
  await client.command("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const draw = async (name, html, clip) => {
    await client.evaluate(`(() => {
      document.head.innerHTML = ${JSON.stringify(`<style>
        html, body { margin: 0; background: transparent !important; }
        body > * { display: none !important; }
        body > #wt { display: block !important; position: fixed; inset: 0; font-family: -apple-system, "SF Pro Display", "Inter", sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
        .kicker { position: absolute; left: 64px; top: 80px; font-size: 30px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #8a8a8a; }
        .kicker b { color: ${ACCENT}; }
        .head { position: absolute; left: 64px; right: 64px; top: 140px; font-size: 112px; line-height: 1.0; font-weight: 800; letter-spacing: -0.035em; }
        .head em { font-style: normal; color: ${ACCENT}; }
        .sub { position: absolute; left: 64px; right: 64px; font-size: 42px; line-height: 1.25; font-weight: 500; color: #b5b5b5; letter-spacing: -0.01em; }
        .card { position: absolute; left: 0; top: 0; width: ${CARD_W}px; height: ${CARD_H}px; box-sizing: border-box; border-radius: 36px; }
        .center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; padding: 0 64px; gap: 36px; }
        .center .big { font-size: 150px; line-height: .98; font-weight: 800; letter-spacing: -0.04em; }
        .center .big em { font-style: normal; color: ${ACCENT}; }
        .center .small { font-size: 44px; font-weight: 500; color: #b5b5b5; line-height: 1.3; }
      </style>`)};
      document.getElementById("wt")?.remove();
      const root = document.createElement("div");
      root.id = "wt";
      root.innerHTML = ${JSON.stringify(html)};
      document.body.appendChild(root);
    })()`);
    await sleep(150);
    const file = join(workDir, `${name}.png`);
    await client.capture(file, clip);
    return file;
  };
  const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const accent = (text) => escape(text).replace(/\*(.+?)\*/g, "<em>$1</em>");
  const full = { x: 0, y: 0, width: FRAME_W, height: FRAME_H };
  const cardClip = { x: 0, y: 0, width: CARD_W, height: CARD_H };
  // The sub line sits under the headline, so measure where the headline ends.
  const headBottom = async (headline) => {
    await draw("measure", `<div class="head">${accent(headline)}</div>`, full);
    return client.evaluate(`Math.ceil(document.querySelector("#wt .head").getBoundingClientRect().bottom)`);
  };
  const mask = await draw("mask", `<div class="card" style="background:#fff"></div>`, cardClip);
  const border = await draw("border", `<div class="card" style="border:2px solid rgba(255,255,255,.16)"></div>`, cardClip);
  const shotLayers = [];
  for (const [index, shot] of shots.entries()) {
    const [, headline, sub] = shot.scene;
    const bottom = await headBottom(headline);
    shotLayers.push({
      head: await draw(`head-${index}`, `<div class="kicker"><b>BB Studio</b> · ${index + 1}/${shots.length}</div><div class="head">${accent(headline)}</div>`, full),
      sub: await draw(`sub-${index}`, `<div class="sub" style="top:${bottom + 24}px">${escape(sub)}</div>`, full),
    });
  }
  const cards = [];
  for (const [name, [big, small]] of [["intro", INTRO], ["outro", OUTRO]]) {
    cards.push(await draw(`${name}-big`, `<div class="center"><div class="big">${accent(big)}</div><div class="small" style="visibility:hidden">${escape(small)}</div></div>`, full));
    cards.push(await draw(`${name}-small`, `<div class="center"><div class="big" style="visibility:hidden">${accent(big)}</div><div class="small">${escape(small)}</div></div>`, full));
  }

  // Compose each segment, then join them without re-encoding.
  const ffmpeg = (args) => new Promise((resolvePromise, reject) => {
    const child = spawn("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
    child.on("close", (code) => (code === 0 ? resolvePromise() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
  const encode = ["-r", String(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p"];
  // Text rises 50px into place and fades in; `delay` staggers the line under the headline.
  const rise = (delay) => `y='50*pow(max(0,1-(t-${delay})/0.4),3)':enable='gte(t,${delay})'`;
  const fadeIn = (delay) => `fade=in:st=${delay}:d=0.3:alpha=1`;
  const segments = [];
  const textCard = async (name, big, small, seconds) => {
    const out = join(workDir, `${name}.mp4`);
    await ffmpeg([
      "-f", "lavfi", "-i", `color=c=${BG}:s=${FRAME_W}x${FRAME_H}:r=${FPS}:d=${seconds}`,
      "-loop", "1", "-t", String(seconds), "-i", big,
      "-loop", "1", "-t", String(seconds), "-i", small,
      "-filter_complex", `[1]format=rgba,${fadeIn(0)}[b];[2]format=rgba,${fadeIn(0.35)}[s];[0][b]overlay=x=0:${rise(0)}[v];[v][s]overlay=x=0:${rise(0.35)},format=yuv420p`,
      "-t", String(seconds), ...encode, out,
    ]);
    segments.push(out);
  };
  await textCard("intro", cards[0], cards[1], INTRO[2]);
  for (const [index, shot] of shots.entries()) {
    const lines = ["ffconcat version 1.0"];
    for (let i = shot.start; i < shot.end; i++) {
      const next = i + 1 < shot.end ? frames[i + 1].at : shot.until;
      lines.push(`file '${frames[i].file}'`, `duration ${Math.max(next - frames[i].at, 1) / 1000}`);
    }
    lines.push(`file '${frames[shot.end - 1].file}'`);
    const list = join(workDir, `shot-${index}.txt`);
    await writeFile(list, lines.join("\n"));
    const seconds = shot.scene[3];
    const out = join(workDir, `shot-${index}.mp4`);
    // The card slides up 60px as it fades in; the headline lands first.
    const cardY = `y='${CARD_Y}+60*pow(max(0,1-t/0.45),3)'`;
    await ffmpeg([
      "-f", "lavfi", "-i", `color=c=${BG}:s=${FRAME_W}x${FRAME_H}:r=${FPS}:d=${seconds}`,
      "-f", "concat", "-safe", "0", "-i", list,
      "-loop", "1", "-t", String(seconds), "-i", mask,
      "-loop", "1", "-t", String(seconds), "-i", border,
      "-loop", "1", "-t", String(seconds), "-i", shotLayers[index].head,
      "-loop", "1", "-t", String(seconds), "-i", shotLayers[index].sub,
      "-filter_complex", [
        `[1]fps=${FPS},scale=${CARD_W}:${CARD_H}:flags=lanczos,format=rgba[app]`,
        `[2]format=gray,fps=${FPS}[m]`,
        `[app][m]alphamerge[rounded]`,
        `[rounded][3]overlay=0:0:shortest=1,fade=in:st=0:d=0.3:alpha=1[card]`,
        `[0][card]overlay=x=${CARD_X}:${cardY}:shortest=1[v1]`,
        `[4]format=rgba,${fadeIn(0)}[h]`,
        `[5]format=rgba,${fadeIn(0.2)}[s]`,
        `[v1][h]overlay=x=0:${rise(0)}[v2]`,
        `[v2][s]overlay=x=0:${rise(0.2)},format=yuv420p`,
      ].join(";"),
      "-t", String(seconds), ...encode, out,
    ]);
    segments.push(out);
  }
  await textCard("outro", cards[2], cards[3], OUTRO[2]);

  const joinList = join(workDir, "segments.txt");
  await writeFile(joinList, segments.map((file) => `file '${file}'`).join("\n"));
  await mkdir(dirname(outPath), { recursive: true });
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", joinList, "-c", "copy", "-movflags", "+faststart", outPath]);
  process.stdout.write(`Wrote ${outPath}\n`);
} finally {
  await pluginRpc("studio", "deleteSpace", { id: space.id }).catch(() => {});
  await client.command("Page.stopScreencast").catch(() => {});
  client.socket?.close();
  if (chromeProcess) {
    const exited = new Promise((resolvePromise) => chromeProcess.once("exit", resolvePromise));
    chromeProcess.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
}
