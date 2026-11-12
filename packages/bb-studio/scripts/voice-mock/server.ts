// A scripted stand-in for OpenAI's GPT-Live, with Studio's real voice tool
// layer behind it, for simulators and staged BBs: no key, no OpenAI.
//
//   ../../node_modules/.bin/tsx scripts/voice-mock/server.ts [--port 8790] [--out <dir>]
//
// - POST /api/v1/plugins/studio/rpc/voiceLive.* runs src/voice/live (VoiceLive,
//   its eyes-free rules and the cap) on an in-memory database, with fake
//   threads, a fake Larkspur lead that answers 2.5 s after a send, and todos.
//   Inputs go through the real contract's schemas, as BB's RPC layer would.
// - ws://127.0.0.1:<port>/live speaks GPT-Live's events (session.*, tools in
//   response.event) plus mock.audio.delta: the voice's words as 24 kHz PCM16,
//   made with macOS `say`, streamed in real time. It plays the user's side
//   too (input transcript deltas), including a barge-in.
// - It writes timings.json and voice-thread.md (what the voice thread got) to --out.
// - `desktop` and `canvas` script a staged BB's own Studio instead (the panel
//   calls its real voiceLive.tool); `canvas` edits the launching canvas's board.
//
// The iOS app: -qaVoiceLive script -qaVoiceLiveStudio http://127.0.0.1:8790 -qaVoiceLiveAutostart
//
// --live (staged only, with OPENAI_API_KEY in the environment): instead of the
// script, the app's socket is bridged to the real GPT-Live over its WebSocket
// transport, opened here on the host with the key. The user's side is macOS
// `say` speech streamed as the mic (a simulator mic would mean a macOS mic
// prompt), and the bridge measures turn and barge-in latency and writes
// live-audio.wav (both sides on one timeline) and live-timings.json.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../../src/migrations";
import { voiceLiveContract } from "../../src/voice/live/contract";
import { VoiceLive, type VoiceLoop } from "../../src/voice/live/live";
import { buildSeed, gatherSeed, type SeedSources } from "../../src/voice/live/identity";
import { liveSessionRequest } from "../../src/voice/live/session";
import { resolveTarget } from "../../src/voice/live/targets";

const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
};
const PORT = Number(arg("--port", "8790"));
const OUT = arg("--out", mkdtempSync(join(tmpdir(), "voice-mock-")));
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
const say = (...parts: unknown[]) => console.log(stamp(), ...parts);

// ---------------------------------------------------------------------------
// Studio's tool layer, with fake BB around it
// ---------------------------------------------------------------------------

const db = new Database(":memory:");
db.exec(MIGRATIONS.find((statement) => statement.includes("CREATE TABLE voice_calls"))!);
const COS = { name: "Dot", threadId: "thr_cos" };
const THREADS = [{ id: "thr_cos", title: "Dot" }, { id: "thr_larkspur", title: "Larkspur lead" }, { id: "thr_launch", title: "Launch review" }];
const LEADS = [{ project: "Larkspur", threadId: "thr_larkspur" }];
const loops = new Map<string, VoiceLoop>([
  ["loop_dana", { id: "loop_dana", title: "Reply to Dana about the pricing deck", kind: "do", status: "surfaced", priority: "urgent", due: null, trigger: { type: "none" } }],
  ["loop_domain", { id: "loop_domain", title: "Renew bbstudio.app before Friday", kind: "do", status: "surfaced", priority: "normal", due: null, trigger: { type: "none" } }],
  ["loop_car", { id: "loop_car", title: "Book the car service", kind: "do", status: "queued", priority: "normal", due: null, trigger: { type: "none" } }],
  ["loop_ts", { id: "loop_ts", title: "Remove the stale Tailscale node", kind: "do", status: "queued", priority: "low", due: null, trigger: { type: "none" } }],
]);
/** The seed's sources (identity.ts), faked: the CoS with a Memory page and recent chat, and the Larkspur lead. */
const SEED_SOURCES: SeedSources = {
  bots: () => [{ name: COS.name, role: "Keeps Patrick's week on track and chases what's waiting.", threadId: COS.threadId, memoryPageId: "pg_memory", primary: true }],
  memory: () => "## Check-in\n- Look at the inbox\n\n## Memory\n- Patrick drives to Larkspur on Tuesdays.\n- The eBay fetcher runs nightly; Larkspur's lead owns it.",
  leadOf: (threadId) => LEADS.find((lead) => lead.threadId === threadId)?.project ?? null,
  runnerOf: () => null,
  thread: async (threadId) => { const thread = THREADS.find((each) => each.id === threadId); return thread ? { title: thread.title, project: LEADS.find((lead) => lead.threadId === threadId)?.project ?? null } : null; },
  recent: async (threadId) => threadId === COS.threadId
    ? [{ role: "user", text: "What's on for tomorrow?" }, { role: "assistant", text: "The domain renewal is due Friday, and the Larkspur lead is pausing the eBay fetcher." }]
    : [{ role: "assistant", text: "The eBay fetcher hit a rate limit last night; I'll retry at 9." }],
  loops: () => ({ needsYouNow: [...loops.values()].filter((loop) => loop.status === "surfaced").map((loop) => loop.title), comingUp: [...loops.values()].filter((loop) => loop.status === "queued").map((loop) => loop.title) }),
};

