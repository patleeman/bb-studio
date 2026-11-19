// Vitest globalSetup shared by every package in this workspace.
//
// Tests make temp folders with mkdtemp(join(tmpdir(), ...)), and so does the
// SDK's fake plugin host. Many never remove them, and on macOS the temp folder
// has a per-folder entry limit. So each run gets one temp root: TMPDIR (and
// TMP, TEMP) point at it before the workers start, every os.tmpdir() in a test
// and in any child process lands inside it, and teardown removes the lot.
//
// A run that is killed cannot tear down; the next run sweeps roots left over
// from runs more than a day old.
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PREFIX = "bbs-test-";
const STALE_MS = 24 * 60 * 60 * 1000;
const VARS = ["TMPDIR", "TMP", "TEMP"];

function sweepStale(base) {
  let names = [];
  try {
    names = readdirSync(base);
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_MS;
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue;
    const dir = join(base, name);
    try {
      if (statSync(dir).mtimeMs < cutoff) {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Gone already, or not ours to remove.
    }
  }
}

export default function setup() {
  const base = tmpdir();
  sweepStale(base);
  const root = mkdtempSync(join(base, PREFIX));
  const saved = Object.fromEntries(VARS.map((name) => [name, process.env[name]]));
  for (const name of VARS) process.env[name] = root;

  return function teardown() {
    for (const name of VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  };
}
