import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readStagedInstance, captureEnv } from "../staged-instance.mjs";
import { confirmStopped } from "../staged-stop.mjs";
import { runText } from "../capture/process.mjs";
import { runCapture } from "../capture/lifecycle.mjs";

const repo = resolve(import.meta.dirname, "../..");
function fixture(t) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "bb-studio-staged-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(path, content, executable = false) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, { mode: executable ? 0o755 : 0o644 });
}

test("descriptor rejects partial or mixed staging routes and removes inherited CLI routing", (t) => {
  const dir = fixture(t);
  const instance = { kind: "bb-studio-staged", directory: dir, dataDir: join(dir, "data"), port: 49501,
    serverUrl: "http://127.0.0.1:49501", cdpPort: 49503, cli: join(dir, "bb-app/node_modules/.bin/bb") };
  mkdirSync(instance.dataDir);
  write(instance.cli, "#!/bin/sh\nexit 0\n", true);
  const descriptor = join(dir, "instance.json");
  write(descriptor, JSON.stringify(instance));
  assert.throws(() => readStagedInstance({ BB_SERVER_URL: instance.serverUrl }), /missing BB_CAPTURE_INSTANCE/);
  assert.throws(() => readStagedInstance({ BB_CAPTURE_INSTANCE: descriptor, BB_DATA_DIR: "/private/work" }), /disagrees/);
  assert.deepEqual(readStagedInstance({ BB_CAPTURE_INSTANCE: descriptor }), instance);
  assert.deepEqual(captureEnv(instance, { PATH: "path", BB_CLI: "/private/bb", BB_HOST_ID: "real", BB_THREAD_ID: "real", BB_HOST_DAEMON_PORT: "1" }), {
    PATH: "path", BB_SERVER_URL: instance.serverUrl, BB_DATA_DIR: instance.dataDir, BB_HOST_DAEMON_PORT: "49502",
  });
  write(descriptor, JSON.stringify({ ...instance, cli: "/some/other/bb" }));
  assert.throws(() => readStagedInstance({ BB_CAPTURE_INSTANCE: descriptor }), /Invalid staged/);
});

test("stop failures and surviving owned processes prevent cleanup even without HTTP health", async () => {
  const quiet = { processes: async () => [], portsFree: async () => true, sleep: async () => {}, timeoutMs: 0 };
  await assert.rejects(confirmStopped({ ...quiet, stop: async () => { throw new Error("stop failed"); } }), /stop failed/);
  await assert.rejects(confirmStopped({ ...quiet, stop: async () => {}, processes: async () => ["owned process"] }), /still running/);
  await assert.rejects(confirmStopped({ ...quiet, stop: async () => {}, portsFree: async () => false }), /still running/);
  await confirmStopped({ ...quiet, stop: async () => {} });
});

test("staged stop retains files after the owned stop command fails", (t) => {
  const dir = fixture(t);
  const bin = join(dir, "bb-app/node_modules/.bin/bb-app");
  write(bin, "#!/bin/sh\nexit 1\n", true);
  write(join(dir, "launcher.log"), "diagnostic");
  const result = spawnSync(process.execPath, [process.env.STAGED_TEST_SOURCE || join(repo, "scripts/staged-bb.mjs"), "stop"], {
    encoding: "utf8", env: { ...process.env, BB_STAGED_DIR: dir, BB_STAGED_PORT: "49511" },
  });
  assert.equal(result.status, 1);
  assert.equal(readFileSync(join(dir, "launcher.log"), "utf8"), "diagnostic");
  assert.match(result.stderr, /Instance kept/);
});

test("capture commands reject missing executables and nonzero exits", async () => {
  await assert.rejects(runText("/nonexistent-capture-command", []), /ENOENT/);
  await assert.rejects(runText(process.execPath, ["-e", "process.stderr.write('fixture error'); process.exit(3)"]), /fixture error/);
  assert.equal(await runText(process.execPath, ["-e", "process.stdout.write('ok')"]), "ok");
});

test("capture fixture modules import without loading the unrelated native database binding", async (t) => {
  const dir = fixture(t);
  const target = join(dir, "capture/captures/bot-capture-fixtures.mjs");
  write(target, readFileSync(join(repo, "scripts/capture/captures/bot-capture-fixtures.mjs")));
  cpSync(join(repo, "scripts/staged-instance.mjs"), join(dir, "staged-instance.mjs"));
  await import(target);
});

