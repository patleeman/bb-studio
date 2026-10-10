#!/usr/bin/env node
/**
 * Solo install check: proves each BB Studio plugin works when it is the only
 * BB Studio plugin installed. For each plugin it starts a fresh stable BB on
 * its own data directory and ports (never ~/.bb or the installed app),
 * installs just that plugin from GitHub at a pushed commit the way users do,
 * and checks that it runs, that its CLI command answers, that its
 * studio_health RPC (if it publishes one) reports no broken check, and that
 * its main surface loads in the real BB UI in headless Chrome without an
 * error screen or uncaught exception. Then it stops that BB and deletes its
 * data before the next plugin.
 *
 *   node scripts/solo-check.mjs [--plugin <id>] [--ref <pushed commit>]
 *
 * --ref defaults to origin/main. BB_SOLO_DIR moves the scratch directory
 * (default $TMPDIR/bb-studio-solo, deleted at the end) and BB_SOLO_PORT picks
 * the server port (default 48990); the host daemon and Chrome take the next
 * two ports. Prints a pass/fail table and exits 1 on any failure.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoSource = "git:github.com/patleeman/bb-studio";
const releaseFeedUrl = "https://github.com/get-bb/bb/releases/download/desktop-latest/latest-mac.yml";
const soloDir = resolve(process.env.BB_SOLO_DIR || join(tmpdir(), "bb-studio-solo"));
{
  const within = (child, parent) => !relative(parent, child).startsWith("..") && !relative(parent, child).startsWith(sep);
  const unsafe = [repoRoot, homedir(), process.cwd()].some((path) => within(path, soloDir)) || within(soloDir, join(homedir(), ".bb"));
  if (unsafe || soloDir === dirname(soloDir)) throw new Error(`Refusing to use ${soloDir} as BB_SOLO_DIR: it would delete the repository, your home directory, or ~/.bb.`);
}
const port = Number(process.env.BB_SOLO_PORT ?? "48990");
if (!Number.isInteger(port) || port < 1024 || port > 65533) throw new Error(`BB_SOLO_PORT must be a port from 1024 to 65533, not ${process.env.BB_SOLO_PORT}`);
const serverUrl = `http://127.0.0.1:${port}`;
const binDir = join(soloDir, "bb-app", "node_modules", ".bin");
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/**
 * What each plugin must show when it's alone. `cli` is a read-only command
 * that must succeed (besides `--help`); `surface` is the route of its main
 * surface and `labels` text that must be visible there. `selector` (with the
 * seeded thread ID substituted) must also match. `health` lists the
 * studio_health checks a fresh install reports ("status: title"); without it
 * every check must be ok.
 */
const PLUGINS = {
  // Alone, Studio's collection, opened as the workspace's new tab, has no add-ons to fill it.
  studio: { cli: ["studio", "list", "--all"], surface: "/plugins/studio/studio/collection", labels: ["No add-ons installed"] },
  pages: { cli: ["pages", "list", "--all"], surface: "/plugins/pages/pages", labels: ["No pages yet"] },
  talk: { cli: ["talk", "list"], surface: "/plugins/talk/recordings", labels: ["Dictations", "No recordings yet"] },
  excalidraw: { cli: ["excalidraw", "list"], surface: "/plugins/excalidraw/drawings", labels: ["No drawings yet"] },
  artifacts: { cli: ["artifacts", "list"], surface: "/plugins/artifacts/artifacts", labels: ["No artifacts yet"] },
  "studio-tables": { cli: ["tables", "list"], surface: "/plugins/studio-tables/tables", labels: ["No tables yet"] },
  "thread-list-plus": {
    cli: ["thread-list-plus", "--help"],
    surface: "/projects/{project}/threads/{thread}",
    labels: ["Solo check thread"],
    selector: '[data-sidebar-thread-id="{thread}"]',
  },
  mobile: { cli: ["mobile", "status"], surface: "/settings/plugins/mobile", labels: ["Studio Mobile", "APNs environment"] },
  "emoji-react": { surface: "/settings/plugins/emoji-react", labels: ["Studio Reactions", "Saved reactions"] },
  "smart-decisions": { cli: ["smart-decisions", "status"], surface: "/settings/plugins/smart-decisions", labels: ["Studio Decisions", "Jev connection", "Fallback model"],
    // Its documented first state: no Jev provider until one is set up.
    health: ["degraded: No Jev provider is set up"],
  },
  design: { surface: "/plugins/design/designs", labels: ["New design", "No designs yet"] },
  "studio-code": { surface: "/plugins/studio-code/workspaces", labels: ["No workspaces yet"] },
};

