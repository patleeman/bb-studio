#!/usr/bin/env node
/**
 * Visual Chat timing: how soon a NEW canvas shows something, shows a real
 * card, and shows its final page. Each run is one canvas.create with the same
 * prompt on a real agent turn in a staged BB:
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   node scripts/capture/canvas-stream-timing.mjs --runs 4 --out <dir> \
 *     [--stills <dir>] [--dark] [--record <file.mp4>] [--turn-ms 360000] \
 *     [--provider claude-code] [--model claude-sonnet-5-5] [--prompt "..."]
 *
 * Per run, in ms since t0 (just before canvas.create), sampled every ~100 ms:
 * - firstContent: the page frame's #cv-page shows a visible element (box > 0,
 *   effective opacity > 0.1, not inside [data-cv-pending]) with its own text,
 *   or an img/svg.
 * - firstCard: a visible, not pending card ([data-block="card"]) shows a
 *   loaded picture or a drawn rating (.cv-card-rating with children).
 * - finalPage: the frame shows a committed page of the turn: its html has a
 *   data-cv-rev (set only by a committed page, never a stream), no
 *   data-cv-streaming and no part still pending. With a draft (canvas_page
 *   before the full page) the draft would count; Visual Chat no longer drafts.
 * - captionShown: the chat line shows the caption ([data-canvas-caption] p)
 *   and the outer page isn't working.
 * - total: the first sample where canvas.get said idle.
 * - rounds: model responses (API calls) in the turn, exactly, from the staged
 *   Claude Code transcript (transcriptRounds); roundsEvents is the estimate
 *   from the hidden thread's raw events (countRounds), which overcounts when
 *   Claude Code runs a tool while the same response is still streaming the
 *   next tool call. Plus the tools called in order (from the events).
 * Writes <out>/results.json (and each run's raw events) and prints a table
 * with the median. --stills saves early (firstContent + 1.5 s), middle
 * (halfway firstContent to finalPage) and final PNGs; --dark adds a dark
 * final. --record encodes the tab's screencast to H.264 at 25 fps
 * (run-N inserted before the extension when --runs > 1).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { CdpClient, ensureChrome } from "./driver.mjs";
import { bbCli, cdpPort, pluginRpc, sleep } from "./bb.mjs";

// ---- arguments ----
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
};
const RUNS = Number(option("runs", "4"));
const OUT = resolve(option("out", join(tmpdir(), `canvas-stream-timing-${Date.now()}`)));
const STILLS = option("stills", null) ? resolve(option("stills")) : null;
const DARK = flag("dark");
const RECORD = option("record", null) ? resolve(option("record")) : null;
const TURN_MS = Number(option("turn-ms", String(6 * 60_000)));
const PROVIDER = option("provider", "claude-code");
const MODEL = option("model", "claude-sonnet-5-5");
const PROMPT = option("prompt", "I just bought a Chromatic, give me a showcase of games including ratings");
const SAMPLE_MS = 100;
const SETTLE_MS = 30_000;
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const VIEW = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
await mkdir(OUT, { recursive: true });
if (STILLS) await mkdir(STILLS, { recursive: true });

// ---- probes ----
// Inside the page frame: what's visible in #cv-page, and the frame's revision.
const FRAME_PROBE = `(() => {
  const root = document.getElementById("cv-page");
  const rev = document.documentElement.getAttribute("data-cv-rev");
  if (!root) return { root: false, rev };
  const opacity = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === "none" || s.visibility === "hidden") return 0; o *= Number(s.opacity); } return o; };
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && opacity(el) > 0.1; };
  const pending = (el) => !!el.closest("[data-cv-pending]");
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  let content = 0;
  for (const el of root.querySelectorAll("*")) {
    if (!(ownText(el) || el.tagName === "IMG" || el.tagName.toLowerCase() === "svg")) continue;
    if (pending(el) || !shown(el)) continue;
    content++;
    if (content > 2) break;
  }
  let cards = 0, realCards = 0;
  for (const card of root.querySelectorAll('[data-block="card"], .cv-card')) {
    if (pending(card) || !shown(card)) continue;
    cards++;
    const pic = [...card.querySelectorAll("img")].some((img) => img.complete && img.naturalWidth > 0);
    const rating = [...card.querySelectorAll(".cv-card-rating")].some((r) => r.children.length > 0);
    if (pic || rating) realCards++;
  }
  const running = document.getAnimations().filter((a) => a.playState === "running").length;
  const loading = [...root.querySelectorAll("img")].filter((img) => !img.complete).length;
  return { root: true, rev, streaming: root.hasAttribute("data-cv-streaming"), content, cards, realCards, running, loading, pending: root.querySelectorAll("[data-cv-pending]").length, scrollHeight: document.documentElement.scrollHeight };
})()`;

// The outer page: its revision and whether the page frame is there.
const OUTER_PROBE = `(() => {
  const page = document.querySelector("[data-canvas-page]");
  const frame = document.querySelector("iframe[data-canvas-page-frame]");
  const caption = document.querySelector("[data-canvas-caption] p")?.textContent?.trim() ?? "";
  return { rev: page ? Number(page.dataset.canvasRev ?? 0) : null, status: page?.dataset.canvasStatus ?? null, caption: caption.length > 0 && page?.dataset.canvasStatus !== "working", frame: !!frame, frameRev: frame ? Number(frame.dataset.pageRev ?? 0) : null, running: document.getAnimations().filter((a) => a.playState === "running").length };
})()`;

// ---- browser ----
const { webSocketUrl, process: chrome, profileDir } = await ensureChrome();
const tab = new CdpClient(webSocketUrl);
await tab.connect();
await tab.command("Emulation.setDeviceMetricsOverride", VIEW);
await tab.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await tab.command("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await tab.command("Page.bringToFront").catch(() => {});
// CdpClient only resolves command replies; events (screencast frames) come through here.
const eventHandlers = new Set();
tab.socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method) for (const handler of eventHandlers) handler(message);
});

/**
 * The page frame is a sandboxed srcdoc frame (an opaque origin). Chrome may
 * run it in process (Page.getFrameTree + an isolated world reaches it) or
 * out of process (its own iframe target, attached with a flat session).
 * Either handle goes stale when the frame reloads; it's found again.
 */