test("combined captures unmount the old editor before cleanup can redirect the next capture", async () => {
  const order = [];
  const client = { resetCaptureState: async () => order.push("reset stored tabs"), navigate: async (path) => order.push(path) };
  for (const name of ["excalidraw", "dashboards-states", "dashboards-approval"]) {
    await runCapture(client, async () => { order.push(name); return async () => order.push(`delete ${name}`); }, async () => order.push("screenshot"));
  }
  assert.deepEqual(order, ["reset stored tabs", "excalidraw", "screenshot", "about:blank", "delete excalidraw", "reset stored tabs", "dashboards-states", "screenshot", "about:blank", "delete dashboards-states", "reset stored tabs", "dashboards-approval", "screenshot", "about:blank", "delete dashboards-approval"]);
  order.length = 0;
  await assert.rejects(runCapture(client, async () => async () => order.push("cleanup"), async () => { throw new Error("assertion"); }), /assertion/);
  assert.deepEqual(order, ["reset stored tabs", "about:blank", "cleanup"]);
});


test("the first capture navigation clears saved tabs before app code, then preserves tabs within that capture", async (t) => {
  const { runInNewContext } = await import("node:vm");
  const dir = fixture(t);
  const instance = { kind: "bb-studio-staged", directory: dir, dataDir: join(dir, "data"), port: 49501,
    serverUrl: "http://127.0.0.1:49501", cdpPort: 49503, cli: join(dir, "bb-app/node_modules/.bin/bb") };
  mkdirSync(instance.dataDir);
  write(instance.cli, "#!/bin/sh\nexit 0\n", true);
  write(join(dir, "instance.json"), JSON.stringify(instance));
  for (const [source, target] of [[process.env.CAPTURE_DRIVER_TEST_SOURCE || join(repo, "scripts/capture/driver.mjs"), "capture/driver.mjs"], [join(repo, "scripts/capture/bb.mjs"), "capture/bb.mjs"], [join(repo, "scripts/capture/process.mjs"), "capture/process.mjs"], [join(repo, "scripts/staged-instance.mjs"), "staged-instance.mjs"]]) {
    write(join(dir, target), readFileSync(source));
  }
  const saved = { ...process.env };
  delete process.env.BB_DATA_DIR;
  delete process.env.BB_SERVER_URL;
  delete process.env.BB_CAPTURE_CDP_PORT;
  process.env.BB_CAPTURE_INSTANCE = join(dir, "instance.json");
  let CdpClient;
  try { ({ CdpClient } = await import(join(dir, "capture/driver.mjs"))); }
  finally { process.env = saved; }
  const local = new Map([["bb:studio-workspace:v1", "deleted drawing"], ["other preference", "keep"]]);
  const session = new Map([["studio.sidebar.listMode", "drawings"]]);
  const scripts = new Map();
  let document;
  const client = new CdpClient("unused");
  client.command = async (method, args) => {
    if (method === "Page.addScriptToEvaluateOnNewDocument") { scripts.set("reset", args.source); return { identifier: "reset" }; }
    if (method === "Page.removeScriptToEvaluateOnNewDocument") { scripts.delete(args.identifier); return {}; }
    assert.equal(method, "Page.navigate");
    const url = new URL(args.url);
    document = { location: { origin: url.origin, href: url.href, pathname: url.pathname }, document: { readyState: "complete" }, window: {}, localStorage: { removeItem: (key) => local.delete(key) }, sessionStorage: { removeItem: (key) => session.delete(key) } };
    for (const source of scripts.values()) runInNewContext(source, document);
    return {};
  };
  client.poll = async (expression) => runInNewContext(expression, document);
  await client.resetCaptureState();
  await client.navigate("/plugins/studio/studio/dashboards/one");
  assert.equal(local.get("bb:studio-workspace:v1"), undefined);
  assert.equal(local.get("other preference"), "keep");
  assert.equal(session.size, 0);
  assert.equal(scripts.size, 0);
  local.set("bb:studio-workspace:v1", "tabs opened by this capture");
  await client.navigate("/plugins/studio/studio/dashboards/two");
  assert.equal(local.get("bb:studio-workspace:v1"), "tabs opened by this capture");
});