const voiceThread: string[] = [];
const timings: Record<string, number[]> = {};
const time = (name: string, ms: number) => (timings[name] ??= []).push(Math.round(ms));

const live: VoiceLive = new VoiceLive({
  db,
  key: () => "",
  settings: () => ({ voiceLiveMonthlyCapUsd: 20, voiceLiveModel: "gpt-live-1" }),
  cos: () => COS,
  seed: (threadId) => gatherSeed(threadId, SEED_SOURCES),
  resolve: async (name) => resolveTarget(name, { cos: COS, leads: LEADS, threads: THREADS }),
  latestReply: async (threadId) => ({ title: THREADS.find((thread) => thread.id === threadId)?.title ?? threadId, text: "Paused the eBay fetcher. It resumes Monday at 9." }),
  loops: {
    groups: () => ({ needsYouNow: [...loops.values()].filter((loop) => loop.status === "surfaced"), comingUp: [...loops.values()].filter((loop) => loop.status === "queued" || loop.status === "snoozed") }),
    get: (id) => { const loop = loops.get(id); if (!loop) throw new Error("No such todo."); return loop; },
    act: async (id, action, options) => { const loop = { ...loops.get(id)!, status: action === "done" ? "done" : action === "drop" ? "dropped" : action === "snooze" ? "snoozed" : "in_progress", trigger: action === "snooze" ? { type: "time", preset: options?.snooze } : loops.get(id)!.trigger, owner: options?.owner ?? loops.get(id)!.owner }; loops.set(id, loop); say(`loop ${id} → ${loop.status}`); return loop; },
    add: async (text) => { const loop: VoiceLoop = { id: `loop_${loops.size + 1}`, title: text, kind: "do", status: "in_progress", priority: "normal", due: null, trigger: { type: "none" }, owner: "cos" }; loops.set(loop.id, loop); return loop; },
    restore: (id, before) => { const loop = { ...loops.get(id)!, ...before }; loops.set(id, loop); return loop; },
  },
  threads: { stop: async (threadId) => say(`stopped ${threadId}`), archive: async (threadId) => say(`archived ${threadId}`) },
  automations: { list: async () => [{ id: "auto_1", name: "Morning brief", state: "active" }], pause: async (id) => say(`paused ${id}`), remove: async (id) => say(`deleted ${id}`) },
  openThread: async ({ title, text }) => { voiceThread.push(`# ${title}`, "", text, ""); return "thr_voice_demo"; },
  send: async ({ threadId, text, senderThreadId }) => {
    const where = THREADS.find((thread) => thread.id === threadId)?.title ?? threadId;
    if (threadId === "thr_voice_demo") voiceThread.push(text, "");
    else say(`→ ${where} (from ${senderThreadId}): ${text}`);
    // The Larkspur lead finishes its turn a little later.
    if (threadId === "thr_larkspur") setTimeout(() => void live.idle("thr_larkspur", "**Paused** the eBay fetcher. It resumes Monday at 9."), 2500);
  },
  push: async () => {},
  publish: () => {},
  mockUrl: () => `ws://127.0.0.1:${PORT}/live`,
  warn: (message) => say("warn:", message),
});

type Handler = (input: never) => unknown;
const handlers: Record<string, Handler> = {
  "voiceLive.state": () => live.state(),
  "voiceLive.start": (input: { model?: "gpt-live-1"; sdp?: string; threadId?: string }) => live.start(input),
  "voiceLive.tool": async (input: { sessionId: string; name: string; args?: string; events?: never[] }) => {
    const started = performance.now();
    const output = await live.tool(input.sessionId, input.name, input.args, input.events);
    time("studioToolMs", performance.now() - started);
    say(`tool ${input.name} → ${output.slice(0, 120)}`);
    return { output };
  },
  "voiceLive.event": (input: { sessionId: string; events: never[] }) => live.record(input.sessionId, input.events),
  "voiceLive.poll": (input: { sessionId: string }) => live.poll(input.sessionId),
  "voiceLive.end": (input: { sessionId: string; events?: never[] }) => live.end(input.sessionId, input.events),
};

const body = (req: IncomingMessage) => new Promise<string>((resolve) => {
  let text = "";
  req.on("data", (chunk) => (text += chunk));
  req.on("end", () => resolve(text));
});

// ---------------------------------------------------------------------------
// A minimal WebSocket (RFC 6455): text frames, close and ping
// ---------------------------------------------------------------------------