// Text BB or a plugin shows when a surface crashes or can't load.
const ERROR_SCREENS = [/something went wrong/i, /failed to load/i, /error boundary/i, /plugin (?:crashed|error)/i, /couldn['’]t load/i, /cannot read properties of/i];

function soloEnv(dataDir, extra) {
  // Drop the BB_* variables of the thread this may run inside: BB_CLI and
  // BB_HOST_DAEMON_PORT would send the CLI to the BB you work in.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("BB_")));
  return { ...env, PATH: `${binDir}:${process.env.PATH}`, ...(dataDir ? { BB_DATA_DIR: dataDir, BB_SERVER_URL: serverUrl } : {}), ...extra };
}

function run(command, args, { cwd = soloDir, dataDir, timeoutMs = 600000 } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, env: soloEnv(dataDir), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => { clearTimeout(timer); resolvePromise({ code: -1, stdout, stderr: String(error) }); });
    child.on("close", (code) => { clearTimeout(timer); resolvePromise({ code, stdout, stderr }); });
  });
}

async function must(command, args, options) {
  const result = await run(command, args, options);
  if (result.code !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.code}): ${(result.stderr || result.stdout).trim().slice(-800)}`);
  return result.stdout;
}

function portFree(candidate) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", () => resolvePromise(false));
    server.listen(candidate, "127.0.0.1", () => server.close(() => resolvePromise(true)));
  });
}

async function healthy() {
  try {
    return (await fetch(`${serverUrl}/health`)).ok;
  } catch {
    return false;
  }
}

async function stableVersion() {
  if (process.env.BB_STABLE_VERSION) return process.env.BB_STABLE_VERSION;
  const response = await fetch(releaseFeedUrl);
  if (!response.ok) throw new Error(`GET ${releaseFeedUrl} failed: ${response.status}`);
  const version = /^version:\s*(\S+)\s*$/m.exec(await response.text())?.[1];
  if (!version) throw new Error(`No version in ${releaseFeedUrl}`);
  return version;
}

async function pushedRef(ref) {
  if (ref === "origin/main") await must("git", ["fetch", "-q", "origin", "main"], { cwd: repoRoot });
  const commit = (await must("git", ["rev-parse", ref], { cwd: repoRoot })).trim();
  const branches = await must("git", ["branch", "-r", "--contains", commit], { cwd: repoRoot });
  if (!/\borigin\/main\b/.test(branches)) throw new Error(`${commit} isn't on origin/main. BB installs from GitHub, so push it first.`);
  return commit;
}