let frameHandle = null;
async function findFrame() {
  // In process: the child frame of the main frame whose document has #cv-page.
  try {
    const { frameTree } = await tab.command("Page.getFrameTree", {}, 5000);
    const children = [];
    const walk = (node) => { for (const child of node.childFrames ?? []) { children.push(child.frame); walk(child); } };
    walk(frameTree);
    for (const frame of children) {
      try {
        const { executionContextId } = await tab.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "canvas-stream-timing" }, 5000);
        const probe = await tab.command("Runtime.evaluate", { expression: `!!document.getElementById("cv-page")`, contextId: executionContextId, returnByValue: true }, 5000);
        if (probe.result?.value === true) return { kind: "world", frameId: frame.id, contextId: executionContextId };
      } catch { /* out of process, or gone */ }
    }
  } catch { /* no tree yet */ }
  // Out of process: an iframe target whose document has #cv-page.
  const { targetInfos } = await tab.command("Target.getTargets", {}, 5000);
  for (const target of targetInfos.filter((info) => info.type === "iframe")) {
    let sessionId = null;
    try {
      ({ sessionId } = await tab.command("Target.attachToTarget", { targetId: target.targetId, flatten: true }, 5000));
      const probe = await tab.command("Runtime.evaluate", { expression: `!!document.getElementById("cv-page")`, returnByValue: true }, 5000, sessionId);
      if (probe.result?.value === true) return { kind: "target", targetId: target.targetId, sessionId };
      await tab.command("Target.detachFromTarget", { sessionId }).catch(() => {});
    } catch {
      if (sessionId) await tab.command("Target.detachFromTarget", { sessionId }).catch(() => {});
    }
  }
  return null;
}

async function frameEval(expression) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!frameHandle) frameHandle = await findFrame();
    if (!frameHandle) return null;
    try {
      const reply = frameHandle.kind === "world"
        ? await tab.command("Runtime.evaluate", { expression, contextId: frameHandle.contextId, returnByValue: true }, 5000)
        : await tab.command("Runtime.evaluate", { expression, returnByValue: true }, 5000, frameHandle.sessionId);
      if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
      return reply.result?.value ?? null;
    } catch {
      if (frameHandle?.kind === "target") await tab.command("Target.detachFromTarget", { sessionId: frameHandle.sessionId }).catch(() => {});
      frameHandle = null;
    }
  }
  return null;
}

async function collapseSidebar() {
  await tab.poll(`(() => { const sidebar = document.querySelector('[data-sidebar="sidebar"]'); const state = sidebar?.closest('[data-state]')?.getAttribute('data-state'); if (sidebar && state !== 'collapsed' && state !== 'closed') document.querySelector('button[aria-label^="Toggle sidebar" i]')?.click(); return true; })()`);
}

