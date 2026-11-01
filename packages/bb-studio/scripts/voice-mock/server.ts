// A scripted stand-in for OpenAI's GPT-Live, with Studio's real voice tool
// layer behind it, for simulators and staged BBs: no key, no OpenAI.
//
//   ../../node_modules/.bin/tsx scripts/voice-mock/server.ts [--port 8790] [--out <dir>]
//
// - POST /api/v1/plugins/studio/rpc/voiceLive.* runs src/voice/live (VoiceLive,
//   its eyes-free rules and the cap) on an in-memory database, with fake
//   threads, a fake Kensico lead that answers 2.5 s after a send, and loops.
//   Inputs go through the real contract's schemas, as BB's RPC layer would.
// - ws://127.0.0.1:<port>/live speaks GPT-Live's events (session.*, tools in
//   response.event) plus mock.audio.delta: the voice's words as 24 kHz PCM16,
//   made with macOS `say`, streamed in real time. It plays the user's side
//   too (input transcript deltas), including a barge-in.
// - It writes timings.json and voice-thread.md (what the voice thread got) to --out.
//
// The iOS app: -qaVoiceLive script -qaVoiceLiveStudio http://127.0.0.1:8790 -qaVoiceLiveAutostart
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../../src/migrations";
import { voiceLiveContract } from "../../src/voice/live/contract";
import { VoiceLive, type VoiceLoop } from "../../src/voice/live/live";
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
const THREADS = [{ id: "thr_cos", title: "Dot" }, { id: "thr_kensico", title: "Kensico lead" }, { id: "thr_launch", title: "Launch review" }];
const LEADS = [{ project: "Kensico", threadId: "thr_kensico" }];
const loops = new Map<string, VoiceLoop>([
  ["loop_dana", { id: "loop_dana", title: "Reply to Dana about the pricing deck", kind: "do", status: "surfaced", priority: "urgent", due: null, trigger: { type: "none" } }],
  ["loop_domain", { id: "loop_domain", title: "Renew bbstudio.app before Friday", kind: "do", status: "surfaced", priority: "normal", due: null, trigger: { type: "none" } }],
  ["loop_car", { id: "loop_car", title: "Book the car service", kind: "do", status: "queued", priority: "normal", due: null, trigger: { type: "none" } }],
]);
const voiceThread: string[] = [];
const timings: Record<string, number[]> = {};
const time = (name: string, ms: number) => (timings[name] ??= []).push(Math.round(ms));

const live: VoiceLive = new VoiceLive({
  db,
  key: () => "",
  settings: () => ({ voiceLiveMonthlyCapUsd: 20, voiceLiveModel: "gpt-live-1" }),
  cos: () => COS,
  resolve: async (name) => resolveTarget(name, { cos: COS, leads: LEADS, threads: THREADS }),
  latestReply: async (threadId) => ({ title: THREADS.find((thread) => thread.id === threadId)?.title ?? threadId, text: "Paused the eBay fetcher. It resumes Monday at 9." }),
  loops: {
    groups: () => ({ needsYouNow: [...loops.values()].filter((loop) => loop.status === "surfaced"), comingUp: [...loops.values()].filter((loop) => loop.status === "queued" || loop.status === "snoozed") }),
    get: (id) => { const loop = loops.get(id); if (!loop) throw new Error("No such loop."); return loop; },
    act: async (id, action, snooze) => { const loop = { ...loops.get(id)!, status: action === "done" ? "done" : "snoozed", trigger: action === "snooze" ? { type: "time", preset: snooze } : loops.get(id)!.trigger }; loops.set(id, loop); return loop; },
    restore: (id, before) => { const loop = { ...loops.get(id)!, ...before }; loops.set(id, loop); return loop; },
  },
  openThread: async ({ title, text }) => { voiceThread.push(`# ${title}`, "", text, ""); return "thr_voice_demo"; },
  send: async ({ threadId, text, senderThreadId }) => {
    const where = THREADS.find((thread) => thread.id === threadId)?.title ?? threadId;
    if (threadId === "thr_voice_demo") voiceThread.push(text, "");
    else say(`→ ${where} (from ${senderThreadId}): ${text}`);
    // The Kensico lead finishes its turn a little later.
    if (threadId === "thr_kensico") setTimeout(() => void live.idle("thr_kensico", "**Paused** the eBay fetcher. It resumes Monday at 9."), 2500);
  },
  push: async () => {},
  publish: () => {},
  mockUrl: () => `ws://127.0.0.1:${PORT}/live`,
  warn: (message) => say("warn:", message),
});

type Handler = (input: never) => unknown;
const handlers: Record<string, Handler> = {
  "voiceLive.state": () => live.state(),
  "voiceLive.start": (input: { model?: "gpt-live-1"; sdp?: string }) => live.start(input),
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

const SCRIPT: Step[] = [
  { user: "What's waiting on me?" },
  { tool: "loops_list", args: {} },
  { say: "Two things need you: reply to Dana about the pricing deck, and renew the domain before Friday." },
  { user: "Snooze the domain one to tonight." },
  { tool: "loops_act", args: { loop_id: "loop_domain", action: "snooze", snooze: "tonight" } },
  { say: "Snoozed the domain renewal to tonight. Say undo in the next ten seconds if that's wrong." },
  { user: "Tell the Kensico lead to pause the eBay fetcher until Monday." },
  { tool: "send_to_thread", args: { target: "the Kensico lead", message: "Pause the eBay fetcher until Monday" } },
  { sayReadBack: true },
  { user: "Yes." },
  { tool: "confirm_send", args: { draft_id: "$draft" } },
  { say: "Sent." },
  { waitNote: true },
  { say: "The Kensico lead says the eBay fetcher is paused, and it picks up again Monday at nine. Anything else on Kensico while I have you?", bargeIn: { afterMs: 2600, text: "No, that's all, thanks." } },
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
    const resolved = JSON.stringify(args).replace("$draft", draft);
    const output = await new Promise<string>((resolve) => {
      pendingTool = { callId, at: Date.now(), resolve };
      send({ type: "response.event", delegation_id: "item_mock", event: { type: "response.output_item.done", item: { type: "function_call", call_id: callId, name, arguments: resolved } } });
    });
    lastOutput = output;
    draft = output.match(/Draft (d_[a-f0-9]+)/)?.[1] ?? draft;
    // The backend's turn: a few hundred tokens.
    send({ type: "response.event", event: { type: "response.completed", response: { usage: { input_tokens: 900, output_tokens: 40, input_tokens_details: { cached_tokens: 700 } } } } });
    await sleep(350);
  }

  void (async () => {
    send({ type: "session.started" });
    await sleep(1500);
    for (const step of SCRIPT) {
      if (closed) break;
      if ("user" in step) await user(step.user);
      else if ("tool" in step) await tool(step.tool, step.args);
      else if ("sayReadBack" in step) await speak(lastOutput.match(/"(Send to [^"]+)"/)?.[1] ?? "Send it?");
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
  runScript(socket);
});

server.listen(PORT, "127.0.0.1", () => say(`voice mock on http://127.0.0.1:${PORT} (out: ${OUT})`));