/** One staged BB with only `pluginId` installed; returns its check results. */
async function checkPlugin(pluginId, spec, ref, chromeTools) {
  const results = [];
  const record = (check, ok, detail = "") => {
    results.push({ check, ok, detail });
    process.stdout.write(`  ${ok ? "pass" : "FAIL"} ${check}${detail ? `: ${detail}` : ""}\n`);
    return ok;
  };
  const instanceDir = join(soloDir, pluginId);
  const dataDir = join(instanceDir, "data");
  await rm(instanceDir, { recursive: true, force: true });
  await mkdir(instanceDir, { recursive: true });
  const bb = (args, options) => run(join(binDir, "bb"), args, { dataDir, cwd: instanceDir, ...options });
  const bbJson = async (...args) => {
    const result = await bb([...args, "--json"]);
    if (result.code !== 0) throw new Error(`bb ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim().slice(-800)}`);
    return JSON.parse(result.stdout);
  };

  const log = await open(join(instanceDir, "launcher.log"), "a");
  const launcher = spawn(
    join(binDir, "bb-app"),
    ["--bundled", "--data-dir", dataDir, "--server-port", String(port), "--host-daemon-port", String(port + 1)],
    { cwd: instanceDir, detached: true, stdio: ["ignore", log.fd, log.fd], env: soloEnv(null, { BB_TELEMETRY: "0", BB_STUDIO_SPACES_DIR: join(instanceDir, "Spaces") }) },
  );
  launcher.unref();
  await log.close();
  let chrome = null;
  try {
    const started = Date.now();
    while (!(await healthy())) {
      if (Date.now() - started > 120000) throw new Error(`BB didn't start; see ${join(instanceDir, "launcher.log")}`);
      await sleep(1000);
    }
    // BB 0.46+ opens a first-run setup guide over every page of a new install.
    await bb(["settings", "general", "onboardingCompletedAt", new Date().toISOString()]);

    // 1. Install just this plugin from GitHub, as users do.
    const install = await bb(["plugin", "install", `${repoSource}@${ref}`, "--plugin", pluginId, "--yes"]);
    if (!record("install", install.code === 0, install.code === 0 ? "" : (install.stderr || install.stdout).trim().slice(-600))) return results;

    // 2. BB reports it running, and no other BB Studio plugin is installed.
    let entry = null;
    const waitStarted = Date.now();
    while (Date.now() - waitStarted < 120000) {
      const { plugins } = await bbJson("plugin", "list");
      entry = plugins.find((plugin) => plugin.id === pluginId);
      const others = plugins.filter((plugin) => plugin.id !== pluginId && String(plugin.source ?? "").includes("patleeman/bb-studio"));
      if (others.length) throw new Error(`Not solo: ${others.map((plugin) => plugin.id).join(", ")} also installed`);
      if (entry && entry.status !== "starting" && entry.status !== "loading") break;
      await sleep(2000);
    }
    const status = entry ? `${entry.status}${entry.statusDetail ? ` (${entry.statusDetail})` : ""}` : "not listed";
    const failedServices = (entry?.services ?? []).filter((service) => !["running", "idle", "stopped"].includes(service.state));
    record("status", entry?.status === "running" && failedServices.length === 0, entry?.status === "running" && failedServices.length === 0 ? "running" : `${status}${failedServices.length ? `; services ${JSON.stringify(failedServices)}` : ""}`);

    // A project and a thread that never runs, for surfaces that show threads.
    const projectDir = join(instanceDir, "project");
    await mkdir(projectDir);
    await writeFile(join(projectDir, "README.md"), "# Solo check\n");
    await must("git", ["init", "-q"], { cwd: projectDir });
    await must("git", ["add", "README.md"], { cwd: projectDir });
    await must("git", ["-c", "user.name=Solo", "-c", "user.email=solo@example.com", "commit", "-qm", "Start"], { cwd: projectDir });
    const [machine] = await bbJson("machine", "list");
    const project = await bbJson("project", "create", "--name", "Solo", "--root", projectDir, "--machine", machine.id);
    const thread = await bbJson("thread", "spawn", "--project", project.id, "--title", "Solo check thread", "--prompt", "Solo check fixture. Do not run.", "--send-at", "30d");

    // 3. Its CLI command answers --help and a read-only command.
    const cliName = entry?.cliCommand?.name;
    if (spec.cli && cliName !== spec.cli[0]) record("cli", false, `expected bb ${spec.cli[0]}, plugin list shows ${cliName ?? "none"}`);
    else if (cliName) {
      // Stable BB passes --help to the plugin, and some answer it with their
      // usage and exit 1; the reply must still name the read-only command.
      const help = await bb([cliName, "--help"], { timeoutMs: 60000 });
      const helpText = help.stdout + help.stderr;
      const helpOk = help.code === 0 || (help.code > 0 && Boolean(spec.cli) && helpText.includes(spec.cli[1]));
      const command = spec.cli ?? [cliName, "--help"];
      const answer = spec.cli ? await bb(command, { timeoutMs: 60000 }) : help;
      const ok = helpOk && answer.code === 0;
      record("cli", ok, ok ? `bb ${command.join(" ")}` : `bb ${helpOk ? command.join(" ") : `${cliName} --help`} exited ${helpOk ? answer.code : help.code}: ${((helpOk ? answer : help).stderr || (helpOk ? answer : help).stdout).trim().slice(-400)}`);
    } else record("cli", true, "none");

    // 4. Its studio_health RPC, when it publishes one, reports nothing broken.
    const rpcList = await bb(["plugin", "rpc", "list", pluginId, "--json"]);
    const publishesHealth = rpcList.code === 0 && rpcList.stdout.includes("studio_health");
    if (rpcList.code !== 0) record("health", false, `bb plugin rpc list failed: ${(rpcList.stderr || rpcList.stdout).trim().slice(-300)}`);
    else if (!publishesHealth) record("health", !spec.health, spec.health ? "studio_health isn't published" : "none published");
    else {
      const response = await fetch(`${serverUrl}/api/v1/plugins/${pluginId}/rpc/studio_health`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const payload = await response.json().catch(() => null);
      const checks = payload?.result?.checks;
      const reported = Array.isArray(checks) ? checks.map((check) => `${check.status}: ${check.title}`) : null;
      const expected = spec.health ?? [];
      const unexpected = (reported ?? []).filter((line) => !line.startsWith("ok:") && !expected.includes(line));
      const absent = expected.filter((line) => !reported?.includes(line));
      const ok = response.ok && payload?.ok && reported !== null && unexpected.length === 0 && absent.length === 0;
      const summary = reported ? `${reported.join("; ") || "no checks"}${absent.length ? `; expected ${absent.join("; ")}` : ""}` : JSON.stringify(payload).slice(0, 300);
      record("health", ok, summary);
    }

    // 5. Its main surface loads in BB's UI with no error screen or exception.
    const fill = (text) => text.replaceAll("{project}", project.id).replaceAll("{thread}", thread.id);
    chrome = await chromeTools.start();
    const failure = await checkSurface(chrome.client, fill(spec.surface), spec.labels.map(fill), spec.selector && fill(spec.selector));
    record("ui", !failure, failure ?? `${fill(spec.surface)}: ${spec.labels.join(", ")}`);
  } catch (error) {
    record("error", false, String(error?.message ?? error).slice(0, 600));
  } finally {
    if (chrome) await chrome.stop();
    await run(join(binDir, "bb-app"), ["stop", "--data-dir", dataDir], { timeoutMs: 60000 });
    const stopped = Date.now();
    while ((await healthy()) && Date.now() - stopped < 30000) await sleep(1000);
    if (await healthy()) record("cleanup", false, `BB still answers at ${serverUrl}`);
    if (results.every((result) => result.ok) || process.env.BB_SOLO_KEEP !== "1") await rm(instanceDir, { recursive: true, force: true });
  }
  return results;
}

/** Loads `path` in a fresh page and returns why it failed, or null. */
async function checkSurface(client, path, labels, selector) {
  const problems = [];
  const onEvent = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      problems.push(`uncaught: ${details.exception?.description ?? details.text}`.slice(0, 300));
    } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      const text = message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ");
      problems.push(`console.error: ${text}`.slice(0, 300));
    }
  };
  client.socket.addEventListener("message", onEvent);
  await client.command("Runtime.enable");
  await client.navigate(path);
  try {
    for (const label of labels) await client.waitForText(label, 30000);
    if (selector) await client.waitForSelector(selector, 30000);
  } catch (error) {
    problems.push(String(error.message).split("\n")[0]);
  }
  // Let late module loads and RPCs settle, so their errors are caught too.
  await sleep(3000);
  const text = (await client.poll("document.body?.innerText ?? \"\"")) ?? "";
  for (const pattern of ERROR_SCREENS) {
    const match = pattern.exec(text);
    if (match) problems.push(`error screen: ${text.slice(Math.max(0, match.index - 80), match.index + 160).replace(/\s+/g, " ")}`);
  }
  client.socket.removeEventListener("message", onEvent);
  if (process.env.BB_SOLO_DEBUG === "1") process.stdout.write(`  page text:\n${text.slice(0, 2000)}\n`);
  return problems.length ? [...new Set(problems)].join(" | ") : null;
}

