// Editing a vendored BB file under source/ without regenerating the patches
// loses the edit at the next upstream sync. Check it with the package tests
// when a BB checkout is around: BB_UPSTREAM, or `bb` beside this repository.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const sync = fileURLToPath(new URL("../../../upstream/sync.mjs", import.meta.url));
const commit = readFileSync(new URL("../../../upstream/BB_COMMIT", import.meta.url), "utf8").trim();
const upstream = process.env.BB_UPSTREAM ?? fileURLToPath(new URL("../../../../../../bb", import.meta.url));

function hasCommit(): boolean {
  if (!existsSync(`${upstream}/.git`)) return false;
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: upstream, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

it.skipIf(!hasCommit())("the upstream patches reproduce every vendored file", () => {
  const result = spawnSync(process.execPath, [sync, "--upstream", upstream, "--check"], { encoding: "utf8" });
  expect(result.status, `${result.stdout}${result.stderr}\nRun node upstream/sync.mjs --upstream ${upstream} --write-patches`).toBe(0);
}, 60_000);
