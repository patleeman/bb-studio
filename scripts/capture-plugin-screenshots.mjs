#!/usr/bin/env node

/**
 * Capture the plugin README screenshots from a running BB application.
 *
 * This intentionally uses Chrome's DevTools Protocol against the real BB web
 * client. It is not a mockup generator: each capture is gated on live text
 * from the rendered panel so an empty, broken, or missing surface fails.
 *
 * Usage:
 *   BB_CAPTURE_CDP_PORT=9222 \
 *   BB_CAPTURE_PROJECT_ID=proj_... \
 *   BB_CAPTURE_THREAD_ID=thr_... \
 *   node scripts/capture-plugin-screenshots.mjs
 *
 * If no DevTools endpoint is already available, the script starts a temporary
 * headless Chrome profile. BB itself must already be running at BB_SERVER_URL
 * (the CLI exports this automatically inside a BB environment).
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverUrl = (process.env.BB_SERVER_URL ?? "http://127.0.0.1:38886").replace(/\/$/, "");
const cdpPort = Number(process.env.BB_CAPTURE_CDP_PORT ?? "9222");
const projectId = process.env.BB_CAPTURE_PROJECT_ID ?? process.env.BB_PROJECT_ID;
const threadId = process.env.BB_CAPTURE_THREAD_ID;
const captureOnly = process.env.BB_CAPTURE_ONLY
  ? new Set(process.env.BB_CAPTURE_ONLY.split(",").map((value) => value.trim()).filter(Boolean))
  : null;

if (!projectId || !threadId) {
  throw new Error(
    "Set BB_CAPTURE_PROJECT_ID and BB_CAPTURE_THREAD_ID to a seeded BB thread before capturing.\n" +
      "The thread is used for the message-action and context-menu screenshots.",
  );
}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.webSocketUrl);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener("open", resolvePromise, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  command(method, params = {}, timeoutMs = 60000) {
    const id = ++this.nextId;
    return new Promise((resolvePromise, reject) => {
      // A wedged page never answers; fail the capture instead of hanging it.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const settle = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      this.pending.set(id, { resolve: settle(resolvePromise), reject: settle(reject) });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = false) {
    const result = await this.command("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "Runtime evaluation failed",
      );
    }
    if (result.result?.subtype === "error") {
      throw new Error(result.result.description ?? "Runtime evaluation failed");
    }
    return result.result?.value;
  }

  async openChannelTab(name) {
    await this.evaluate(`document.querySelector('button[aria-label^="Show right panel"]')?.click()`);
    await this.waitForAriaButton(name);
    await this.evaluate(`(() => {
      const tab = [...document.querySelectorAll('[aria-label="Right panel views"] button')]
        .find(button => button.getAttribute('aria-label') === ${JSON.stringify(name)});
      if (!tab) throw new Error('Missing native channel tab');
      tab.click();
    })()`);
  }

  async navigate(path) {
    await this.command("Page.navigate", { url: `${serverUrl}${path}` });
    await sleep(900);
  }

  async waitForText(text, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const bodyText = await this.evaluate("document.body?.innerText ?? \"\"");
      if (bodyText.includes(text)) return;
      await sleep(250);
    }
    const bodyText = await this.evaluate("document.body?.innerText ?? \"\"");
    throw new Error(`Timed out waiting for ${JSON.stringify(text)}.\n${bodyText.slice(-1200)}`);
  }

  async waitForSelector(selector, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
      await sleep(250);
    }
    throw new Error(`Timed out waiting for selector ${JSON.stringify(selector)}`);
  }

  async waitForInputValue(label, expected, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await this.evaluate(`(() => {
        const field = Array.from(document.querySelectorAll("input, textarea"))
          .find((candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(label)});
        return field?.value ?? null;
      })()`);
      if (value === expected) return;
      await sleep(250);
    }
    const value = await this.evaluate(`(() => {
      const field = Array.from(document.querySelectorAll("input, textarea"))
        .find((candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(label)});
      return field?.value ?? null;
    })()`);
    throw new Error(`Timed out waiting for ${JSON.stringify(label)} to equal ${JSON.stringify(expected)}; actual value was ${JSON.stringify(value)}`);
  }

  async waitForAriaButton(label, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const present = await this.evaluate(`Array.from(document.querySelectorAll("button"))
        .some((candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(label)})`);
      if (present) return;
      await sleep(250);
    }
    throw new Error(`Timed out waiting for button ${JSON.stringify(label)}`);
  }

  async hasText(text, timeoutMs = 2500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const bodyText = await this.evaluate("document.body?.innerText ?? \"\"");
      if (bodyText.includes(text)) return true;
      await sleep(250);
    }
    return false;
  }

  async clickButtonText(label) {
    const clicked = await this.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((candidate) => candidate.innerText.trim() === ${JSON.stringify(label)});
      if (!button) throw new Error("Button not found: ${label}");
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Unable to click ${label}`);
    await sleep(900);
  }

  async drawRectangle() {
    await this.evaluate(`(() => {
      const tool = Array.from(document.querySelectorAll("[aria-label]"))
        .find((candidate) => candidate.getAttribute("aria-label") === "Rectangle");
      if (!tool) throw new Error("Excalidraw Rectangle tool not found");
      tool.click();
      return true;
    })()`);
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 560,
      y: 300,
      buttons: 0,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: 560,
      y: 300,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 960,
      y: 550,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: 960,
      y: 550,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await sleep(1200);
  }

  async clickSidebarButton(label) {
    const clicked = await this.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((candidate) => candidate.innerText.trim() === ${JSON.stringify(label)});
      if (!button) throw new Error("Sidebar button not found: ${label}");
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Unable to click sidebar button ${label}`);
    await sleep(900);
  }

  async clickFirstButtonWithAria(label) {
    const clicked = await this.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(label)});
      if (!button) throw new Error("Button not found: ${label}");
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Unable to click ${label}`);
    await sleep(900);
  }

  async clickAriaButtonWithPointer(label) {
    const point = await this.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(label)});
      if (!button) throw new Error("Button not found: ${label}");
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await sleep(300);
  }

  async clickElementWithTextAndPointer(selector, text) {
    const point = await this.evaluate(`(() => {
      const element = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
        .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(text)});
      if (!element) throw new Error("Element not found: ${text}");
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await sleep(300);
  }

  async openThreadContextMenu() {
    const point = await this.evaluate(`(() => {
      const anchor = Array.from(document.querySelectorAll(
        '[data-sidebar-thread-id], [data-thread-id], [data-session-id], a[href*="/threads/"]',
      )).find((candidate) =>
        candidate.getAttribute("data-sidebar-thread-id") === ${JSON.stringify(threadId)} ||
        candidate.getAttribute("data-thread-id") === ${JSON.stringify(threadId)} ||
        candidate.getAttribute("data-session-id") === ${JSON.stringify(threadId)} ||
        candidate.getAttribute("href")?.includes("/threads/" + ${JSON.stringify(threadId)}),
      );
      if (!anchor) throw new Error("Seed thread row not found in the sidebar");
      const rect = anchor.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await this.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "right",
      clickCount: 1,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "right",
      clickCount: 1,
    });
    await sleep(700);
  }

  async capture(outputPath, clip) {
    const screenshot = await this.command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
    });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
  }
}

async function seedPages() {
  const markdown = [
    "> [!TIP] Scribe refreshes this page every weekday morning from the release threads.",
    "",
    "```stats",
    JSON.stringify([
      { label: "Beta teams", value: 42, delta: "+9", trend: "up", caption: "since last week" },
      { label: "Crash-free sessions", value: "99.4%", delta: "+0.6", trend: "up" },
      { label: "Open blockers", value: 3, delta: "-2", trend: "down" },
    ]),
    "```",
    "",
    "```chart",
    JSON.stringify({
      type: "bar",
      title: "Weekly active teams",
      x: "week",
      series: ["web", "desktop"],
      stacked: true,
      data: [
        { week: "Sep 1", web: 18, desktop: 7 },
        { week: "Sep 8", web: 22, desktop: 9 },
        { week: "Sep 15", web: 27, desktop: 12 },
        { week: "Sep 22", web: 29, desktop: 13 },
      ],
    }),
    "```",
    "",
    "## Launch checklist",
    "",
    "- [x] Ship offline sync to beta teams",
    "- [x] Publish the migration guide",
    "- [ ] Localise onboarding for Japanese and German",
    "- [ ] Final go/no-go review",
  ].join("\n");
  const { page } = await pluginRpc("pages", "create", { projectId, parentId: null, title: "Offline mode launch", icon: "🚀", markdown });
  const { page: child } = await pluginRpc("pages", "create", { projectId, parentId: page.id, title: "Rollout risks", icon: "⚠️", markdown: "- Storage quota on older devices" });
  const { page: notes } = await pluginRpc("pages", "create", { projectId, parentId: null, title: "Release notes: October", icon: "📝", markdown: "## Highlights\n\n- Offline sync for every team" });
  const cleanup = async () => {
    for (const id of [child.id, page.id, notes.id]) await pluginRpc("pages", "remove", { id }).catch(() => {});
  };
  return { page, notes, cleanup };
}

/** A "Checkout flow" diagram: three labelled steps joined by arrows. */
async function seedDrawing() {
  let seed = 1;
  const base = (type, x, y, width, height, extra = {}) => ({
    id: `capture-${type}-${seed}`,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: seed++,
    version: 1,
    versionNonce: seed * 7,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...extra,
  });
  const steps = [
    ["Cart", "#a5d8ff"],
    ["Payment", "#ffec99"],
    ["Confirmation", "#b2f2bb"],
  ];
  const elements = [];
  steps.forEach(([label, fill], index) => {
    const x = index * 260;
    elements.push(base("rectangle", x, 0, 180, 90, { backgroundColor: fill, roundness: { type: 3 } }));
    elements.push(
      base("text", x + 20, 30, 140, 25, {
        text: label,
        originalText: label,
        fontSize: 20,
        fontFamily: 5,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: null,
        lineHeight: 1.25,
        autoResize: false,
      }),
    );
    if (index < steps.length - 1) {
      elements.push(base("arrow", x + 190, 45, 60, 0, { points: [[0, 0], [60, 0]], startArrowhead: null, endArrowhead: "arrow" }));
    }
  });
  elements.push(
    base("text", 0, 130, 420, 25, {
      text: "Retry payment on failure",
      originalText: "Retry payment on failure",
      fontSize: 16,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      lineHeight: 1.25,
      autoResize: true,
      strokeColor: "#868e96",
    }),
  );
  const { drawing } = await pluginRpc("excalidraw", "createDrawing", { name: "Checkout flow", projectId });
  await pluginRpc("excalidraw", "saveDrawing", {
    id: drawing.id,
    data: JSON.stringify({ type: "excalidraw", version: 2, source: "bb-capture", elements, appState: { viewBackgroundColor: "#ffffff" }, files: {} }),
  });
  return { drawing, cleanup: () => pluginRpc("excalidraw", "deleteDrawing", { id: drawing.id }).catch(() => {}) };
}

