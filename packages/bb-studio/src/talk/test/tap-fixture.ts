// The stub helper (stub-tap.mjs) installed as bin/bb-talk-tap with its
// .sha256, the way Studio ships the real one. Tests never run a real tap.
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const STUB_SOURCE = fileURLToPath(new URL("./stub-tap.mjs", import.meta.url));

export interface StubStep { at: number; event: string; [key: string]: unknown }
export interface StubPlan { apps?: unknown[]; permission?: string; steps: StubStep[]; exitAfterSteps?: boolean; exitCode?: number }

export function installStub(plan?: StubPlan) {
  const root = mkdtempSync(join(tmpdir(), "talk-tap-"));
  mkdirSync(join(root, "bin"));
  const path = join(root, "bin", "bb-talk-tap");
  copyFileSync(STUB_SOURCE, path);
  chmodSync(path, 0o755);
  writeFileSync(`${path}.sha256`, `${createHash("sha256").update(readFileSync(path)).digest("hex")}  bb-talk-tap\n`);
  const planFile = join(root, "plan.json");
  if (plan) writeFileSync(planFile, JSON.stringify(plan));
  const logFile = join(root, "stub.log");
  const fakeDir = join(root, "fake");
  mkdirSync(fakeDir);
  writeFileSync(join(fakeDir, "them.wav"), "");
  writeFileSync(join(fakeDir, "me.wav"), "");
  process.env.STUB_TAP_LOG = logFile;
  if (plan) process.env.STUB_TAP_PLAN = planFile;
  else delete process.env.STUB_TAP_PLAN;
  return {
    root,
    path,
    fake: { them: join(fakeDir, "them.wav"), me: join(fakeDir, "me.wav") },
    fakeDir,
    setPlan(next: StubPlan) {
      writeFileSync(planFile, JSON.stringify(next));
      process.env.STUB_TAP_PLAN = planFile;
    },
    /** argv and stdin lines the stub saw. */
    log(): { argv?: string[]; stdin?: unknown }[] {
      try {
        return readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },
  };
}

/** A piece and its final, `at` in stub milliseconds. */
export function piece(source: "me" | "them", index: number, startMs: number, endMs: number, text: string | null, at: number): StubStep[] {
  const steps: StubStep[] = [{ at, event: "segment", source, index, startMs, endMs }];
  if (text !== null) steps.push({ at: at + 5, event: "final", source, index, text, startMs, endMs });
  return steps;
}

export async function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error("Timed out waiting.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
