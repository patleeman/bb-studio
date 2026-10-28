#!/usr/bin/env node
// A stand-in for bb-talk-tap that speaks its protocol (src/talk/server/tap-protocol.ts)
// with made-up data. It never touches audio devices: `capture` refuses to run
// without --fake, as every test and staged capture on a dev Mac must.
//
//   STUB_TAP_PLAN   JSON file: { apps?, permission?, steps: [{ at, ...event }], exitAfterSteps?, exitCode? }
//                   A step { at, event: "segment", source, index, startMs, endMs } writes a small WAV
//                   into segmentDir and fills in its path.
//   STUB_TAP_SPEED  multiplies every step's `at` (default 1); --fake-speed divides it.
//   STUB_TAP_LOG    a file that gets each run's argv and stdin lines (for tests).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [command, ...rest] = process.argv.slice(2);
const log = (entry) => {
  if (process.env.STUB_TAP_LOG) appendFileSync(process.env.STUB_TAP_LOG, `${JSON.stringify(entry)}\n`);
};
log({ argv: process.argv.slice(2) });
const plan = process.env.STUB_TAP_PLAN ? JSON.parse(readFileSync(process.env.STUB_TAP_PLAN, "utf8")) : DEFAULT_PLAN();
const fakeSpeedAt = process.argv.indexOf("--fake-speed");
// --fake-speed 4 plays four times faster, as the real helper does.
const speed = (Number(process.env.STUB_TAP_SPEED ?? 1) || 1) / (fakeSpeedAt > 0 ? Number(process.argv[fakeSpeedAt + 1]) || 1 : 1);
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

function wav(ms) {
  const samples = Math.max(1, Math.round((16_000 * ms) / 1000));
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16_000, 24);
  buffer.writeUInt32LE(32_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

if (command === "apps") {
  emit({ apps: plan.apps ?? [] });
  process.exit(0);
}
if (command === "permission") {
  emit({ audioCapture: plan.permission ?? "granted" });
  process.exit(0);
}
if (command !== "capture") {
  process.stderr.write(`stub-tap: unknown command ${command}\n`);
  process.exit(64);
}

const argsAt = rest.indexOf("--json-args");
const args = JSON.parse(rest[argsAt + 1]);
if (!rest.includes("--fake")) {
  process.stderr.write("stub-tap: refusing to capture without --fake\n");
  emit({ event: "error", code: "internal", message: "The stub only replays fake audio." });
  process.exit(2);
}

let stopping = false;
const timers = [];
function stop() {
  if (stopping) return;
  stopping = true;
  for (const timer of timers) clearTimeout(timer);
  emit({ event: "stopped" });
  process.exit(plan.exitCode ?? 0);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  const lines = input.split("\n");
  input = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    log({ stdin: JSON.parse(line) });
    if (JSON.parse(line).cmd === "stop") stop();
  }
});
process.stdin.on("end", stop);

process.stderr.write(`stub-tap: capturing ${JSON.stringify(args.target)} mic=${args.mic} stt=${args.stt.kind}\n`);
let last = 0;
for (const step of plan.steps) {
  last = Math.max(last, step.at);
  timers.push(setTimeout(() => {
    const { at: _at, ...event } = step;
    if (event.event === "segment") {
      const path = join(args.segmentDir, `${event.source}-${String(event.index).padStart(5, "0")}.wav`);
      writeFileSync(path, wav(event.endMs - event.startMs));
      event.path = path;
    }
    if (event.event === "segment" || event.event === "partial" || event.event === "final" || event.event === "level") {
      if (event.source === "me" && !args.mic) return;
      if ((event.event === "partial" || event.event === "final") && args.stt.kind === "none") return;
      if (event.event === "final" && args.stt.kind === "test") event.text = `${event.endMs - event.startMs} ms of audio`;
    }
    emit(event);
  }, step.at * speed));
}
if (plan.exitAfterSteps) timers.push(setTimeout(stop, last * speed + 20));

function DEFAULT_PLAN() {
  // A short product call, as the staged preview shows it. Times are call
  // time; the stub plays it four times faster. The second "me" piece is the
  // mic hearing the speakers: Studio drops it as an echo.
  const pieces = [
    ["them", 0, 400, 6_400, "Thanks for joining. Shall we start with the launch date for the iOS app?"],
    ["me", 0, 900, 6_600, "Thanks for joining. Shall we start with the launch date for the iOS app?"],
    ["me", 1, 6_800, 12_400, "Yes. I think we can ship on the twelfth if the review goes quickly."],
    ["them", 1, 12_700, 18_500, "That works for us. Can you send the release notes by Friday?"],
    ["me", 2, 18_800, 24_000, "Sure, I'll draft them tomorrow and share the page with you."],
    ["them", 2, 24_300, 30_000, "Great. Let's also book a follow-up for the week after launch."],
  ];
  const steps = [{ at: 0, event: "started", sources: ["them", "me"] }];
  for (const [source, index, startMs, endMs, text] of pieces) {
    const words = text.split(" ");
    for (let at = startMs; at < endMs; at += 400) steps.push({ at: at / 4, event: "level", source, rms: 0.25 + 0.45 * Math.abs(Math.sin(at / 700)) });
    steps.push({ at: (startMs + 2_500) / 4, event: "partial", source, index, text: words.slice(0, Math.ceil(words.length / 2)).join(" ") });
    steps.push({ at: endMs / 4, event: "segment", source, index, startMs, endMs });
    steps.push({ at: endMs / 4 + 150, event: "final", source, index, text, startMs, endMs });
  }
  steps.sort((a, b) => a.at - b.at);
  return {
    permission: "granted",
    apps: [
      { bundleId: "us.zoom.xos", name: "zoom.us", pid: 501, playing: true },
      { bundleId: "com.google.Chrome", name: "Google Chrome", pid: 502, playing: true },
      { bundleId: "com.apple.FaceTime", name: "FaceTime", pid: 503, playing: false },
    ],
    steps,
  };
}