function frame(text: string): Buffer {
  const payload = Buffer.from(text);
  const head = payload.length < 126 ? Buffer.from([0x81, payload.length])
    : payload.length < 65_536 ? Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
    : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(payload.length)); return b; })()]);
  return Buffer.concat([head, payload]);
}

function frames(socket: Duplex, onText: (text: string) => void, onClose: () => void) {
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0]! & 0x0f;
      let length = buffer[1]! & 0x7f;
      let offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      const masked = (buffer[1]! & 0x80) !== 0;
      const total = offset + (masked ? 4 : 0) + length;
      if (buffer.length < total) return;
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      const data = Buffer.from(buffer.subarray(offset + (masked ? 4 : 0), total));
      if (mask) for (let i = 0; i < data.length; i++) data[i]! ^= mask[i % 4]!;
      buffer = buffer.subarray(total);
      if (opcode === 1) onText(data.toString());
      else if (opcode === 8) { socket.end(); onClose(); return; }
      else if (opcode === 9) socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data]));
    }
  });
  socket.on("close", onClose);
}

// ---------------------------------------------------------------------------
// The script: one drive's worth of turns
// ---------------------------------------------------------------------------

type Step =
  | { user: string }
  | { tool: string; args: Record<string, unknown> }
  | { say: string; bargeIn?: { afterMs: number; text: string } }
  | { sayReadBack: true }
  | { waitNote: true }
  | { close: true };

/**
 * --script desktop: for a staged BB's own Studio (the panel calls the real
 * voiceLive.tool), so it names the staged data: the seeded ORBIT thread
 * "Review the launch checklist", and todos found by title in todos_list's output.
 */
const DESKTOP_SCRIPT: Step[] = [
  { user: "What's waiting on me?" },
  { tool: "todos_list", args: {} },
  { say: "Two things need you: reply to Dana about the pricing deck, and renew the domain before Friday." },
  { user: "Tell the launch checklist thread to flag anything blocking Friday." },
  { tool: "send_to_thread", args: { target: "launch checklist", message: "Flag anything blocking Friday's release" } },
  { say: "Sent to the launch checklist." },
  { user: "Drop the Tailscale node one." },
  { tool: "todos_act", args: { loop_id: "$loop:Tailscale", action: "drop" } },
  { sayReadBack: true },
  { user: "Yes, drop it." },
  { tool: "confirm", args: { action_id: "$draft" } },
  { say: "Dropped it." },
  { say: "Anything else? I can read you what's coming up next: booking the car service, and the release window on Friday afternoon.", bargeIn: { afterMs: 2600, text: "No, that's all, thanks." } },
  { say: "Okay. Talk soon." },
  { close: true },
];

/**
 * --script canvas: a session launched from a canvas thread (the Canvas plugin) in a
 * staged BB. The voice edits the board while it talks: each tool call is the
 * Canvas plugin's real canvas tool (via Studio's voice), on the launching canvas. Its numbers are
 * the script's own, so the items say "sample data".
 */
const CANVAS_SCRIPT: Step[] = [
  { user: "What about Saturday, hour by hour?" },
  { tool: "canvas_add", args: { items: [{ id: "voice-saturday-hourly", kind: "line", title: "Saturday hour by hour, °F (voice demo, sample data)", size: "l", importance: 5, data: [{ hour: "8a", temp: 47 }, { hour: "10a", temp: 52 }, { hour: "12p", temp: 57 }, { hour: "2p", temp: 60 }, { hour: "4p", temp: 59 }, { hour: "6p", temp: 54 }, { hour: "8p", temp: 50 }], options: { x: "hour", series: ["temp"], unit: "°" } }] } },
  { say: "Saturday starts in the high forties, warms to about sixty by mid-afternoon, then cools off after sunset." },
  { user: "And should I bring an umbrella on Sunday?" },
  { tool: "canvas_add", args: { items: [{ id: "voice-sunday-rain", kind: "progress", title: "Sunday rain chance (voice demo, sample data)", size: "m", importance: 5, data: { value: 20, max: 100, label: "Chance of rain" }, options: { style: "gauge", unit: "%" } }] } },
  { say: "Only about a one in five chance of rain on Sunday." },
  { tool: "canvas_update", args: { items: [{ id: "voice-saturday-hourly", importance: 3, size: "m" }] } },
  { say: "So you can probably leave the umbrella at home." },
  { close: true },
];

