#!/usr/bin/env node
/**
 * Record a narrated-by-captions video walkthrough of BB Studio from a staged
 * BB. Each scene reuses a README capture's setup, so the video shows the same
 * seeded, asserted surfaces as the screenshots. Seeding and loading happen off
 * camera; only the finished surface is recorded, with a caption and a slow
 * scroll, then the scenes are joined into one MP4.
 *
 *   node scripts/staged-bb.mjs start
 *   . "$TMPDIR/bb-studio-staged/capture.env"
 *   node scripts/record-walkthrough.mjs [--out docs/walkthrough.mp4]
 *
 * BB_WALKTHROUGH_ONLY takes comma-separated scene IDs to record a subset.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CdpClient, ensureChrome } from "./capture/driver.mjs";
import { projectId, threadId, pluginRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep } from "./capture/bb.mjs";
import { seedPages, seedDrawing, seedArtifact, seedTalkRecording, talkRpc } from "./capture/seed.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outFlag = process.argv.indexOf("--out");
const outPath = resolve(repoRoot, outFlag >= 0 ? process.argv[outFlag + 1] : "docs/walkthrough.mp4");
const only = process.env.BB_WALKTHROUGH_ONLY ? new Set(process.env.BB_WALKTHROUGH_ONLY.split(",").map((id) => id.trim())) : null;
const WIDTH = 1600;
const HEIGHT = 900;

// [capture ID, title, caption, seconds on screen]
const SCENES = [
  ["studio-needs-you", "Studio Home", "What needs you today: reviews, due tasks and what your agents changed.", 5],
  ["studio", "One collection", "Pages, recordings, drawings, artifacts, tasks and tables in one place, filtered by kind, space and project.", 6],
  ["studio-search", "Search everything", "⌘⇧K searches the content of every item, with highlighted matches.", 5],
  ["studio-space", "Spaces", "Group projects, items and channels around one piece of work.", 5],
  ["pages", "Studio Pages", "Live pages you write with your agents: stats, charts, checklists and comments.", 7],
  ["talk", "Studio Talk", "Long-form recording that saves audio as you speak and transcribes it.", 6],
  ["excalidraw", "Studio Draw", "Excalidraw drawings you sketch together with your agents.", 5],
  ["studio-tasks", "Studio Tasks", "Boards of tasks you hand to agents. Each task follows its thread from working to review.", 6],
  ["studio-tables", "Studio Tables", "Typed tables with views, CSV import and export, and agent tools.", 5],
  ["artifacts", "Studio Artifacts", "Keeps the reports, images and files your agents make.", 5],
  ["feed", "Studio Feed", "One feed of what your agents report, from any thread, channel or automation.", 7],
  ["bots", "Studio Teams", "Persistent bots that work together in channels, delegate and keep their own memory.", 7],
  ["bots-profile", "Bot profiles", "Each bot has its own mission, model, workspace and memory.", 5],
  ["reactions-smart", "Studio Reactions", "Replies end with suggested quick answers. One click drafts your reply.", 6],
  ["explore", "Studio Explore", "Agents point out what they noticed along the way. Click one for a page explaining it.", 6],
  ["float", "Float", "Keep threads, channels and Studio items open in a panel of tabs while you work.", 6],
  ["studio-chat", "Studio Chat", "Open a thread next to any item, and the agent knows what you're looking at.", 6],
];

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
  "studio-tasks": async (client) => {
    const { board } = await pluginRpc("studio-tasks", "boardCreate", { title: "Fall launch", projectId });
    const cleanup = () => pluginRpc("studio-tasks", "boardDelete", { id: board.id }).catch(() => {});
    try {
      const tasks = [
        { title: "Write the launch post", status: "todo", assignee: "me", due: "2026-10-06", priority: "high", labels: ["launch"] },
        { title: "Update the pricing page copy", status: "todo", assignee: "agent" },
        { title: "Fix the flaky checkout test", status: "in_progress", assignee: "agent" },
        { title: "Add offline sync to settings", status: "review", assignee: "agent" },
        { title: "Draft the Q3 usage report", status: "done", assignee: "me" },
      ];
      for (const task of tasks) await pluginRpc("studio-tasks", "create", { ...task, projectId, boardId: board.id });
      await client.navigate(`/plugins/studio-tasks/tasks/${board.id}`);
      for (const text of ["To do", "In progress", "Review", "Done", ...tasks.map((task) => task.title)]) await client.waitForText(text);
      await sleep(800);
    } catch (error) {
      await cleanup();
      throw error;
    }
    return cleanup;
  },
  feed: async (client) => {
    // Seeded agent threads may already have posted; the capture counts unread posts.
    for (const line of (await bbCli(["feed", "list", "--all"])).split("\n").filter(Boolean)) {
      await pluginRpc("feed", "read", { postId: line.split("\t")[0], read: true });
    }
    return captures.find((capture) => capture.id === "feed").setup(client);
  },
};

const captures = [];
const context = { projectId, threadId, pluginRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep, seedPages, seedDrawing, seedArtifact, seedTalkRecording, talkRpc };
const capturesDir = join(repoRoot, "scripts/capture/captures");
for (const file of (await readdir(capturesDir)).filter((name) => name.endsWith(".mjs")).sort()) {
  captures.push(...(await import(pathToFileURL(join(capturesDir, file)).href)).default(context));
}

/** A caption card bottom-left and a fade from black, drawn over the live page. */
const overlay = ({ title, caption, step, total, card }) => `(() => {
  document.getElementById("walkthrough-overlay")?.remove();
  const root = document.createElement("div");
  root.id = "walkthrough-overlay";
  root.innerHTML = ${JSON.stringify(`
    <style>
      #walkthrough-overlay { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif; }
      #walkthrough-overlay .fade { position: absolute; inset: 0; background: #0b0b0f; animation: wt-fade 700ms ease-out forwards; }
      #walkthrough-overlay .card { position: absolute; left: 40px; bottom: 40px; max-width: 620px; padding: 18px 22px; border-radius: 16px;
        background: rgba(17, 17, 22, 0.86); color: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.35); backdrop-filter: blur(12px);
        opacity: 0; transform: translateY(14px); animation: wt-in 600ms 350ms cubic-bezier(.2,.8,.2,1) forwards; }
      #walkthrough-overlay .step { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #a5a5b4; margin-bottom: 6px; }
      #walkthrough-overlay .title { font-size: 24px; font-weight: 650; margin-bottom: 6px; }
      #walkthrough-overlay .caption { font-size: 17px; line-height: 1.45; color: #e4e4ec; }
      #walkthrough-overlay .full { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; gap: 14px;
        background: radial-gradient(circle at 50% 40%, #23233a, #0b0b0f 70%); color: #fff; }
      #walkthrough-overlay .full .title { font-size: 64px; font-weight: 700; letter-spacing: -0.02em; opacity: 0; animation: wt-in 800ms 200ms ease-out forwards; }
      #walkthrough-overlay .full .caption { font-size: 22px; color: #b9b9c8; opacity: 0; animation: wt-in 800ms 600ms ease-out forwards; }
      @keyframes wt-fade { to { opacity: 0; } }
      @keyframes wt-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    </style>`)};
  const title = ${JSON.stringify(title)}, caption = ${JSON.stringify(caption)};
  if (${JSON.stringify(Boolean(card))}) {
    root.insertAdjacentHTML("beforeend", '<div class="full"><div class="title"></div><div class="caption"></div></div>');
    root.querySelector(".full .title").textContent = title;
    root.querySelector(".full .caption").textContent = caption;
  } else {
    root.insertAdjacentHTML("beforeend", '<div class="fade"></div><div class="card"><div class="step"></div><div class="title"></div><div class="caption"></div></div>');
    root.querySelector(".step").textContent = ${JSON.stringify(`${step} / ${total}`)};
    root.querySelector(".card .title").textContent = title;
    root.querySelector(".card .caption").textContent = caption;
  }
  document.body.appendChild(root);
})()`;

/** Scrolls the page's tallest scroller down a little and back, so long surfaces move. */
const drift = (progress) => `(() => {
  const scrollers = [...document.querySelectorAll("main *, [role=main] *")].filter((el) => {
    const style = getComputedStyle(el);
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight - el.clientHeight > 120 && el.clientHeight > 300;
  });
  const el = scrollers.sort((a, b) => b.clientHeight - a.clientHeight)[0];
  if (!el) return;
  const room = Math.min(el.scrollHeight - el.clientHeight, 420);
  el.scrollTop = Math.round(room * Math.sin(Math.PI * ${progress}) ** 2);
})()`;

const { webSocketUrl, process: chromeProcess, profileDir } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
await client.connect();
await client.command("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false });

// Screencast frames arrive only when the page paints. Keep the ones shown
// while a scene is on camera, timed by when they arrived.
const framesDir = await mkdtemp(join(tmpdir(), "bb-walkthrough-"));
const frames = [];
const writes = [];
let recording = false;
client.socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method !== "Page.screencastFrame") return;
  const { data, sessionId } = message.params;
  client.socket.send(JSON.stringify({ id: ++client.nextId, method: "Page.screencastFrameAck", params: { sessionId } }));
  if (!recording) return;
  const file = join(framesDir, `${String(frames.length).padStart(6, "0")}.jpg`);
  frames.push({ file, at: Date.now() });
  writes.push(writeFile(file, Buffer.from(data, "base64")));
});
await client.command("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: WIDTH * 2, maxHeight: HEIGHT * 2, everyNthFrame: 1 });

// Each shot is a run of frames ending at a known time, so stills hold.
const shots = [];
async function shoot(seconds, during) {
  const start = frames.length;
  recording = true;
  const began = Date.now();
  while (Date.now() - began < seconds * 1000) {
    if (during) await client.evaluate(during((Date.now() - began) / (seconds * 1000))).catch(() => {});
    await sleep(50);
  }
  recording = false;
  shots.push({ start, end: frames.length, until: Date.now() });
}

const card = async (title, caption, seconds) => {
  await client.evaluate(overlay({ title, caption, card: true }));
  await shoot(seconds);
};

const scenes = SCENES.filter(([id]) => !only || only.has(id));
// The collection's filter rail lists Spaces once one exists.
const { space } = await pluginRpc("studio", "createSpace", { name: "Q4 planning", icon: "🗂️", description: "Plans for the quarter.", defaultProjectId: projectId });
try {
  await client.navigate("/plugins/studio/studio");
  await card("BB Studio", "Write, talk, draw, track and run bot teams with your agents.", 4);
  for (const [index, [id, title, caption, seconds]] of scenes.entries()) {
    const capture = ownScenes[id] ? { setup: ownScenes[id] } : captures.find((candidate) => candidate.id === id);
    if (!capture) throw new Error(`No capture named ${id}`);
    process.stdout.write(`Recording ${id}...\n`);
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
      await client.evaluate(overlay({ title, caption, step: index + 1, total: scenes.length }));
      await shoot(seconds, drift);
    } finally {
      if (cleanup) await cleanup();
    }
  }
  await card("BB Studio", "github.com/patleeman/bb-studio", 4);
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
}

await Promise.all(writes);
// An ffmpeg concat list: each frame holds until the next, the last until its shot ends.
const lines = ["ffconcat version 1.0"];
for (const shot of shots) {
  for (let i = shot.start; i < shot.end; i++) {
    const next = i + 1 < shot.end ? frames[i + 1].at : shot.until;
    lines.push(`file '${frames[i].file}'`, `duration ${Math.max(next - frames[i].at, 1) / 1000}`);
  }
}
const last = shots.at(-1);
if (last) lines.push(`file '${frames[last.end - 1].file}'`);
const listFile = join(framesDir, "frames.txt");
await writeFile(listFile, lines.join("\n"));
await mkdir(dirname(outPath), { recursive: true });
await new Promise((resolvePromise, reject) => {
  const ffmpeg = spawn("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile,
    "-vf", "scale=1920:1080:flags=lanczos,fps=30,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-movflags", "+faststart", outPath,
  ], { stdio: "inherit" });
  ffmpeg.on("close", (code) => (code === 0 ? resolvePromise() : reject(new Error(`ffmpeg exited with ${code}`))));
});
await rm(framesDir, { recursive: true, force: true });
process.stdout.write(`Wrote ${outPath}\n`);