// ---- recording ----
function startRecording() {
  const frames = [];
  const handler = (message) => {
    if (message.method !== "Page.screencastFrame") return;
    const { data, metadata, sessionId } = message.params;
    frames.push({ data: Buffer.from(data, "base64"), at: metadata.timestamp ? metadata.timestamp * 1000 : Date.now() });
    tab.command("Page.screencastFrameAck", { sessionId }).catch(() => {});
  };
  eventHandlers.add(handler);
  const started = tab.command("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 });
  return {
    async stop(file) {
      await started.catch(() => {});
      await tab.command("Page.stopScreencast").catch(() => {});
      eventHandlers.delete(handler);
      if (frames.length < 2) { log(`recording: only ${frames.length} frames, nothing encoded`); return; }
      const dir = await mkdtemp(join(tmpdir(), "canvas-stream-rec-"));
      try {
        const lines = [];
        for (const [index, frame] of frames.entries()) {
          const name = `f${String(index).padStart(5, "0")}.jpg`;
          await writeFile(join(dir, name), frame.data);
          lines.push(`file '${name}'`);
          // Each frame stays until the next one arrives (real timestamps); the last holds 1 s.
          const next = frames[index + 1];
          lines.push(`duration ${((next ? next.at - frame.at : 1000) / 1000).toFixed(4)}`);
        }
        lines.push(`file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'`);
        await writeFile(join(dir, "list.txt"), lines.join("\n") + "\n");
        await mkdir(dirname(file), { recursive: true });
        await new Promise((resolvePromise, reject) => {
          const child = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"),
            "-vf", `fps=25,scale=${VIEW.width}:${VIEW.height}:force_original_aspect_ratio=decrease:out_range=tv,pad=${VIEW.width}:${VIEW.height}:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p`,
            "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-color_range", "tv", "-movflags", "+faststart", file], { stdio: ["ignore", "inherit", "inherit"] });
          child.once("error", reject);
          child.once("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`ffmpeg exited ${code}`)));
        });
        log(`recording: ${frames.length} frames -> ${file}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

// ---- thread events ----
async function threadEvents(threadId) {
  const raw = await bbCli(["thread", "messages", threadId, "--all", "--json"]);
  const events = JSON.parse(raw);
  if (!Array.isArray(events)) throw new Error(`thread messages: ${raw.slice(0, 300)}`);
  return events;
}

const TOOL_TYPES = new Set(["mcpToolCall", "dynamicToolCall", "commandExecution", "fileChange", "webSearch", "toolCall", "imageView"]);
const toolName = (item) => item.tool ?? item.name ?? item.toolName ?? (item.type === "commandExecution" ? "Bash" : item.type);

/**
 * Model responses in the turn, exactly: the staged Claude Code session's
 * transcript (the wrapper's CLAUDE_CONFIG_DIR, ~/.bb-staged/claude, read
 * only) has one line per content block, each carrying its API response's
 * message.id; rounds = distinct assistant message ids. null when the
 * provider isn't Claude Code or the transcript isn't there.
 */
async function transcriptRounds(events) {
  const sessionId = events.find((event) => event.type === "thread/identity")?.data?.providerThreadId;
  const projects = join(process.env.BB_STAGED_CLAUDE_HOME?.trim() || join(homedir(), ".bb-staged", "claude"), "projects");
  if (!sessionId || !existsSync(projects)) return null;
  for (const dir of await readdir(projects)) {
    const file = join(projects, dir, `${sessionId}.jsonl`);
    if (!existsSync(file)) continue;
    const ids = [];
    const tools = [];
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type !== "assistant" || entry.isSidechain || !entry.message?.id) continue;
      if (!ids.includes(entry.message.id)) ids.push(entry.message.id);
      for (const block of entry.message.content ?? []) if (block.type === "tool_use") tools.push(String(block.name).replace(/^mcp__[^_]+(?:-[^_]+)*__/, ""));
    }
    return { rounds: ids.length, tools };
  }
  return null;
}

/**
 * Estimate, from the raw events (oldest first). Only
 * item/started events are read: an assistant item (text, reasoning, tool
 * call) belongs to the current response until a tool result has arrived
 * (an item/completed of a tool item); the next assistant item after that
 * starts a new response. So tool calls issued together (before any of their
 * results) are one batch, and rounds = 1 + the batches that were answered by
 * another response, which equals the number of responses. The events carry
 * no response id, and Claude Code runs a tool as soon as its call is
 * complete, so a result can land before the same response's next call: that
 * response is then counted twice (an overcount, never an undercount).
 */
function countRounds(events) {
  let rounds = 0;
  let open = false; // a response is in progress and no tool result has come back since it started
  const tools = [];
  let lastText = "";
  for (const event of events) {
    const item = event.data?.item;
    if (!item) continue;
    if (event.type === "item/started" && item.type !== "userMessage") {
      if (!open) { rounds++; open = true; }
      if (TOOL_TYPES.has(item.type)) tools.push(toolName(item));
    }
    if (event.type === "item/completed" && TOOL_TYPES.has(item.type)) open = false;
    if (event.type === "item/completed" && item.type === "agentMessage" && item.text) lastText = item.text;
  }
  return { rounds, tools, lastText };
}

// ---- one run ----
async function runOnce(n) {
  const recording = RECORD ? startRecording() : null;
  const t0 = Date.now();
  const { threadId } = await pluginRpc("studio-visual-chat", "canvas.create", { text: PROMPT, providerId: PROVIDER, model: MODEL });
  log(`run ${n}: canvas thread ${threadId}`);
  frameHandle = null;
  await tab.navigate(`/plugins/studio-visual-chat/canvas/${threadId}`);
  await tab.waitForSelector("[data-canvas-page]", 30_000).catch(() => {});
  await collapseSidebar();
  const at = () => Date.now() - t0;
  const marks = { firstContent: null, firstCard: null, finalPage: null, captionShown: null, total: null };
  let sawWorking = false;
  let canvas = null;
  let samples = 0;
  const stills = {};
  const midShots = [];
  let shooting = false;
  const shoot = async () => Buffer.from((await tab.command("Page.captureScreenshot", { format: "png" })).data, "base64");
  for (;;) {
    const [view, outer, frame] = await Promise.all([
      pluginRpc("studio-visual-chat", "canvas.get", { threadId }).then((result) => result.canvas).catch(() => null),
      tab.poll(OUTER_PROBE).catch(() => null),
      frameEval(FRAME_PROBE),
    ]);
    samples++;
    const now = at();
    if (view) canvas = view;
    if (canvas?.status === "working") sawWorking = true;
    if (canvas?.status === "failed") throw new Error(`run ${n}: the canvas turn failed`);
    const idle = canvas?.status === "idle" && (sawWorking || (canvas.turn >= 1 && canvas.history.at(-1)?.role === "agent"));
    if (idle && marks.total === null) marks.total = now;
    if (frame?.root && frame.content > 0 && marks.firstContent === null) { marks.firstContent = now; log(`run ${n}: firstContent ${now} ms`); }
    if (frame?.root && frame.realCards > 0 && marks.firstCard === null) { marks.firstCard = now; log(`run ${n}: firstCard ${now} ms`); }
    if (marks.finalPage === null && frame?.root && frame.rev != null && Number(frame.rev) > 0 && !frame.streaming && frame.pending === 0 && frame.content > 0) { marks.finalPage = now; log(`run ${n}: finalPage ${now} ms (rev ${frame.rev})`); }
    if (marks.captionShown === null && outer?.caption) { marks.captionShown = now; log(`run ${n}: captionShown ${now} ms`); }
    if (STILLS && marks.firstContent !== null && !shooting) {
      // Early still at firstContent + 1.5 s; screenshots every ~2 s after it, to pick the middle one later.
      const due = !stills.early ? now >= marks.firstContent + 1500 : marks.finalPage === null && now - (midShots.at(-1)?.at ?? 0) >= 2000;
      if (due) {
        shooting = true;
        shoot().then((png) => { if (!stills.early) stills.early = { at: now, png }; else midShots.push({ at: now, png }); }).catch(() => {}).finally(() => { shooting = false; });
      }
    }
    if (marks.finalPage !== null && marks.total !== null && (marks.captionShown !== null || now > marks.total + 5000)) break;
    if (now > TURN_MS) throw new Error(`run ${n}: timed out after ${TURN_MS} ms; status ${canvas?.status}, rev ${canvas?.rev}, outer ${JSON.stringify(outer)}, frame ${JSON.stringify(frame)?.slice(0, 300)}`);
    await sleep(Math.max(0, SAMPLE_MS - (at() - now)));
  }
  // Settle: no animation in the page or its frame, every picture loaded, then a beat.
  const settleStart = Date.now();
  let lastFrame = null;
  while (Date.now() - settleStart < SETTLE_MS) {
    const [outer, frame] = await Promise.all([tab.poll(OUTER_PROBE).catch(() => null), frameEval(FRAME_PROBE)]);
    lastFrame = frame;
    if (outer && outer.running === 0 && (!frame || (frame.running === 0 && frame.loading === 0))) break;
    await sleep(250);
  }
  await sleep(1500);
  const settled = at();
  const finalFrame = await frameEval(FRAME_PROBE) ?? lastFrame;
  while (shooting) await sleep(50);

  if (STILLS) {
    const prefix = join(STILLS, `run-${n}`);
    if (stills.early) await writeFile(`${prefix}-early.png`, stills.early.png);
    if (marks.firstContent !== null && marks.finalPage !== null) {
      const middle = (marks.firstContent + marks.finalPage) / 2;
      const pickMid = [...midShots, ...(stills.early ? [stills.early] : [])].sort((a, b) => Math.abs(a.at - middle) - Math.abs(b.at - middle))[0];
      if (pickMid) await writeFile(`${prefix}-middle.png`, pickMid.png);
      stills.middleAt = pickMid?.at ?? null;
    }
    await tab.capture(`${prefix}-final.png`);
    if (DARK) {
      await tab.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
      await sleep(2500);
      await tab.capture(`${prefix}-final-dark.png`);
      await tab.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
      await sleep(1000);
    }
    log(`run ${n}: stills in ${STILLS}`);
  }
  if (recording) {
    const file = RUNS > 1 ? join(dirname(RECORD), `${basename(RECORD, extname(RECORD))}-run${n}${extname(RECORD) || ".mp4"}`) : RECORD;
    await recording.stop(file);
  }

  const events = await threadEvents(threadId).catch((error) => { log(`run ${n}: events failed: ${error.message}`); return []; });
  await writeFile(join(OUT, `events-run-${n}.json`), JSON.stringify(events, null, 2));
  const { rounds: roundsEvents, tools, lastText } = countRounds(events);
  let exact = await transcriptRounds(events).catch(() => null);
  if (!exact?.rounds) { await sleep(2000); exact = await transcriptRounds(events).catch(() => null); }
  const rounds = exact?.rounds || roundsEvents;
  let reply = lastText;
  if (!reply) reply = (JSON.parse(await bbCli(["thread", "output", threadId, "--json"]).catch(() => "{}")).output ?? "");
  return {
    run: n, threadId, ...marks, settled, samples, rounds, roundsSource: exact?.rounds ? "transcript" : "events", roundsEvents, tools,
    streamed: reply.includes("```html"), caption: canvas?.caption ?? null, rev: canvas?.rev ?? null,
    look: canvas?.look ?? null, cards: finalFrame?.cards ?? null, realCards: finalFrame?.realCards ?? null,
    middleStillAt: stills.middleAt ?? null,
  };
}

const median = (values) => {
  const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const results = [];
const failures = [];
try {
  for (let n = 1; n <= RUNS; n++) {
    try {
      const result = await runOnce(n);
      results.push(result);
      log(`run ${n}: ${JSON.stringify({ ...result, caption: undefined })}`);
    } catch (error) {
      failures.push({ run: n, error: String(error?.message ?? error) });
      log(`run ${n} failed: ${error?.message ?? error}`);
    }
    await writeFile(join(OUT, "results.json"), JSON.stringify({ prompt: PROMPT, provider: PROVIDER, model: MODEL, results, failures }, null, 2));
  }
  const columns = ["firstContent", "firstCard", "finalPage", "captionShown", "total", "rounds", "roundsEvents"];
  const medians = Object.fromEntries(columns.map((column) => [column, median(results.map((result) => result[column]))]));
  await writeFile(join(OUT, "results.json"), JSON.stringify({ prompt: PROMPT, provider: PROVIDER, model: MODEL, results, failures, median: medians }, null, 2));
  const cell = (value) => String(value ?? "-").padStart(14);
  console.log(`\n${"run".padEnd(8)}${columns.map(cell).join("")}  streamed  tools`);
  for (const result of results) console.log(`${String(result.run).padEnd(8)}${columns.map((column) => cell(result[column])).join("")}  ${String(result.streamed).padEnd(8)}  ${result.tools.join(" ")}`);
  console.log(`${"median".padEnd(8)}${columns.map((column) => cell(medians[column])).join("")}`);
  if (failures.length) console.log(`\nfailed runs: ${failures.map((failure) => `${failure.run} (${failure.error})`).join("; ")}`);
  console.log(`\n${join(OUT, "results.json")}`);
} finally {
  tab.socket?.close();
  if (chrome) {
    const exited = new Promise((resolvePromise) => chrome.once("exit", resolvePromise));
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  void cdpPort;
}