const SCRIPT: Step[] = [
  { user: "What's waiting on me?" },
  { tool: "todos_list", args: {} },
  { say: "Two things need you: reply to Dana about the pricing deck, and renew the domain before Friday." },
  { user: "Snooze the domain one to tonight." },
  { tool: "todos_act", args: { loop_id: "loop_domain", action: "snooze", snooze: "tonight" } },
  { say: "Snoozed the domain renewal to tonight. Say undo in the next ten seconds if that's wrong." },
  // A relay goes at once: no read-back.
  { user: "Tell the Larkspur lead to pause the eBay fetcher until Monday." },
  { tool: "send_to_thread", args: { target: "the Larkspur lead", message: "Pause the eBay fetcher until Monday" } },
  { say: "Sent to the Larkspur lead." },
  // Destructive: the only thing that waits for a yes.
  { user: "Drop the Tailscale node one." },
  { tool: "todos_act", args: { loop_id: "loop_ts", action: "drop" } },
  { sayReadBack: true },
  { user: "Yes, drop it." },
  { tool: "confirm", args: { action_id: "$draft" } },
  { say: "Dropped it." },
  { waitNote: true },
  { say: "The Larkspur lead says the eBay fetcher is paused, and it picks up again Monday at nine. Anything else on Larkspur while I have you?", bargeIn: { afterMs: 2600, text: "No, that's all, thanks." } },
  { say: "Okay. Talk soon." },
  { close: true },
];

const audioDir = mkdtempSync(join(tmpdir(), "voice-mock-audio-"));
/** The words as 24 kHz mono PCM16, from macOS `say`. */
function speech(text: string): Buffer {
  const file = join(audioDir, `${createHash("sha1").update(text).digest("hex").slice(0, 12)}.wav`);
  execFileSync("say", ["-o", file, "--file-format=WAVE", "--data-format=LEI16@24000", text]);
  const wav = readFileSync(file);
  const data = wav.indexOf("data");
  return wav.subarray(data + 8);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function runScript(socket: Duplex) {
  const send = (event: Record<string, unknown>) => socket.write(frame(JSON.stringify(event)));
  let closed = false;
  let lastOutput = "";
  let loopsOutput = "";
  let draft = "";
  let pendingTool: { callId: string; at: number; resolve: (output: string) => void } | null = null;
  let noteWaiter: (() => void) | null = null;
  let cutOff: { at: number; resolve: () => void } | null = null;
  const sessionStarted = Date.now();

  frames(socket, (text) => {
    const event = JSON.parse(text) as { type: string; item?: { call_id?: string; output?: string }; content?: string };
    if (event.type === "response.item.create" && pendingTool && event.item?.call_id === pendingTool.callId) {
      time("toolRoundTripMs", Date.now() - pendingTool.at);
      pendingTool.resolve(event.item.output ?? "");
      pendingTool = null;
    } else if (event.type === "session.commentary.append") {
      say("note (spoken):", event.content?.slice(0, 100));
      noteWaiter?.();
    } else if (event.type === "session.thinking.append") {
      say("note (silent):", event.content?.slice(0, 120));
      if (cutOff && event.content?.includes("interrupted")) { time("bargeInNoteMs", Date.now() - cutOff.at); cutOff.resolve(); }
    } else if (event.type === "session.close") {
      send({ type: "session.closed", reason: "close_requested", usage: { seconds: (Date.now() - sessionStarted) / 1000 } });
      closed = true;
    }
  }, () => { closed = true; });

  const usage = setInterval(() => !closed && send({ type: "session.usage.updated", usage: { seconds: Math.round((Date.now() - sessionStarted) / 1000) } }), 4000);

  async function user(text: string) {
    const words = text.split(" ");
    for (const [index, word] of words.entries()) {
      send({ type: "session.input_transcript.delta", delta: (index ? " " : "") + word });
      await sleep(260);
    }
    await sleep(1300);
  }

  async function speak(text: string, bargeIn?: { afterMs: number; text: string }) {
    const pcm = speech(text);
    const chunk = 4800; // 100 ms
    const chunks = Math.ceil(pcm.length / chunk);
    const words = text.split(" ");
    let cut = false;
    send({ type: "mock.audio.started" });
    const started = Date.now();
    let barge: Promise<void> | null = null;
    for (let index = 0; index < chunks && !cut && !closed; index++) {
      const wordsDue = Math.ceil(((index + 1) / chunks) * words.length);
      const said = Math.ceil((index / chunks) * words.length);
      if (wordsDue > said || index === 0) send({ type: "session.output_transcript.delta", delta: words.slice(said, wordsDue).map((word, i) => (said + i ? " " : "") + word).join("") });
      send({ type: "mock.audio.delta", audio: pcm.subarray(index * chunk, (index + 1) * chunk).toString("base64") });
      if (bargeIn && !barge && Date.now() - started >= bargeIn.afterMs) {
        barge = new Promise<void>((resolve) => { cutOff = { at: Date.now(), resolve }; });
        void user(bargeIn.text);
        // The app should cut the voice off within a beat; the model stops its reply.
        await Promise.race([barge, sleep(1500)]);
        cut = true;
        break;
      }
      await sleep(100);
    }
    if (!cut) {
      send({ type: "mock.agent_line_done" });
      await sleep(150);
    }
    send({ type: "mock.audio.done" });
    if (cut) await sleep(2600);
    else await sleep(700);
  }

  async function tool(name: string, args: Record<string, unknown>) {
    const callId = `call_${Math.random().toString(36).slice(2, 10)}`;
    // "$loop:<title words>": the todo's id from the last todos_list.
    const resolved = JSON.stringify(args).replace("$draft", draft).replace(/\$loop:([^"]+)/, (_, words: string) => loopsOutput.match(new RegExp(`- [^\\n]*${words}[^\\n]*\\(id ([^,)]+)`, "i"))?.[1] ?? "unknown");
    const output = await new Promise<string>((resolve) => {
      pendingTool = { callId, at: Date.now(), resolve };
      send({ type: "response.event", delegation_id: "item_mock", event: { type: "response.output_item.done", item: { type: "function_call", call_id: callId, name, arguments: resolved } } });
    });
    lastOutput = output;
    if (name === "todos_list") loopsOutput = output;
    draft = output.match(/\(action (d_[a-f0-9]+)\)/)?.[1] ?? draft;
    // The backend's turn: a few hundred tokens.
    send({ type: "response.event", event: { type: "response.completed", response: { usage: { input_tokens: 900, output_tokens: 40, input_tokens_details: { cached_tokens: 700 } } } } });
    await sleep(350);
  }

  void (async () => {
    send({ type: "session.started" });
    await sleep(1500);
    for (const step of process.argv.includes("canvas") ? CANVAS_SCRIPT : process.argv.includes("desktop") ? DESKTOP_SCRIPT : SCRIPT) {
      if (closed) break;
      if ("user" in step) await user(step.user);
      else if ("tool" in step) await tool(step.tool, step.args);
      else if ("sayReadBack" in step) await speak(lastOutput.match(/Ask exactly this and wait: "([^"]+)"/)?.[1] ?? "Are you sure?");
      else if ("say" in step) await speak(step.say, step.bargeIn);
      else if ("waitNote" in step) await Promise.race([new Promise<void>((resolve) => (noteWaiter = resolve)), sleep(15_000)]);
      else if ("close" in step) {
        send({ type: "session.closed", reason: "remote_hangup", usage: { seconds: Math.round((Date.now() - sessionStarted) / 1000) } });
        closed = true;
      }
    }
    clearInterval(usage);
    writeFileSync(join(OUT, "timings.json"), JSON.stringify(timings, null, 2));
    say("script done; timings", JSON.stringify(timings));
    setTimeout(() => { writeFileSync(join(OUT, "voice-thread.md"), voiceThread.join("\n")); say("voice thread saved"); }, 1500);
  })();
}

// ---------------------------------------------------------------------------
// --live: the app's socket bridged to the real GPT-Live (WebSocket transport)
// ---------------------------------------------------------------------------

const RATE = 24_000;
const CHUNK = 4800; // 100 ms of PCM16

/** The loudest sample in a chunk: GPT-Live streams silence too, so speech is what's loud. */
function peak(pcm: Buffer): number {
  let max = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) max = Math.max(max, Math.abs(pcm.readInt16LE(i)));
  return max;
}

/** A chunk's RMS level, 0–1. */
function rms(pcm: Buffer): number {
  let sum = 0;
  const count = Math.floor(pcm.length / 2);
  for (let i = 0; i < count; i++) { const value = pcm.readInt16LE(i * 2) / 32768; sum += value * value; }
  return count ? Math.sqrt(sum / count) : 0;
}

/** Where speech starts in a clip: the first 10 ms above a small level. */
function onsetMs(pcm: Buffer): number {
  for (let at = 0; at + 480 <= pcm.length / 2; at += 240) {
    let peak = 0;
    for (let i = at; i < at + 240; i++) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i * 2)));
    if (peak > 1200) return Math.round((at / RATE) * 1000);
  }
  return 0;
}

