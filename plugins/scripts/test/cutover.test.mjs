import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const script = new URL("../swap/cutover.sh", import.meta.url).pathname;

function fixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "bb-cutover-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["live", "studio"]) {
    const dir = join(root, name);
    for (const plugin of ["studio", "automations"]) {
      mkdirSync(join(dir, "plugins", plugin), { recursive: true });
      const db = new DatabaseSync(join(dir, "plugins", plugin, "data.db"));
      db.exec(plugin === "studio"
        ? "CREATE TABLE bot_runners (id TEXT, state TEXT); INSERT INTO bot_runners VALUES ('run_a', 'active');"
        : "CREATE TABLE automations (id TEXT, enabled INTEGER); INSERT INTO automations VALUES ('a', 1);");
      db.close();
    }
    const bb = new DatabaseSync(join(dir, "bb.db"));
    bb.exec("CREATE TABLE threads (id TEXT, status TEXT); INSERT INTO threads VALUES ('thr_main', 'idle'); CREATE TABLE plugin_settings (plugin_id TEXT, key TEXT, value TEXT);");
    bb.close();
  }
  writeFileSync(join(root, "studio", "fork-import.json"), JSON.stringify({ version: 1, sourceDataDir: join(root, "live") }));
  writeFileSync(join(root, "cli.js"), "process.exit(3)\n");
  const env = join(root, "cutover.env");
  writeFileSync(env, [
    `COS=thr_main`, `LIVE_DIR=${join(root, "live")}`, `STUDIO_DIR=${join(root, "studio")}`,
    `LIVE_PORT=1`, `STUDIO_PORT=2`, `ARCHIVE_ROOT=${join(root, "archive")}`, `CLI=${join(root, "cli.js")}`,
    `TAILSCALE=off`, `STOP_LIVE="touch ${join(root, "STOPPED")}"`,
  ].join("\n"));
  return { root, env };
}

const snapshot = (dir) => readdirSync(dir, { recursive: true }).sort().map((f) => {
  const s = statSync(join(dir, String(f)));
  return `${f}:${s.isFile() ? s.size + ":" + s.mtimeMs : "d"}`;
});

test("the script parses", () => {
  assert.equal(spawnSync("bash", ["-n", script]).status, 0);
});

test("refuses to start without the Bot's thread id", () => {
  const run = spawnSync("bash", [script, "--dry-run"], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr + run.stdout, /set COS/);
});

test("a dry run checks, prints what it would do, and changes nothing", (t) => {
  const { root, env } = fixture(t);
  const live = snapshot(join(root, "live"));
  const studio = snapshot(join(root, "studio"));
  const run = spawnSync("bash", [script, "--dry-run"], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, CUTOVER_ENV: env } });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /DRY RUN/);
  assert.match(run.stdout, /ok {3}plugin databases present/);
  assert.match(run.stdout, /Chief of Staff thr_main is idle; runners active 1; BB automations on 1/);
  assert.match(run.stdout, /WOULD RUN: .*transfer-bot\.mjs --from/);
  assert.match(run.stdout, /WOULD RUN: tailscale serve --bg --https=443 http:\/\/127\.0\.0\.1:2/);
  assert.match(run.stdout, /nothing was changed/);
  assert.deepEqual(snapshot(join(root, "live")), live);
  assert.deepEqual(snapshot(join(root, "studio")), studio);
  assert.throws(() => statSync(join(root, "STOPPED")));
});

test("stops at a failed check and prints the rollback", (t) => {
  const { root, env } = fixture(t);
  writeFileSync(join(root, "studio", "fork-import.json"), JSON.stringify({ version: 1, sourceDataDir: "/elsewhere" }));
  const run = spawnSync("bash", [script, "--dry-run"], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, CUTOVER_ENV: env } });
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /FAIL fork-import\.json does not name/);
  assert.match(run.stdout, /STOPPED at step 0.*\n.*Nothing has changed/);
});
