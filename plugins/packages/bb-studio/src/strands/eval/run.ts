// The strand-sorting eval from the command line (plugins/packages/bb-studio):
//
//   npx tsx src/strands/eval/run.ts <conversation.json>... [--today] [--record <dir>] [--recorded <dir>]
//
// --today     scores the fixture's own "today" filing (the sorter before this eval).
// --recorded  replays with the answers recorded in <dir>/<conversation id>.json (what the tests do).
// --record    replays with a stand-in for Jev and the small model, and records their answers to <dir>.
// --rich      with the Studio setting strands_richSorting on (off by default).
// --live-jev  with --record: Jev's questions go to the running Studio's real Jev instead
//             (bb plugin rpc call studio decisions.systemOne.ask, the user's own BB: run it
//             only with their OK). Nothing else reaches it: the replay's store is in memory,
//             and the small model stays the stand-in. STRANDS_EVAL_JEV_LOG counts the calls
//             (one line each) and STRANDS_EVAL_JEV_MAX (default 400) stops them.
//
// The stand-in is Codex in ephemeral mode with the staged sign-in
// (CODEX_HOME=~/.bb-staged/codex, nothing saved to the user's sessions), model
// STRANDS_EVAL_MODEL (default gpt-6-luna, low effort). It is not Jev: numbers
// from it say how the prompts and signals do with a small fast model.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { jsonIn } from "../sort";
import { FAILED, jevPrompt, keyOf, recordedJev, recordedModel, type Recording } from "./answers";
import { JEV_TIMEOUT_MS } from "../detector";
import { replay } from "./replay";
import { formatScore, score, todayFiling } from "./score";
import type { EvalConversation } from "./types";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); if (at < 0) return null; const value = args[at + 1]!; args.splice(at, 2); return value; };
const today = args.includes("--today");
if (today) args.splice(args.indexOf("--today"), 1);
const recordDir = flag("--record");
const recordedDir = flag("--recorded");
const showWrong = args.includes("--wrong");
const liveJev = args.includes("--live-jev");
const rich = args.includes("--rich");
if (rich) args.splice(args.indexOf("--rich"), 1);
if (liveJev) args.splice(args.indexOf("--live-jev"), 1);
if (showWrong) args.splice(args.indexOf("--wrong"), 1);

/** One real Jev call through the running Studio, counted in a shared log; null past the cap or on failure. */
async function realJev(input: { state: unknown; questions: Record<string, unknown> }): Promise<Record<string, unknown> | null> {
  const log = process.env.STRANDS_EVAL_JEV_LOG ?? join(tmpdir(), "strands-eval-jev.log");
  const max = Number(process.env.STRANDS_EVAL_JEV_MAX ?? 400);
  const used = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0;
  if (used >= max) return null;
  appendFileSync(log, `${new Date().toISOString()}\n`);
  const dir = mkdtempSync(join(tmpdir(), "strands-jev-"));
  const file = join(dir, "input.json");
  writeFileSync(file, JSON.stringify({ caller: "strands-eval", state: input.state, questions: input.questions }));
  const text = await new Promise<string>((resolve) => {
    const child = spawn("bb", ["plugin", "rpc", "call", "studio", "decisions.systemOne.ask", "--input-file", file, "--json"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += String(chunk); });
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(out));
  });
  rmSync(dir, { recursive: true, force: true });
  const result = jsonIn(text) as { ok?: boolean; answers?: Record<string, unknown> } | null;
  return result?.ok && result.answers ? result.answers : null;
}

function codex(prompt: string): Promise<string> {
  const home = process.env.STRANDS_EVAL_CODEX_HOME ?? join(homedir(), ".bb-staged", "codex");
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-m", process.env.STRANDS_EVAL_MODEL ?? "gpt-6-luna", "-c", "model_reasoning_effort=low", "-"], {
      cwd: "/tmp", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? homedir(), CODEX_HOME: home }, stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk) => { out += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`codex exited ${code}`))));
    child.stdin.end(prompt);
  });
}

async function main() {
  for (const path of args) {
    const conversation = JSON.parse(readFileSync(path, "utf8")) as EvalConversation;
    if (today) { console.log(formatScore(`${conversation.title} (today)`, score(conversation, todayFiling(conversation)))); continue; }
    const recording: Recording = { jev: {}, model: {} };
    const misses: string[] = [];
    let deps;
    if (recordedDir) {
      const saved = JSON.parse(readFileSync(join(recordedDir, `${conversation.id}.json`), "utf8")) as Recording;
      deps = { jev: recordedJev(saved, misses), model: recordedModel(saved, misses) };
    } else if (recordDir) {
      deps = {
        jev: async (input: { state: unknown; questions: Record<string, unknown> }) => {
          const key = keyOf({ state: input.state, questions: input.questions });
          const started = Date.now();
          let answers: Record<string, unknown> | undefined;
          if (liveJev) answers = (await realJev(input)) ?? undefined;
          for (let attempt = 0; !liveJev && attempt < 2 && !answers && Date.now() - started < JEV_TIMEOUT_MS; attempt++) {
            const text = await codex(jevPrompt(input)).catch(() => "");
            const parsed = (jsonIn(text) as { answers?: Record<string, unknown> } | null)?.answers;
            if (parsed && typeof parsed === "object") answers = parsed;
          }
          // Later than the detector waits: it timed out, so the replay fails it too.
          if (!answers || Date.now() - started >= JEV_TIMEOUT_MS - 500) { recording.jev[key] = FAILED; return { ok: false as const, unavailable: false, error: "no answer in time" }; }
          recording.jev[key] = answers;
          return { ok: true as const, answers };
        },
        model: async (input: { prompt: string }) => {
          const text = await codex(input.prompt).catch(() => null);
          recording.model[keyOf(input.prompt)] = text ?? FAILED;
          if (text === null) return { ok: false as const, unavailable: false, error: "no answer" };
          return { ok: true as const, text };
        },
      };
    } else throw new Error("Pass --today, --recorded <dir> or --record <dir>.");
    const result = await replay(conversation, { ...deps, richSorting: rich, log: (line) => console.error(line) });
    const scored = score(conversation, result);
    console.log(formatScore(conversation.title, scored, { jev: result.jevCalls, model: result.modelCalls }));
    if (showWrong) {
      const titles = new Map(result.service.store.list(result.threadId).map((strand) => [strand.id, strand.title]));
      const mapped = new Map([...scored.mapping].map(([id, key]) => [key, titles.get(id) ?? id]));
      for (const wrong of scored.wrong) console.log(`  wrong ${wrong.seq}: want ${wrong.want} got ${wrong.got ?? "(unfiled)"}${wrong.got?.startsWith("?") ? ` "${titles.get(wrong.got.slice(1)) ?? ""}"` : ""}`);
      console.log(`  mapping: ${[...mapped].map(([key, title]) => `${key}=${title}`).join("; ")}`);
    }
    if (misses.length) console.log(`  ${misses.length} questions weren't recorded`);
    if (recordDir) {
      mkdirSync(recordDir, { recursive: true });
      const file = join(recordDir, `${conversation.id}.json`);
      writeFileSync(file, `${JSON.stringify(recording, null, 1)}\n`);
      console.log(`  recorded ${Object.keys(recording.jev).length} Jev and ${Object.keys(recording.model).length} model answers to ${file}${existsSync(file) ? "" : " (failed)"}`);
    }
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