function runLiveBridge(app: Duplex) {
  const key = process.env.OPENAI_API_KEY?.trim();
  const toApp = (event: Record<string, unknown>) => app.write(frame(JSON.stringify(event)));
  if (!key) { toApp({ type: "error", error: { message: "The live bridge has no OPENAI_API_KEY." } }); return; }
  const t0 = Date.now();
  const now = () => Date.now() - t0;
  const openai = new WebSocket("wss://api.openai.com/v1/live/sessions", { headers: { Authorization: `Bearer ${key}` } } as never);
  const toOpenAI = (event: Record<string, unknown>) => openai.readyState === WebSocket.OPEN && openai.send(JSON.stringify(event));
  // Both sides on one timeline, for the recording's sound.
  const track: { at: number; pcm: Buffer }[] = [];
  const toolCalls = new Map<string, number>();
  let closed = false;
  // The app plays the voice in order; this is when its queued audio ends.
  let playbackEnd = 0;
  let agentSpeaking = false;
  /** When the voice's last loud audio ends, and when it last arrived. */
  let voiceUntil = 0;
  let lastVoiced = 0;
  /** The app has the voice muted (mock.muted / mock.unmuted): by the level gate, or a confirmed barge-in. */
  let appMuted = false;
  let mutes = 0;
  let falseTriggers = 0;
  let confirmedSinceMute = false;
  /** The voice's playback level now (RMS 0–1), for the mic's simulated echo. */
  let playbackLevel = 0;
  let playbackLevelAt = 0;
  let lastFirstInputDelta = 0;
  let readBack = false;
  let commentary = false;
  let utterance: { pcm: Buffer; offset: number; startedAt: number; onset: number; resolve: () => void } | null = null;
  const utterances: { text: string; startedAt: number; wordAt: number; endedAt: number; firstInputDelta?: number; firstAgentAudio?: number }[] = [];
  type Barge = { wordAt: number; firstInputDelta?: number; muted?: number; confirmed?: number; serverAudioStopped?: number };
  let barge: Barge | null = null;
  let bargeVoiceStarted = 0;
  const barges: Barge[] = [];
  /** Words the voice has said since the last tool result: the answer itself, not its "Checking…". */
  let answerWords = 0;
  const types: Record<string, number> = {};

  openai.onopen = () => {
    say("live: connected to GPT-Live");
    const seed = buildSeed({ kind: "cos", name: COS.name, threadId: COS.threadId, role: null, recent: null });
    toOpenAI({ type: "session.start", session: liveSessionRequest({ persona: { identity: seed.identity, seed: seed.text, cosName: COS.name }, sdp: "" }).session });
  };
  openai.onerror = () => say("live: socket error");
  openai.onclose = (event) => { say(`live: GPT-Live socket closed (${event.code} ${event.reason})`); if (!closed) toApp({ type: "session.closed", reason: "connection_lost" }); closed = true; };
  openai.onmessage = (message) => {
    const event = JSON.parse(String(message.data)) as Record<string, unknown> & { type: string };
    types[event.type] = (types[event.type] ?? 0) + 1;
    const at = now();
    // Every event but audio, for checking GPT-Live's real shapes against the docs.
    if (event.type !== "session.output_audio.delta") appendFileSync(join(OUT, "live-events.jsonl"), `${JSON.stringify({ at, ...event }).slice(0, 2000)}\n`);
    if (event.type === "session.output_audio.delta") {
      const pcm = Buffer.from(String(event.delta), "base64");
      // After the user cut in: note when GPT-Live itself stops sending the voice.
      if (barge?.muted !== undefined && peak(pcm) >= 800) barge.serverAudioStopped = at;
      const start = Math.max(at, playbackEnd);
      playbackEnd = start + (pcm.length / 2 / RATE) * 1000;
      // The app drops the voice while it's muted, so the recording does too.
      if (!appMuted) {
        track.push({ at: start, pcm });
        playbackLevel = rms(pcm);
        playbackLevelAt = at;
      }
      toApp({ type: "mock.audio.delta", audio: event.delta });
      if (peak(pcm) < 800) return;
      voiceUntil = playbackEnd;
      lastVoiced = at;
      if (!agentSpeaking) {
        agentSpeaking = true;
        const last = utterances.at(-1);
        if (last && last.firstAgentAudio === undefined && last.endedAt && at > last.endedAt) last.firstAgentAudio = at;
        toApp({ type: "mock.audio.started" });
      }
      return;
    }
    if (event.type === "session.output_transcript.delta") answerWords += String(event.delta ?? "").trim().split(/\s+/).filter(Boolean).length;
    if (event.type === "session.input_transcript.delta") {
      const last = utterances.at(-1);
      if (last && last.firstInputDelta === undefined && at >= last.startedAt) { last.firstInputDelta = at; lastFirstInputDelta = at; }
      if (barge && barge.firstInputDelta === undefined) barge.firstInputDelta = at;
    }
    const call = (event.event as { type?: string; item?: { type?: string; call_id?: string; name?: string } } | undefined);
    if (event.type === "response.event" && call?.type === "response.output_item.done" && call.item?.type === "function_call" && call.item.call_id) {
      toolCalls.set(call.item.call_id, at);
      say(`live: tool call ${call.item.name}`);
    }
    if (event.type === "error") say("live: error", JSON.stringify(event).slice(0, 300));
    if (event.type === "session.started") { say("live: session started"); startMic(); void script(); }
    if (event.type === "session.closed") { closed = true; say("live: closed", JSON.stringify(event).slice(0, 200)); finish(); }
    toApp(event);
  };

  app.on("error", (error) => say("live: app socket error", String(error)));
  frames(app, (text) => {
    const event = JSON.parse(text) as { type: string; content?: string; item?: { output?: string; call_id?: string } };
    const at = now();
    const asked = event.item?.call_id ? toolCalls.get(event.item.call_id) : undefined;
    if (event.type === "response.item.create" && asked !== undefined) { time("toolRoundTripMs", at - asked); answerWords = 0; }
    if (event.type === "mock.muted") {
      appMuted = true;
      mutes++;
      confirmedSinceMute = false;
      if (barge && barge.muted === undefined && at >= barge.wordAt - 200) barge.muted = at;
      say("live: app muted the voice");
      return;
    }
    if (event.type === "mock.unmuted") {
      appMuted = false;
      if (!confirmedSinceMute) { falseTriggers++; say("live: app unmuted the voice (no words: a false trigger)"); }
      return;
    }
    if (event.type === "session.thinking.append" && event.content?.includes("interrupted")) {
      // Words confirmed the barge-in.
      confirmedSinceMute = true;
      if (barge && barge.confirmed === undefined) barge.confirmed = at;
      say("live: barge-in confirmed by the transcript");
    }
    if (event.type === "response.item.create" && event.item?.output?.includes("Ask exactly this and wait")) readBack = true;
    if (event.type === "session.commentary.append") commentary = true;
    if (["response.item.create", "response.create", "session.commentary.append", "session.thinking.append", "session.instructions.append", "session.close"].includes(event.type)) toOpenAI(event as never);
  }, () => { if (!closed) toOpenAI({ type: "session.close" }); closed = true; });

  let mic: NodeJS.Timeout | undefined;
  function startMic() {
    // A mic never stops: speech when the script talks, silence otherwise.
    mic = setInterval(() => {
      if (closed) return clearInterval(mic);
      let chunk = Buffer.alloc(CHUNK);
      if (utterance) {
        chunk = Buffer.from(utterance.pcm.subarray(utterance.offset, utterance.offset + CHUNK));
        if (chunk.length < CHUNK) chunk = Buffer.concat([chunk, Buffer.alloc(CHUNK - chunk.length)]);
        utterance.offset += CHUNK;
        if (utterance.offset >= utterance.pcm.length) { const done = utterance.resolve; utterance = null; done(); }
      }
      track.push({ at: now(), pcm: chunk });
      toOpenAI({ type: "session.input_audio.append", audio: chunk.toString("base64") });
      // What the phone's mic would read: the user, plus what's left of the voice's echo after
      // echo cancellation (35% of its level), in five 20 ms frames.
      const playing = !appMuted && now() - playbackLevelAt < 200 ? playbackLevel : 0;
      const levels = [0, 1, 2, 3, 4].map((frame) => {
        const user = rms(chunk.subarray(frame * 960, (frame + 1) * 960));
        return Number(Math.sqrt(user * user + (0.35 * playing) ** 2).toFixed(4));
      });
      toApp({ type: "mock.levels", mic: levels, playback: Number(playing.toFixed(4)) });
    }, 100);
  }

  // GPT-Live pauses up to ~0.7 s between phrases of one reply.
  const quiet = () => !agentSpeaking || now() > voiceUntil + 900;
  setInterval(() => { if (agentSpeaking && now() > voiceUntil + 900) { agentSpeaking = false; toApp({ type: "mock.audio.done" }); } }, 100);

  async function utter(text: string) {
    const pcm = speech(text);
    const startedAt = now();
    const onset = onsetMs(pcm);
    const record: (typeof utterances)[number] = { text, startedAt, wordAt: startedAt + onset, endedAt: 0 };
    utterances.push(record);
    if (barge && Number.isNaN(barge.wordAt)) barge.wordAt = record.wordAt;
    say(`live: user says "${text}"`);
    await new Promise<void>((resolve) => { utterance = { pcm, offset: 0, startedAt, onset, resolve }; });
    record.endedAt = now();
    return record;
  }

  async function until(check: () => boolean, ms: number) {
    const end = Date.now() + ms;
    while (!check() && Date.now() < end && !closed) await sleep(50);
    return check();
  }

  /** The voice answered what the user just said, and has finished. */
  async function turn(ms = 30_000) {
    const last = utterances.at(-1)!;
    await until(() => last.firstAgentAudio !== undefined, ms);
    await sleep(300);
    // Quiet for 1.5 s: the turn (and any tool call in it) is over.
    let quietSince = 0;
    await until(() => { if (!quiet()) { quietSince = 0; return false; } quietSince ||= Date.now(); return Date.now() - quietSince > 1500; }, ms);
  }

  /** The voice has been quiet for `ms`. */
  async function quietFor(ms: number, timeout: number) {
    let since = 0;
    await until(() => { if (!quiet()) { since = 0; return false; } since ||= Date.now(); return Date.now() - since > ms; }, timeout);
  }

  async function script() {
    await sleep(1500);
    await utter("What's waiting on me?");
    await turn();
    // A relay goes at once, no read-back.
    await utter("Tell the Larkspur lead to pause the eBay fetcher until Monday.");
    await turn();
    // Destructive: waits for a spoken yes.
    await utter("Drop the todo about the stale Tailscale node.");
    await turn();
    if (!(await until(() => readBack, 2000))) say("live: no question seen yet");
    await utter("Yes, drop it.");
    await turn();
    // The lead answers (2.5 s), the app picks it up (poll) and the voice says it.
    if (!(await until(() => commentary, 25_000))) say("live: the reply never reached the voice");
    await quietFor(2500, 20_000);
    // Barge-ins: ask for a long answer, and cut in once the voice is well into it. Twice.
    const rounds: [string, string][] = [
      ["Read me everything that's coming up, one at a time, with all the details.", "Okay, stop there. That's enough."],
      ["Now tell me about the Dana reply in detail: what she asked and what I should say.", "Stop. Thanks, that's all."],
    ];
    for (const [question, cut] of rounds) {
      await utter(question);
      answerWords = 0;
      // Cut in once the voice is well into its answer (after any tool call), mid-sentence.
      await until(() => answerWords >= 8 && agentSpeaking, 30_000);
      if (!agentSpeaking) { say("live: the voice wasn't talking when the barge-in was due"); continue; }
      // The first word's time comes from the utterance itself (utter sets it).
      const round: Barge = { wordAt: Number.NaN };
      barge = round;
      barges.push(round);
      await utter(cut);
      await turn(15_000);
      await quietFor(1500, 10_000);
    }
    toOpenAI({ type: "session.close" });
    await until(() => closed, 8000);
    finish();
  }

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(mic);
    const total = Math.max(...track.map((part) => part.at + (part.pcm.length / 2 / RATE) * 1000), 0);
    const mix = new Int32Array(Math.ceil((total / 1000) * RATE) + 1);
    for (const part of track) {
      const start = Math.round((part.at / 1000) * RATE);
      for (let i = 0; i < part.pcm.length / 2 && start + i < mix.length; i++) mix[start + i] += part.pcm.readInt16LE(i * 2);
    }
    const pcm = Buffer.alloc(mix.length * 2);
    mix.forEach((value, i) => pcm.writeInt16LE(Math.max(-32768, Math.min(32767, value)), i * 2));
    const header = Buffer.alloc(44);
    header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28);
    header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
    writeFileSync(join(OUT, "live-audio.wav"), Buffer.concat([header, pcm]));
    const turns = utterances.map((each) => ({
      user: each.text,
      firstWordToFirstTranscriptMs: each.firstInputDelta === undefined ? null : each.firstInputDelta - each.wordAt,
      endOfSpeechToFirstAudioMs: each.firstAgentAudio === undefined ? null : each.firstAgentAudio - each.endedAt,
    }));
    void bargeVoiceStarted;
    const bargeIn = barges.map((each) => ({
      firstWordToTranscriptMs: each.firstInputDelta === undefined ? null : each.firstInputDelta - each.wordAt,
      firstWordToVoiceMutedMs: each.muted === undefined ? null : each.muted - each.wordAt,
      firstWordToConfirmedMs: each.confirmed === undefined ? null : each.confirmed - each.wordAt,
      firstWordToServerStoppedMs: each.serverAudioStopped === undefined ? null : each.serverAudioStopped - each.wordAt,
    }));
    void lastVoiced;
    const result = { t0Epoch: t0, turns, bargeIn, mutes, falseTriggers, toolRoundTripMs: timings.toolRoundTripMs ?? [], studioToolMs: timings.studioToolMs ?? [], events: types, lastFirstInputDelta };
    writeFileSync(join(OUT, "live-timings.json"), JSON.stringify(result, null, 2));
    say("live: done", JSON.stringify({ turns, bargeIn }));
    setTimeout(() => { writeFileSync(join(OUT, "voice-thread.md"), voiceThread.join("\n")); say("voice thread saved"); }, 2000);
  }
}

// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const method = req.url?.match(/^\/api\/v1\/plugins\/studio\/rpc\/(voiceLive\.[a-z]+)$/i)?.[1];
  const handler = method ? handlers[method] : undefined;
  if (req.method !== "POST" || !method || !handler) { res.writeHead(404).end(JSON.stringify({ ok: false, error: { message: "not found" } })); return; }
  try {
    const raw = await body(req);
    const contract = voiceLiveContract[method as keyof typeof voiceLiveContract];
    const input = contract.input.parse(raw ? JSON.parse(raw) : {});
    const result = contract.output.parse(await handler(input as never));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, result }));
  } catch (error) {
    say(`rpc ${method} failed:`, String(error).slice(0, 300));
    res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: { message: error instanceof Error ? error.message : String(error) } }));
  }
});

server.on("upgrade", (req: IncomingMessage, socket: Duplex) => {
  if (req.url !== "/live") { socket.destroy(); return; }
  const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  say("voice connected");
  if (process.argv.includes("--live")) runLiveBridge(socket);
  else runScript(socket);
});

server.listen(PORT, "127.0.0.1", () => say(`voice mock on http://127.0.0.1:${PORT} (out: ${OUT})`));