async function findPageTarget() {
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const target = targets.find((candidate) => candidate.type === "page" && !candidate.url.startsWith("chrome://"));
  if (!target?.webSocketDebuggerUrl) throw new Error("No controllable Chrome page target found");
  return target.webSocketDebuggerUrl;
}

async function pluginRpc(pluginId, method, input) {
  const response = await fetch(`${serverUrl}/api/v1/plugins/${pluginId}/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message ?? `Plugin RPC failed: ${pluginId}/${method}`);
  }
  return payload.result;
}

/** Run the bb CLI as the owner, not as the thread this script may run inside. */
// Studio Teams captures read the seeded "Launch room" channel: Atlas and Scribe
// with fixed replies from their demo missions (see the Studio Teams README).
const launchRoomReplies = [
  "Ready. I'll keep the decision log for ORBIT-42 and post next steps after each check.",
  "Release check passed: the brief, owner, and Friday window all line up.",
  "Logged: release check passed. Next step: confirm the Friday release window.",
];
let launchRoomId = null;
async function launchRoomThread() {
  const { rooms } = await pluginRpc("bot-teams", "list", null);
  const room = rooms.find((r) => r.name === "Launch room" && !r.archived);
  if (!room?.threadId) throw new Error("Seed the Launch room channel thread with Atlas and Scribe before capturing.");
  const { messages } = await pluginRpc("bot-teams", "room", { id: room.id });
  for (const reply of launchRoomReplies)
    if (!messages.some((m) => m.botId && m.text.startsWith(reply.slice(0, 40))))
      throw new Error(`Launch room is missing the seeded reply: ${reply}`);
  launchRoomId = room.id;
  return room.threadId;
}

async function bbCli(args) {
  const env = { ...process.env };
  delete env.BB_THREAD_ID;
  const child = spawn("bb", args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise((resolvePromise) => child.on("close", resolvePromise));
  if (code !== 0) throw new Error(`bb ${args.join(" ")} failed: ${stderr || stdout}`);
  return stdout;
}

/** A static HTML report; `draft` leaves out the September bar for version 1. */
function usageReportHtml({ draft }) {
  const months = [
    ["July", 312],
    ["August", 368],
    ...(draft ? [] : [["September", 431]]),
  ];
  const bars = months
    .map(([month, teams]) => `<div class="row"><span>${month}</span><div class="bar" style="width:${Math.round((teams / 460) * 100)}%"></div><b>${teams}</b></div>`)
    .join("\n      ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Q3 usage report</title>
  <style>
    body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2328; background: #f6f8fa; }
    main { max-width: 760px; margin: 40px auto; padding: 32px 40px; background: #fff; border: 1px solid #d0d7de; border-radius: 12px; }
    h1 { margin: 0 0 4px; font-size: 26px; }
    .lede { margin: 0 0 24px; color: #59636e; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 28px; }
    .stat { padding: 14px 16px; border: 1px solid #d0d7de; border-radius: 10px; }
    .stat b { display: block; font-size: 24px; }
    .stat span { color: #59636e; font-size: 13px; }
    .up { color: #1a7f37; font-size: 13px; }
    h2 { font-size: 16px; margin: 0 0 12px; }
    .row { display: grid; grid-template-columns: 90px 1fr 48px; align-items: center; gap: 12px; margin: 8px 0; }
    .bar { height: 18px; border-radius: 4px; background: linear-gradient(90deg, #6d5dfc, #3b82f6); }
    .row b { text-align: right; }
    ul { padding-left: 20px; color: #3d444d; }
  </style>
</head>
<body>
  <main>
    <h1>Q3 usage report</h1>
    <p class="lede">Acme app · weekly active teams, July to September</p>
    <section class="stats">
      <div class="stat"><b>${draft ? 368 : 431}</b><span>Active teams</span> <em class="up">${draft ? "+18%" : "+17%"}</em></div>
      <div class="stat"><b>99.4%</b><span>Crash-free sessions</span></div>
      <div class="stat"><b>6.2</b><span>Threads per member / week</span></div>
    </section>
    <h2>Active teams by month</h2>
    <div class="chart">
      ${bars}
    </div>
    <h2>Highlights</h2>
    <ul>
      <li>Offline sync reached every beta team in August.</li>
      <li>Team plans grew fastest in design and research orgs.</li>
    </ul>
  </main>
</body>
</html>
`;
}

/**
 * Saves "Q3 usage report" to Studio Artifacts twice from the capture thread's
 * workspace, so the viewer shows the second version of a real HTML artifact.
 */
async function seedArtifact() {
  const thread = JSON.parse(await bbCli(["thread", "get", threadId, "--json"]));
  const workspace = thread.environment?.path;
  const hostId = thread.environment?.hostId;
  if (!workspace || !hostId) throw new Error("The capture thread needs a workspace to stage the report in.");
  const file = "q3-usage-report.html";
  const path = join(workspace, file);
  const write = (content) => bbCli(["file", "write", path, "--host", hostId, "--root", workspace, "--content", content]);
  let artifactId = null;
  const cleanup = async () => {
    if (artifactId) await pluginRpc("artifacts", "delete", { id: artifactId }).catch(() => {});
    await bbCli(["file", "remove", path, "--yes", "--host", hostId, "--root", workspace]).catch(() => {});
  };
  try {
    for (const draft of [true, false]) {
      await write(usageReportHtml({ draft }));
      const { saved, failed } = await pluginRpc("artifacts", "saveFiles", { threadId, paths: [file] });
      if (failed.length) throw new Error(`Couldn't save the report: ${failed[0].error}`);
      artifactId = saved[0].artifactId;
    }
    await pluginRpc("artifacts", "update", { id: artifactId, title: "Q3 usage report", description: "Weekly active teams, July to September" });
  } catch (error) {
    await cleanup();
    throw error;
  }
  return { artifactId, cleanup };
}

async function talkRpc(method, input) {
  const dir = await mkdtemp(join(tmpdir(), "bb-talk-capture-"));
  const file = join(dir, "input.json");
  await writeFile(file, JSON.stringify(input));
  try {
    return JSON.parse(await bbCli(["plugin", "rpc", "call", "talk", method, "--input-file", file, "--json"]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runText(command, args) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise((resolvePromise) => child.on("close", resolvePromise));
  if (code !== 0) throw new Error(`${command} failed: ${stderr}`);
  return stdout;
}

/**
 * Seeds a finished Talk recording from speech synthesized with macOS `say`,
 * uploaded and transcribed through the live plugin and BB's voice service.
 * `transcribe: false` uploads the audio and pauses the recording instead, for
 * captures that only need it listed where no voice service is configured.
 */
async function seedTalkRecording(projectId, { transcribe = true } = {}) {
  const pieces = [
    ["sync", "Welcome to the weekly product sync. First up, the offline mode beta shipped to forty teams on Monday, and crash reports are down by half since the storage fix."],
    ["sync", "Onboarding is the next focus. New users still stall at the import step, so design will prototype a guided import this sprint."],
    ["sync", "For hiring, Maria is running the loop for two senior engineers, with first interviews scheduled for Thursday."],
    ["after", "Action items. Priya drafts the guided import spec. Sam shares the crash dashboard. Everyone reviews the roadmap before Friday."],
  ];
  const dir = await mkdtemp(join(tmpdir(), "bb-talk-seed-"));
  const recording = await talkRpc("recording_create", { kind: "recording", projectId, threadId: null });
  try {
    await talkRpc("recording_rename", { id: recording.id, title: "Weekly product sync" });
    let startedAt = Date.now() - 20 * 60_000;
    const sessions = { sync: "captureseed1", after: "captureseed2" };
    const indexes = { sync: 0, after: 0 };
    for (const [n, [session, text]] of pieces.entries()) {
      const aiff = join(dir, `${n}.aiff`);
      const m4a = join(dir, `${n}.m4a`);
      await runText("say", ["-o", aiff, text]);
      await runText("afconvert", ["-f", "m4af", "-d", "aac", "-b", "32000", aiff, m4a]);
      const audio = await readFile(m4a);
      const info = await runText("afinfo", [m4a]);
      const durationMs = Math.round(Number(/estimated duration: ([\d.]+)/.exec(info)?.[1] ?? 0) * 1000);
      await talkRpc("segment_put", {
        recordingId: recording.id,
        sessionId: sessions[session],
        index: indexes[session]++,
        startedAt,
        durationMs,
        mimeType: "audio/mp4",
        audioBase64: audio.toString("base64"),
      });
      startedAt += durationMs + (session === "sync" ? 0 : 60_000);
    }
    if (!transcribe) {
      // Paused rather than left "Recording", so the card doesn't show a live badge.
      await talkRpc("recording_state", { id: recording.id, status: "paused" });
      return recording.id;
    }
    await talkRpc("recording_state", { id: recording.id, status: "finishing" });
    const started = Date.now();
    for (;;) {
      const current = JSON.parse(await bbCli(["talk", "show", recording.id, "--json"]));
      if (current.status === "done" && current.pendingCount === 0) {
        if (current.failedCount > 0) throw new Error(`Talk could not transcribe ${current.failedCount} seeded pieces.`);
        break;
      }
      if (Date.now() - started > 120_000) throw new Error("Timed out waiting for Talk to transcribe the seeded recording.");
      await sleep(1000);
    }
    return recording.id;
  } catch (error) {
    await talkRpc("recording_delete", { id: recording.id }).catch(() => {});
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function ensureChrome() {
  try {
    return { webSocketUrl: await findPageTarget(), process: null };
  } catch {
    const chromePath = process.env.BB_CAPTURE_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const profileDir = await mkdtemp(join(tmpdir(), "bb-plugin-capture-"));
    const chromeProcess = spawn(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-address=127.0.0.1`,
        `--remote-debugging-port=${cdpPort}`,
        "--window-size=1440,1000",
        // Talk records from a synthetic microphone without a permission prompt.
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    const started = Date.now();
    while (Date.now() - started < 20000) {
      try {
        return { webSocketUrl: await findPageTarget(), process: chromeProcess, profileDir };
      } catch {
        await sleep(250);
      }
    }
    chromeProcess.kill();
    await rm(profileDir, { recursive: true, force: true });
    throw new Error(`Timed out waiting for Chrome DevTools on port ${cdpPort}`);
  }
}


const captures = [
  {
    id: "thread-list-plus",
    packageDir: "bb-studio-sidebar",
    showSidebar: true,
    setup: async (client) => {
      // Two Studio items opened become tabs in the Studio section, above the
      // threads and in the same scroll area.
      const { page, notes, cleanup: removePages } = await seedPages();
      const opened = [page, notes];
      for (const item of opened) {
        await client.navigate(`/plugins/pages/pages/${item.id}`);
        await client.waitForSelector(`[data-studio-tab="pages:${item.id}"]`);
      }
      await client.navigate(`/projects/${projectId}/threads/${threadId}`);
      for (const item of opened) await client.waitForSelector(`[data-studio-tab="pages:${item.id}"]`);
      const layout = JSON.parse(await client.evaluate(`JSON.stringify((() => {
        const sidebar = document.querySelector('[data-sidebar="sidebar"]');
        const studio = sidebar?.querySelector('[data-studio-sidebar-sections]');
        const threads = Array.from(sidebar?.querySelectorAll('button, p, span') ?? []).find((el) => el.textContent?.trim() === 'Threads');
        const scrollers = Array.from(studio?.querySelectorAll('*') ?? []).filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY));
        return {
          tabs: Array.from(studio?.querySelectorAll('[data-studio-tab]') ?? []).map((el) => el.textContent.trim()),
          above: Boolean(studio && threads && (studio.compareDocumentPosition(threads) & Node.DOCUMENT_POSITION_FOLLOWING)),
          scrollers: scrollers.length,
        };
      })())`));
      for (const title of ["Offline mode launch", "Release notes: October"]) {
        if (!layout.tabs.some((tab) => tab.includes(title))) throw new Error(`The Studio section is missing the ${title} tab`);
      }
      if (!layout.above) throw new Error("The Studio section is not above Threads");
      if (layout.scrollers) throw new Error("The Studio section has its own scroll area");
      return async () => {
        await pluginRpc("studio", "closeTabs", { items: opened.map((item) => ({ pluginId: "pages", id: item.id })) }).catch(() => {});
        await removePages();
      };
    },
    clip: async (client) => client.evaluate(`(() => {
      const sidebar = document.querySelector('[data-sidebar="sidebar"]');
      if (!sidebar) throw new Error('Sidebar not found for capture');
      const rect = sidebar.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: Math.min(rect.height, 640) };
    })()`),
  },
  {
    id: "thread-list-plus-dialog",
    packageDir: "bb-studio-sidebar",
    fileName: "project-dialog.png",
    showSidebar: true,
    setup: async (client) => {
      await client.navigate(`/projects/${projectId}/threads/${threadId}`);
      await client.waitForAriaButton("Threads actions");
      await client.evaluate(`document.querySelector('button[aria-label="Threads actions"]')?.scrollIntoView({ block: 'center' })`);
      await sleep(350);
      await client.clickAriaButtonWithPointer("Threads actions");
      await client.waitForSelector('[role="menuitem"]');
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "New project");
      await client.waitForSelector('[role="dialog"]');
      const hasTitle = await client.evaluate(`document.querySelector('[role="dialog"]')?.textContent?.includes('New project')`);
      if (!hasTitle) throw new Error('The live New project dialog is missing its title');
      for (const text of ["Folder path", "Browse", "Create project"]) await client.waitForText(text);
    },
    clip: async (client) => client.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) throw new Error('New project dialog not found for capture');
      const rect = dialog.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`),
  },
  {
    id: "bots",
    packageDir: "bb-studio-teams",
    fileName: "staged-preview.png",
    setup: async (client) => {
      const threadId = await launchRoomThread();
      await client.navigate(`/threads/${threadId}`);
      for (const text of launchRoomReplies) await client.waitForText(text);
      await client.waitForAriaButton("Channel members: 2 bots");
      await client.waitForAriaButton("Search channel");
      await client.evaluate(`(() => {
        const picker = [...document.querySelectorAll('[data-app-composer] button')]
          .find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Provider, model and reasoning'));
        if (!picker?.innerText.includes('Directed') || !picker.innerText.includes("Each bot's own"))
          throw new Error("The composer's picker must show the chat mode and bot permissions");
        if (!document.querySelector('a[href^="/plugins/bot-teams/mention/"]'))
          throw new Error("A bot's @mention must render as a link");
        if (document.body.innerText.includes('bots_channel_thread_post'))
          throw new Error('Posting to the channel must stay a collapsed bookkeeping row');
      })()`);
    },
  },
  {
    id: "bots-mentions",
    packageDir: "bb-studio-teams",
    fileName: "channel-mentions.png",
    setup: async (client) => {
      const threadId = await launchRoomThread();
      await client.navigate(`/threads/${threadId}`);
      await client.waitForText(launchRoomReplies[0]);
      await client.evaluate(`document.querySelector('[data-app-composer] [contenteditable="true"]')?.focus()`);
      // The menu asks providers once a character follows the trigger. A full
      // handle keeps BB's own thread and project suggestions, which are the
      // owner's real data, out of a published screenshot.
      await client.command("Input.insertText", { text: "@atlas" });
      await client.waitForText("Bots");
      await client.evaluate(`(() => {
        const menu = document.body.innerText;
        for (const text of ['Atlas', '@atlas'])
          if (!menu.includes(text)) throw new Error('The @ menu is missing ' + text);
        const headings = [...document.querySelectorAll('[role="listbox"] *, [data-mention-menu] *')]
          .map((e) => e.childElementCount === 0 ? e.textContent.trim() : '');
        if (headings.includes('Threads') || headings.includes('Projects'))
          throw new Error('The @ menu shows real threads or projects; narrow the query');
      })()`);
      return async () => {
        await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" });
        await client.evaluate(`(() => {
          const editor = document.querySelector('[data-app-composer] [contenteditable="true"]');
          editor?.focus(); document.execCommand('selectAll'); document.execCommand('delete');
        })()`);
      };
    },
  },
  {
    id: "bots-search",
    packageDir: "bb-studio-teams",
    fileName: "channel-search.png",
    setup: async (client) => {
      const threadId = await launchRoomThread();
      await client.navigate(`/threads/${threadId}`);
      await client.waitForText(launchRoomReplies[0]);
      await client.evaluate(`document.querySelector('button[aria-label="Search channel"]').click()`);
      await client.waitForSelector('input[aria-label="Search channel history"]');
      await client.evaluate(`document.querySelector('input[aria-label="Search channel history"]').focus()`);
      await client.command("Input.insertText", { text: "release check" });
      await client.waitForText("3 messages");
      await client.evaluate(`[...document.querySelectorAll('.channel-search-result')].find(r => r.innerText.includes('Logged'))?.click()`);
      await client.evaluate(`(() => {
        const open = document.querySelector('.channel-search-result[aria-expanded="true"]');
        if (!open?.innerText.includes('Next step: confirm the Friday release window.'))
          throw new Error('Choosing a result must expand the full message in place');
      })()`);
    },
  },
  {
    id: "bots-automations",
    packageDir: "bb-studio-teams",
    fileName: "channel-automations.png",
    setup: async (client) => {
      const threadId = await launchRoomThread();
      const { automations } = await pluginRpc("bot-teams", "automationList", { channelId: launchRoomId, limit: 50, offset: 0 });
      if (!automations.some((a) => a.name === "Weekday launch status" && !a.enabled))
        throw new Error("Seed the paused Weekday launch status automation in Launch room before capturing.");
      await client.navigate(`/threads/${threadId}`);
      await client.waitForText(launchRoomReplies[0]);
      await client.evaluate(`document.querySelector('button[aria-label="Channel automations"]').click()`);
      await client.waitForText("Weekday launch status");
    },
  },
  {
    id: "bots-creation",
    packageDir: "bb-studio-teams",
    fileName: "bot-creation-thread.png",
    setup: async (client) => {
      const room = await pluginRpc("bot-teams", "createRoom", {
        name: "Bot creation QA", memberIds: [], requestId: crypto.randomUUID(),
      });
      const setupPath = `/plugins/bot-teams/bots/new/${room.id}`;
      const checkComposer = async (channel = false) => {
        await client.waitForText("Help me create a persistent bot in BB Studio Teams");
        if (channel) await client.waitForText(room.id);
        await client.evaluate(`(() => {
          const editor = document.querySelector('[data-bot-creation-thread] [contenteditable="true"]');
          if (!editor || !editor.textContent.includes('bb bots') || document.activeElement !== editor)
            throw new Error('Expected focused native thread composer with bot setup instructions');
          if (document.querySelector('input[aria-label="Bot name"], textarea[aria-label="Mission"]'))
            throw new Error('Bot creation form is still present');
          if (${channel} !== editor.textContent.includes(${JSON.stringify(room.id)}))
            throw new Error('Wrong channel context in setup draft');
        })()`);
      };
      try {
        await client.navigate("/plugins/bot-teams/bots");
        await client.waitForText("New bot");
        await client.clickButtonText("New bot");
        await checkComposer();
        // Direct links and reload must show the same native composer.
        await client.navigate("/plugins/bot-teams/bots/new");
        await checkComposer();
        await client.navigate(setupPath);
        await checkComposer(true);
        await client.command("Emulation.setDeviceMetricsOverride", {
          width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
        });
        await client.evaluate(`(() => {
          const surface = document.querySelector('[data-bot-creation-thread]');
          if (surface.scrollWidth > surface.clientWidth + 1)
            throw new Error('Bot setup overflows on mobile');
        })()`);
        await client.command("Emulation.setDeviceMetricsOverride", {
          width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
        });
        await client.navigate("/plugins/bot-teams/bots/new");
        await checkComposer();
        // Exercise a failed submit without dispatching an agent or creating a bot.
        await client.evaluate(`(() => {
          window.botSetupQaFetch = window.fetch;
          window.fetch = async (input, init) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (url.includes('/rpc/createBotSetupThread')) {
              return new Response(JSON.stringify({ ok: false, error: { message: 'QA host unavailable' } }), {
                status: 503, headers: { 'content-type': 'application/json' },
              });
            }
            return window.botSetupQaFetch(input, init);
          };
        })()`);
        try {
          await client.clickFirstButtonWithAria("Submit (Enter)");
          await client.waitForText("QA host unavailable");
          await client.evaluate(`(() => {
            if (!document.querySelector('[contenteditable="true"]')?.textContent.includes('Help me create') ||
                document.querySelector('button[aria-label="Submit (Enter)"]').disabled)
              throw new Error('Failed setup must preserve the draft and allow retry');
          })()`);
        } finally {
          await client.evaluate('window.fetch = window.botSetupQaFetch');
        }
        await client.navigate("/plugins/bot-teams/bots/new");
        await checkComposer();
        return async () => { await pluginRpc("bot-teams", "deleteRoom", { id: room.id }); };
      } catch (error) {
        await pluginRpc("bot-teams", "deleteRoom", { id: room.id });
        throw error;
      }
    },
  },
  {
    id: "bots-profile",
    packageDir: "bb-studio-teams",
    fileName: "bot-profile.png",
    setup: async (client) => {
      await captures.find((capture) => capture.id === "bots-collection").setup(client);
      await client.evaluate(`(() => {
        const bot = Array.from(document.querySelectorAll('[data-resource-row] button')).find((button) => button.textContent.startsWith('Atlas'));
        if (!bot) throw new Error('Atlas is missing from the live collection');
        bot.click();
      })()`);
      await client.waitForInputValue("Bot name", "Atlas");
      await client.waitForInputValue("Bot role", "Research and verify the facts");
      await client.waitForText("Mission schedule");
      await client.evaluate(`(() => {
        const hero = document.querySelector('.bot-detail .bot-hero');
        if (hero?.querySelector('h1')?.textContent !== 'Atlas' || !hero.textContent.includes('@atlas'))
          throw new Error('The bot page must open with its avatar, name and handle');
        const header = Array.from(document.querySelectorAll('.bot-detail button')).map((button) => button.getAttribute('aria-label') || button.textContent.trim());
        for (const label of ['Studio', 'Message', 'Bot options'])
          if (!header.some((text) => text.includes(label))) throw new Error('The bot header is missing ' + label);
        const form = document.querySelector('form[aria-label="Bot profile"]');
        const rows = Array.from(form?.querySelectorAll('.bot-form-row > :first-child') ?? []).map((label) => label.textContent.trim());
        const expected = ['Name', 'Avatar', 'Role', 'Primary model', 'Fallback model', 'Permissions', 'Mission schedule'];
        if (rows.join('|') !== expected.join('|') || !form.querySelector('button[aria-label="Mission schedule"]')) {
          throw new Error('Expected native bot settings rows and schedule picker, got ' + rows.join(', '));
        }
        const width = form.closest('.bot-config-content').getBoundingClientRect().width;
        if (width > 1024 || width < 900) throw new Error('Bot configuration must use BB collection width');
        const save = Array.from(form.querySelectorAll('button')).find((button) => button.textContent === 'Save profile');
        if ((save && !save.disabled) || document.body.innerText.includes('Unsaved changes')) throw new Error('Unchanged profiles must not offer Save');
      })()`);
    },
  },
  {
    id: "bots-memory",
    packageDir: "bb-studio-teams",
    fileName: "bot-memory.png",
    setup: async (client) => {
      await captures.find((capture) => capture.id === "bots-profile").setup(client);
      await client.evaluate(`Array.from(document.querySelectorAll('.bot-tabs button')).find((button) => button.textContent === 'Memory').click()`);
      await client.waitForText("MEMORY.md");
      // Wait for the real file, not just the empty editor shell.
      const started = Date.now();
      while (!(await client.evaluate(`document.querySelector('[aria-label="MEMORY.md"]')?.textContent.includes('ORBIT-42')`))) {
        if (Date.now() - started > 10000) throw new Error('Atlas memory must contain the staged launch brief');
        await sleep(100);
      }
      await client.evaluate(`(() => {
        const editor = document.querySelector('[aria-label="MEMORY.md"]');
        const source = document.querySelector('.bot-markdown-source').getBoundingClientRect();
        const frame = document.querySelector('.bot-markdown-editor').getBoundingClientRect();
        if (source.height < 208 || frame.bottom > innerHeight || editor.getAttribute('contenteditable') !== 'true')
          throw new Error('Memory editor must fit the page and be editable');
        const save = Array.from(document.querySelectorAll('.bot-document button')).find((button) => button.textContent === 'Save memory');
        if ((save && !save.disabled) || !document.querySelector('.bot-document [data-icon="RotateCcw"]')) throw new Error('Expected native reload and no save for unchanged memory');
      })()`);
    },
  },
  {
    id: "bots-collection",
    packageDir: "bb-studio-teams",
    fileName: "bots-collection.png",
    setup: async (client) => {
      await client.navigate("/");
      await client.waitForText("Studio Teams");
      await client.evaluate(`(() => {
        const button = Array.from(document.querySelectorAll('[data-sidebar="sidebar"] button'))
          .find((candidate) => candidate.textContent.trim() === 'Studio Teams');
        if (!button) throw new Error('Studio Teams navigation is missing');
        button.click();
      })()`);
      await client.waitForAriaButton("Filter bots");
      await client.waitForAriaButton("Sort bots");
      await client.waitForText("Research and verify the facts");
      await client.evaluate(`(() => {
        const collection = document.querySelector('[data-bots-collection]');
        if (!collection?.querySelector('input[aria-label="Search bots"]') || !collection.querySelector('[data-resource-list-panel]')) {
          throw new Error('Bots collection must use a search toolbar and native bordered list');
        }
        const rows = Array.from(collection.querySelectorAll('[data-resource-row]'));
        for (const name of ['Atlas', 'Quinn', 'Relay', 'Scribe']) {
          if (!rows.some((row) => row.textContent.includes(name) && row.textContent.includes('@'))) {
            throw new Error('Missing staged bot: ' + name);
          }
        }
        const width = collection.firstElementChild.getBoundingClientRect().width;
        if (width > 1024 || width < 900) throw new Error('Bots collection must use BB collection content width');
      })()`);
    },
  },
  {
    id: "bots-sidebar",
    packageDir: "bb-studio-teams",
    fileName: "studio-sidebar.png",
    showSidebar: true,
    setup: async (client) => {
      // Channels and Direct messages are Studio Sidebar sections: between
      // Studio and Threads, in the sidebar's one scroll area.
      await client.navigate(`/projects/${projectId}/threads/${threadId}`);
      await client.waitForSelector('section[aria-label="Channels"] .channel-sidebar-row');
      await client.waitForSelector('section[aria-label="Direct messages"] .direct-thread-nav-row');
      const layout = JSON.parse(await client.evaluate(`JSON.stringify((() => {
        const sidebar = document.querySelector('[data-sidebar="sidebar"]');
        const sections = Array.from(sidebar.querySelectorAll('[data-studio-sidebar-sections] > section, [data-studio-sidebar-sections] section[aria-label]'))
          .map((el) => el.getAttribute('aria-label'));
        const root = sidebar.querySelector('[data-studio-sidebar-sections]');
        const threads = Array.from(sidebar.querySelectorAll('button, p, span')).find((el) => el.textContent?.trim() === 'Threads');
        const scrollers = Array.from(root.querySelectorAll('*')).filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY));
        return {
          sections,
          channels: Array.from(sidebar.querySelectorAll('.channel-sidebar-row .channel-nav-name')).map((el) => el.textContent),
          direct: Array.from(sidebar.querySelectorAll('.direct-thread-nav-row')).map((el) => el.textContent),
          above: Boolean(threads && (root.compareDocumentPosition(threads) & Node.DOCUMENT_POSITION_FOLLOWING)),
          scrollers: scrollers.length,
        };
      })())`));
      const order = ["Channels", "Direct messages"].map((name) => layout.sections.indexOf(name));
      if (order.includes(-1) || order[0] > order[1]) throw new Error(`Expected Channels then Direct messages, got ${layout.sections.join(", ")}`);
      for (const name of ["Launch room", "Design review"])
        if (!layout.channels.includes(name)) throw new Error(`The Channels section is missing ${name}`);
      if (!layout.direct.some((row) => row.includes("Atlas"))) throw new Error("Direct messages is missing the Atlas thread");
      if (!layout.above) throw new Error("The Studio Teams sections are not above Threads");
      if (layout.scrollers) throw new Error("A Studio Teams section has its own scroll area");
    },
    // From the Studio sections down, so the rows and the Threads heading below show.
    clip: async (client) => client.evaluate(`(() => {
      const sidebar = document.querySelector('[data-sidebar="sidebar"]').getBoundingClientRect();
      const top = document.querySelector('[data-studio-sidebar-sections]').getBoundingClientRect().top - 12;
      return { x: sidebar.x, y: top, width: sidebar.width, height: Math.min(sidebar.bottom - top, 460) };
    })()`),
  },
  {
    id: "excalidraw",
    packageDir: "bb-studio-draw",
    privateSidebar: true,
    setup: async (client) => {
      const { drawing, cleanup } = await seedDrawing();
      try {
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForInputValue("Drawing name", "Checkout flow");
        await client.waitForAriaButton("Copy image");
        await client.waitForAriaButton("More");
        await client.waitForText("New thread");
        await client.waitForText("Saved");
        await client.waitForSelector("canvas.excalidraw__canvas");
        // The staged scene is on the canvas, not a blank one.
        const count = await client.evaluate(`(async () => (await (await fetch("/api/v1/plugins/excalidraw/rpc/getDrawing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ${JSON.stringify(drawing.id)} }) })).json()).result.drawing.data)()`, true);
        if (JSON.parse(count).elements.filter((element) => !element.isDeleted).length !== 9) throw new Error("The staged drawing lost its elements");
        await sleep(1500);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "studio-chat",
    packageDir: "bb-studio-chat",
    privateSidebar: true,
    setup: async (client) => {
      const { drawing, cleanup } = await seedDrawing();
      const forget = async () => {
        await client.evaluate(`sessionStorage.removeItem("bb-studio-chat:state")`).catch(() => {});
        await cleanup();
      };
      try {
        // Over a Studio item, the closed chat is a bar named for its kind.
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.evaluate(`sessionStorage.removeItem("bb-studio-chat:state")`);
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector("canvas.excalidraw__canvas");
        await client.waitForText("Work with this drawing…");
        // The seeded thread's header floats it into the chat.
        const title = await client.evaluate(
          `(async () => { const body = await (await fetch("/api/v1/threads/${threadId}")).json(); const thread = body.thread ?? body; return thread.title ?? thread.titleFallback ?? ""; })()`,
          true,
        );
        if (!title) throw new Error("The seeded thread has no title to check the chat header against");
        await client.navigate(`/threads/${threadId}`);
        await client.waitForSelector(".studio-chat-float");
        await client.evaluate(`document.querySelector(".studio-chat-float").click()`);
        // The card steps aside on the thread's own view and returns over the drawing.
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector('section[aria-label="Studio chat"]');
        await client.waitForText("Viewing: Checkout flow");
        const header = await client.evaluate(`document.querySelector('section[aria-label="Studio chat"] .studio-chat-title')?.innerText ?? ""`);
        if (!header.includes(title)) throw new Error(`The floating chat shows "${header}", not the seeded thread "${title}"`);
        await client.waitForSelector("canvas.excalidraw__canvas");
        await sleep(1500);
      } catch (error) {
        await forget();
        throw error;
      }
      return forget;
    },
  },
  {
    id: "talk",
    packageDir: "bb-studio-talk",
    privateSidebar: true,
    setup: async (client) => {
      const recordingId = await seedTalkRecording(projectId);
      const cleanup = async () => {
        await client.evaluate(`document.querySelector('[data-talk-overlay] button[aria-label="Stop recording"]')?.click()`);
        await sleep(1500);
        await talkRpc("recording_delete", { id: recordingId });
      };
      try {
        await client.navigate(`/plugins/talk/recordings/${recordingId}`);
        await client.waitForText("Weekly product sync");
        await client.waitForText("offline mode beta");
        await client.waitForText("guided import spec");
        await client.waitForText("Record more");
        // Record from the synthetic microphone so the live pill is on screen.
        await client.clickButtonText("Record more");
        await client.waitForSelector("[data-talk-overlay]");
        await client.waitForAriaButton("Stop recording");
        await client.waitForText("Pause");
        await sleep(2500);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "pages",
    packageDir: "bb-studio-pages",
    privateSidebar: true,
    setup: async (client) => {
      const { page, cleanup } = await seedPages();
      try {
        await client.navigate(`/plugins/pages/pages/${page.id}`);
        await client.waitForSelector('nav[aria-label="Breadcrumbs"]');
        await client.waitForAriaButton("Comments");
        await client.waitForAriaButton("Page actions");
        await client.waitForText("Work with this page…");
        await client.waitForText("Offline mode launch");
        await client.waitForText("Beta teams");
        await client.waitForText("Crash-free sessions");
        await client.waitForText("Weekly active teams");
        await client.waitForText("Localise onboarding for Japanese and German");
        await client.waitForSelector(".recharts-bar-rectangle");
        // Talk is installed in the staged app, so the page offers dictation.
        await client.waitForSelector('[data-talk-field^="pages:"]');
        await client.waitForAriaButton("Dictate");
        await sleep(1000);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "pages-collection",
    packageDir: "bb-studio-pages",
    fileName: "collection.png",
    privateSidebar: true,
    setup: async (client) => {
      const { cleanup } = await seedPages();
      try {
        // With Studio installed, Pages' collection hands over to Studio,
        // filtered to pages. Shows the list view across every project.
        await client.navigate("/plugins/pages/pages");
        await client.evaluate(`localStorage.setItem("studio:collection:view", "list"); localStorage.removeItem("studio:collection:project"); localStorage.setItem("studio:sidebar-tip-dismissed", "1")`);
        await client.navigate("/plugins/studio/studio/page");
        await client.waitForSelector('input[aria-label="Search studio"]');
        await client.waitForSelector('[role="grid"]');
        await client.waitForText("New page");
        await client.waitForText("Offline mode launch");
        await client.waitForText("Rollout risks");
        await client.waitForText("Release notes: October");
        await sleep(800);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "studio",
    packageDir: "bb-studio",
    privateSidebar: true,
    setup: async (client) => {
      const pages = await seedPages();
      const drawing = await seedDrawing();
      let recordingId = null;
      const cleanup = async () => {
        await pages.cleanup();
        await drawing.cleanup();
        if (recordingId) await talkRpc("recording_delete", { id: recordingId }).catch(() => {});
      };
      try {
        // Studio only lists the recording, so it needn't be transcribed.
        recordingId = await seedTalkRecording(projectId, { transcribe: false });
        await client.navigate("/plugins/studio/studio");
        await client.evaluate(`localStorage.setItem("studio:collection:view", "grid"); localStorage.setItem("studio:collection:project", ${JSON.stringify(projectId)}); localStorage.setItem("studio:sidebar-tip-dismissed", "1")`);
        await client.navigate("/plugins/studio/studio");
        await client.waitForSelector('input[aria-label="Search studio"]');
        await client.waitForText("Pages");
        await client.waitForText("Recordings");
        await client.waitForText("Drawings");
        await client.waitForText("Offline mode launch");
        await client.waitForText("Weekly product sync");
        await client.waitForText("Checkout flow");
        // The drawing's card shows its server-rendered thumbnail.
        await client.waitForSelector('img[src*="/plugins/excalidraw/http/thumbnail"]');
        const loaded = await client.evaluate(`(async () => { const img = document.querySelector('img[src*="/plugins/excalidraw/http/thumbnail"]'); await img.decode(); return img.naturalWidth > 0; })()`, true);
        if (!loaded) throw new Error("The drawing thumbnail didn't load");
        await sleep(1000);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "studio-search",
    packageDir: "bb-studio",
    fileName: "search.png",
    privateSidebar: true,
    setup: async (client) => {
      const pages = await seedPages();
      const artifact = await seedArtifact().catch(async (error) => {
        await pages.cleanup();
        throw error;
      });
      const taskIds = [];
      const cleanup = async () => {
        await pages.cleanup();
        await artifact.cleanup();
        for (const id of taskIds) await pluginRpc("studio-tasks", "delete", { id }).catch(() => {});
      };
      try {
        for (const task of [
          { title: "Write the launch post", status: "todo", assignee: "me", description: "Announce offline sync and the new team plans." },
          { title: "Add offline sync to settings", status: "review", assignee: "agent" },
        ]) {
          const { task: created } = await pluginRpc("studio-tasks", "create", { ...task, projectId });
          taskIds.push(created.id);
        }
        // Artifacts search their saved text; check it through Studio's hub.
        const found = await pluginRpc("studio", "search", { query: "weekly active teams" });
        const key = `artifacts:${artifact.artifactId}`;
        if (!found.keys.includes(key) || !/weekly active teams/i.test(found.snippets[key] ?? "")) {
          throw new Error(`Studio search didn't find the artifact with a snippet: ${JSON.stringify(found)}`);
        }
        await client.navigate("/plugins/studio/studio");
        await client.waitForSelector('input[aria-label="Search studio"]');
        // Open Studio search with its real shortcut, Mod+Shift+K.
        const modifiers = (process.platform === "darwin" ? 4 : 2) | 8;
        // rawKeyDown: a shortcut with no text, as a real keyboard sends it.
        for (const type of ["rawKeyDown", "keyUp"]) {
          await client.command("Input.dispatchKeyEvent", { type, modifiers, key: "K", code: "KeyK", windowsVirtualKeyCode: 75 });
        }
        await client.waitForSelector('.studio-quick-open [role="dialog"][aria-label="Search Studio"]');
        await client.waitForText("Recently changed");
        await client.command("Input.insertText", { text: "offline sync" });
        // The task's title matches; the page and the other task match on content.
        await client.waitForText("Add offline sync to settings");
        await client.waitForText("Announce offline sync and the new team plans.");
        await client.waitForText("Offline sync for every team");
        await client.waitForText("Ship offline sync to beta teams");
        const snippets = await client.evaluate(`document.querySelectorAll(".studio-quick-open-snippet mark").length`);
        if (snippets < 3) throw new Error(`Expected highlighted snippets, found ${snippets}`);
        await sleep(600);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "artifacts",
    packageDir: "bb-studio-artifacts",
    privateSidebar: true,
    setup: async (client) => {
      const { artifactId, cleanup } = await seedArtifact();
      try {
        await client.navigate(`/plugins/artifacts/artifacts/${artifactId}`);
        await client.waitForInputValue("Artifact title", "Q3 usage report");
        await client.waitForText("HTML ·");
        await client.waitForText("· v2");
        await client.waitForText("Preview");
        await client.waitForText("Source");
        await client.waitForText("New thread");
        await client.waitForAriaButton("Copy");
        await client.waitForAriaButton("More");
        // The report renders in its sandboxed frame from the content route.
        await client.waitForSelector('iframe[sandbox="allow-scripts"][title="q3-usage-report.html"]');
        const rendered = await client.evaluate(`(async () => {
          const frame = document.querySelector('iframe[title="q3-usage-report.html"]');
          const body = await (await fetch(frame.src)).text();
          return body.includes("Q3 usage report") && body.includes("September");
        })()`, true);
        if (!rendered) throw new Error("The viewer isn't showing the report's latest version");
        await sleep(1500);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "studio-tasks",
    packageDir: "bb-studio-tasks",
    privateSidebar: true,
    setup: async (client) => {
      const seeded = [
        { title: "Write the launch post", status: "todo", assignee: "me", due: "2026-10-06", description: "Announce offline sync and the new team plans." },
        { title: "Update the pricing page copy", status: "todo", assignee: "agent" },
        { title: "Fix the flaky checkout test", status: "in_progress", assignee: "agent" },
        { title: "Add offline sync to settings", status: "review", assignee: "agent" },
        { title: "Draft the Q3 usage report", status: "done", assignee: "me" },
      ];
      const ids = [];
      const cleanup = async () => {
        for (const id of ids) await pluginRpc("studio-tasks", "delete", { id }).catch(() => {});
      };
      try {
        for (const task of seeded) {
          const { task: created } = await pluginRpc("studio-tasks", "create", { ...task, projectId });
          ids.push(created.id);
        }
        await client.navigate("/plugins/studio-tasks/tasks");
        for (const column of ["To do", "In progress", "Review", "Done"]) await client.waitForText(column);
        for (const task of seeded) await client.waitForText(task.title);
        await client.waitForText("New task");
        await sleep(1000);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "reactions",
    packageDir: "bb-studio-reactions",
    setup: async (client) => {
      await client.navigate("/settings/plugins/emoji-react");
      await client.waitForText("Studio Reactions");
      await client.waitForText("Reactions in the text selection menu and the bar under messages");
      await client.waitForText("👍 Agree");
      await client.waitForText("Quote the highlighted text");
    },
  },
  {
    id: "reactions-smart",
    packageDir: "bb-studio-reactions",
    fileName: "smart-reactions.png",
    privateSidebar: true,
    // Seed a thread with smart reactions on that asks "SQLite or Postgres?";
    // its reply must end with a ::reactions directive naming both.
    setup: async (client) => {
      const smartThreadId = process.env.BB_CAPTURE_SMART_REACTIONS_THREAD_ID ?? threadId;
      await client.navigate(`/projects/${projectId}/threads/${smartThreadId}`);
      await client.waitForSelector('[role="group"][aria-label="Suggested reactions"]');
      await client.evaluate(`(() => {
        const group = document.querySelector('[role="group"][aria-label="Suggested reactions"]');
        const labels = Array.from(group.querySelectorAll("button")).map((button) => button.textContent.trim());
        for (const label of ["SQLite", "Postgres"]) {
          if (!labels.some((text) => text.endsWith(label))) {
            throw new Error("Smart reactions are missing " + label + ": " + labels.join(", "));
          }
        }
        if (document.body.innerText.includes("::reactions{")) {
          throw new Error("The raw ::reactions directive is still visible");
        }
        group.scrollIntoView({ block: "center" });
        return true;
      })()`);
      // Clicking a reaction drafts it into the composer.
      await client.evaluate(`new Promise((resolve, reject) => {
        Array.from(document.querySelectorAll('[aria-label="Suggested reactions"] button'))
          .find((button) => button.textContent.trim().endsWith("SQLite"))
          .click();
        const started = Date.now();
        const check = () => {
          const editor = document.querySelector('[contenteditable="true"]');
          if (editor?.innerText.includes("SQLite")) return resolve(true);
          if (Date.now() - started > 5000) return reject(new Error("Clicking SQLite did not draft a reply"));
          setTimeout(check, 100);
        };
        check();
      })`, true);
      return async () => {
        await client.evaluate(`(() => {
          const editor = document.querySelector('[contenteditable="true"]');
          editor?.focus();
          document.execCommand("selectAll");
          document.execCommand("delete");
          return true;
        })()`);
      };
    },
    // End the frame below the reactions, above the composer and machine name.
    clip: (client) =>
      client.evaluate(`(() => {
        const group = document.querySelector('[role="group"][aria-label="Suggested reactions"]');
        const bottom = group.getBoundingClientRect().bottom + 24;
        return { x: 0, y: 0, width: window.innerWidth, height: Math.round(bottom) };
      })()`),
  },
];

const { webSocketUrl, process: chromeProcess, profileDir } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
await client.connect();
await client.command("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

try {
  for (const capture of captures) {
    if (captureOnly && !captureOnly.has(capture.id)) continue;
    process.stdout.write(`Capturing ${capture.id}...\n`);
    const cleanup = await capture.setup(client);
    try {
      const outputPath = join(repoRoot, "packages", capture.packageDir, "assets", capture.fileName ?? "staged-preview.png");
      // Use BB's real collapsed-sidebar state so publication does not expose
      // unrelated local projects/threads alongside the deterministic fixtures.
      const privateSidebar = !capture.showSidebar && (capture.privateSidebar || (capture.packageDir === "bb-studio-teams" && capture.id !== "bots-forks"));
      if (privateSidebar) {
        await client.evaluate(`document.querySelector('button[aria-label^="Toggle sidebar"]')?.click()`);
        await sleep(350);
      }
      // A capture may crop the real frame, such as to leave out machine names.
      await client.capture(outputPath, capture.clip ? await capture.clip(client) : undefined);
      if (privateSidebar) {
        await client.evaluate(`document.querySelector('button[aria-label^="Toggle sidebar"]')?.click()`);
        await sleep(350);
      }
      process.stdout.write(`  ${outputPath}\n`);
    } finally {
      if (cleanup) await cleanup();
    }
  }
} finally {
  client.socket?.close();
  if (chromeProcess) {
    // Chrome holds its profile open until it exits.
    const exited = new Promise((resolve) => chromeProcess.once("exit", resolve));
    chromeProcess.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