async function main() {
  const { plugins } = JSON.parse(await readFile(join(repoRoot, ".bb/plugins.json"), "utf8"));
  const ids = plugins.map(({ name }) => name);
  const missing = ids.filter((id) => !PLUGINS[id]);
  if (missing.length) throw new Error(`Add solo-check expectations for: ${missing.join(", ")}`);
  const pluginFlag = process.argv.indexOf("--plugin");
  const only = pluginFlag >= 0 ? process.argv[pluginFlag + 1] : null;
  if (pluginFlag >= 0 && !ids.includes(only)) throw new Error(`Use --plugin with a plugin ID from .bb/plugins.json: ${ids.join(", ")}`);
  const refFlag = process.argv.indexOf("--ref");
  const ref = await pushedRef(refFlag >= 0 ? process.argv[refFlag + 1] : "origin/main");

  if (await healthy()) throw new Error(`Something already answers at ${serverUrl}. Set BB_SOLO_PORT.`);
  for (const candidate of [port, port + 1, port + 2]) {
    if (!(await portFree(candidate))) throw new Error(`Port ${candidate} is in use. Set BB_SOLO_PORT to a free range of three ports.`);
  }
  await rm(soloDir, { recursive: true, force: true });
  await mkdir(soloDir, { recursive: true });

  // The capture driver reads these when it's imported.
  process.env.BB_SERVER_URL = serverUrl;
  process.env.BB_DATA_DIR = join(soloDir, "unused");
  process.env.BB_CAPTURE_CDP_PORT = String(port + 2);
  const { CdpClient, ensureChrome } = await import("./capture/driver.mjs");
  const chromeTools = {
    async start() {
      const { webSocketUrl, process: chromeProcess, profileDir } = await ensureChrome();
      const client = new CdpClient(webSocketUrl);
      const stop = async () => {
        client.socket?.close();
        if (chromeProcess) {
          const exited = new Promise((resolvePromise) => chromeProcess.once("exit", resolvePromise));
          chromeProcess.kill();
          await Promise.race([exited, sleep(5000)]);
        }
        if (profileDir) await rm(profileDir, { recursive: true, force: true });
      };
      try {
        await client.connect();
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      } catch (error) {
        await stop();
        throw error;
      }
      return { client, stop };
    },
  };

  const interrupted = async () => {
    for (const id of ids) {
      if (existsSync(join(soloDir, id, "data"))) await run(join(binDir, "bb-app"), ["stop", "--data-dir", join(soloDir, id, "data")], { timeoutMs: 30000 });
    }
    await rm(soloDir, { recursive: true, force: true });
    process.exit(130);
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);

  const rows = [];
  try {
    const version = await stableVersion();
    process.stdout.write(`Installing bb-app ${version} in ${soloDir}; plugins from ${repoSource}@${ref.slice(0, 7)}\n`);
    await must("npm", ["install", "--prefix", join(soloDir, "bb-app"), `bb-app@${version}`, "--no-audit", "--no-fund"]);
    for (const id of only ? [only] : ids) {
      process.stdout.write(`\n${id}\n`);
      rows.push({ id, results: await checkPlugin(id, PLUGINS[id], ref, chromeTools) });
    }
  } finally {
    if (process.env.BB_SOLO_KEEP !== "1" || rows.every((row) => row.results.every((result) => result.ok))) await rm(soloDir, { recursive: true, force: true });
  }

  const columns = ["install", "status", "cli", "health", "ui"];
  const cell = (results, check) => {
    const result = results.find((candidate) => candidate.check === check);
    return result ? (result.ok ? "pass" : "FAIL") : "-";
  };
  process.stdout.write(`\nSolo install check at ${ref.slice(0, 7)}\n\n`);
  const width = Math.max(...rows.map((row) => row.id.length), 6);
  process.stdout.write(`${"plugin".padEnd(width)}  ${columns.map((column) => column.padEnd(7)).join(" ")} result\n`);
  let failed = 0;
  for (const { id, results } of rows) {
    const ok = results.every((result) => result.ok);
    if (!ok) failed += 1;
    process.stdout.write(`${id.padEnd(width)}  ${columns.map((column) => cell(results, column).padEnd(7)).join(" ")} ${ok ? "PASS" : "FAIL"}\n`);
  }
  for (const { id, results } of rows) {
    for (const result of results.filter((candidate) => !candidate.ok)) process.stdout.write(`\n${id} ${result.check}: ${result.detail}`);
  }
  process.stdout.write(`\n${failed ? `${failed} of ${rows.length} plugins failed` : `All ${rows.length} plugins pass alone`}\n`);
  process.exitCode = failed ? 1 : 0;
}

await main();
