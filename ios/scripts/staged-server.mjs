#!/usr/bin/env node
/**
 * Fast, isolated staged BB server for iOS UI tests (no Codex/Claude sign-in,
 * never touches ~/.bb-studio, ~/.bb, /Applications/BB Studio.app, or port 38986).
 *
 *   BB_STAGED_DIR=<tmp> BB_STAGED_PORT=<free port> node ios/scripts/staged-server.mjs start
 *   BB_STAGED_DIR=<tmp> node ios/scripts/staged-server.mjs stop
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, open, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const iosRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(iosRoot, "..");
const stagedDir = resolve(process.env.BB_STAGED_DIR || join(tmpdir(), "bb-ios-staged"));
const binCacheDir = resolve(process.env.BB_STAGED_BIN_CACHE || join(tmpdir(), "bb-ios-staged-bin"));
const port = Number(process.env.BB_STAGED_PORT || "0");
const releaseFeedUrl = "https://github.com/get-bb/bb/releases/download/desktop-latest/latest-mac.yml";

// Safety: never allow stagedDir to overlap repoRoot, homedir, or ~/.bb*.
{
  const within = (child, parent) => !relative(parent, child).startsWith("..") && !relative(parent, child).startsWith(sep);
  const unsafe = [repoRoot, homedir(), process.cwd()].some((p) => within(p, stagedDir))
    || within(stagedDir, join(homedir(), ".bb"))
    || within(stagedDir, join(homedir(), ".bb-studio"));
  if (unsafe || stagedDir === dirname(stagedDir)) {
    throw new Error(`Refusing unsafe BB_STAGED_DIR: ${stagedDir}`);
  }
}

const INHERITED = /^(BB_|CLAUDE_|_CLAUDE_|ANTHROPIC_|CLAUDECODE$)/;
const binDir = join(binCacheDir, "node_modules", ".bin");
const dataDir = join(stagedDir, "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stagedEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !INHERITED.test(k)));
  return {
    ...env,
    PATH: `${binDir}:${process.env.PATH}`,
    BB_TELEMETRY: "0",
    BB_STUDIO_IMPORT_FROM: "off",
    ...extra,
  };
}

function run(cmd, args, { cwd = stagedDir, envExtra = {}, quiet = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, env: stagedEnv(envExtra), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolvePromise(stdout);
      reject(new Error(`${cmd} ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
    });
    if (!quiet) child.stderr.pipe(process.stderr);
  });
}

function portFree(candidate) {
  return new Promise((r) => {
    const s = createServer();
    s.once("error", () => r(false));
    s.listen(candidate, "127.0.0.1", () => s.close(() => r(true)));
  });
}

async function pickPortPair(requested) {
  const candidates = requested ? [requested] : [];
  if (candidates.length === 0) {
    for (let i = 0; i < 30; i++) {
      const p = 49200 + Math.floor(Math.random() * 10000);
      if (p !== 38986 && p + 1 !== 38986) candidates.push(p);
    }
  }
  for (const p of candidates) {
    if (p === 38986 || p + 1 === 38986) throw new Error("Refusing live BB port 38986");
    if ((await portFree(p)) && (await portFree(p + 1))) return p;
  }
  throw new Error("Could not find a free consecutive loopback port pair");
}

async function ensureBbApp() {
  const bbAppBin = join(binDir, "bb-app");
  if (existsSync(bbAppBin)) return;
  await mkdir(binCacheDir, { recursive: true });
  let version = process.env.BB_STABLE_VERSION;
  if (!version) {
    const res = await fetch(releaseFeedUrl);
    if (!res.ok) throw new Error(`GET ${releaseFeedUrl} failed: ${res.status}`);
    version = /^version:\s*(\S+)\s*$/m.exec(await res.text())?.[1];
    if (!version) throw new Error(`No version in ${releaseFeedUrl}`);
  }
  process.stdout.write(`Installing bb-app@${version} into ${binCacheDir}\n`);
  await run("npm", ["install", "--prefix", binCacheDir, `bb-app@${version}`, "--no-audit", "--no-fund"], { cwd: binCacheDir });
}

async function healthy(serverUrl) {
  try {
    return (await fetch(`${serverUrl}/health`)).ok;
  } catch {
    return false;
  }
}

async function rpc(serverUrl, pluginId, method, body) {
  const res = await fetch(`${serverUrl}/api/v1/plugins/${pluginId}/rpc/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${pluginId}.${method} failed: ${JSON.stringify(json)}`);
  return json.result;
}

async function stop() {
  const infoPath = join(stagedDir, "instance.json");
  if (existsSync(infoPath)) {
    try {
      const info = JSON.parse(readFileSync(infoPath, "utf8"));
      if (info.launcherPid) {
        try { process.kill(-info.launcherPid, "SIGTERM"); } catch {}
        try { process.kill(info.launcherPid, "SIGTERM"); } catch {}
        await sleep(500);
        try { process.kill(-info.launcherPid, "SIGKILL"); } catch {}
      }
    } catch {}
  }
  await rm(stagedDir, { recursive: true, force: true });
}

async function start() {
  const chosenPort = await pickPortPair(port || 0);
  const serverUrl = `http://127.0.0.1:${chosenPort}`;
  await mkdir(stagedDir, { recursive: true });
  await ensureBbApp();

  const log = await open(join(stagedDir, "launcher.log"), "a");
  const launcher = spawn(
    join(binDir, "bb-app"),
    ["--bundled", "--data-dir", dataDir, "--server-port", String(chosenPort), "--host-daemon-port", String(chosenPort + 1)],
    { cwd: stagedDir, detached: true, stdio: ["ignore", log.fd, log.fd], env: stagedEnv() },
  );
  await new Promise((res, rej) => {
    launcher.once("spawn", res);
    launcher.once("error", rej);
  });
  launcher.unref();
  await log.close();

  await writeFile(
    join(stagedDir, "instance.json"),
    JSON.stringify({ kind: "bb-ios-staged", directory: stagedDir, dataDir, port: chosenPort, serverUrl, launcherPid: launcher.pid }, null, 2),
  );

  const startedAt = Date.now();
  while (!(await healthy(serverUrl))) {
    if (Date.now() - startedAt > 90_000) {
      throw new Error(`Staged BB did not become healthy; see ${join(stagedDir, "launcher.log")}`);
    }
    await sleep(500);
  }

  const bbEnv = { BB_DATA_DIR: dataDir, BB_SERVER_URL: serverUrl };
  const bb = async (...args) => JSON.parse(await run(join(binDir, "bb"), [...args, "--json"], { envExtra: bbEnv, quiet: true }));

  await bb("settings", "general", "onboardingCompletedAt", new Date().toISOString());

  // Install Studio & Mobile plugins from this checkout (packages/*/dist is gitignored).
  const pluginsDir = join(repoRoot, "plugins");
  if (!existsSync(join(pluginsDir, "packages", "bb-studio", "node_modules"))) {
    process.stdout.write("Installing plugin workspace dependencies...\n");
    await run("pnpm", ["install", "--frozen-lockfile"], { cwd: pluginsDir });
  }
  for (const pkg of ["bb-studio", "bb-studio-mobile"]) {
    const pkgDir = join(pluginsDir, "packages", pkg);
    process.stdout.write(`Installing local ${pkg}...\n`);
    await run(join(binDir, "bb"), ["plugin", "install", pkgDir, "--yes"], { envExtra: bbEnv, quiet: true });
  }

  // Wait for Studio RPC to be ready after plugin install.
  const rpcStart = Date.now();
  while (true) {
    try {
      await rpc(serverUrl, "studio", "pages.tree", {});
      break;
    } catch {
      if (Date.now() - rpcStart > 30_000) break;
      await sleep(500);
    }
  }

  // Seed a tiny git project + demo thread + page + 3 mini apps.
  const projDir = join(stagedDir, "demo-project");
  await mkdir(projDir, { recursive: true });
  await writeFile(join(projDir, "README.md"), "# Staged QA Project\n\nSeeded for iOS staged UI tests.\n");
  await run("git", ["init", "-q"], { cwd: projDir, quiet: true });
  await run("git", ["add", "README.md"], { cwd: projDir, quiet: true });
  await run("git", ["-c", "user.name=Staged", "-c", "user.email=staged@example.test", "commit", "-qm", "Init"], { cwd: projDir, quiet: true });

  const [machine] = await bb("machine", "list");
  const project = await bb("project", "create", "--name", "Staged QA", "--root", projDir, "--machine", machine.id);
  const thread = await bb("thread", "spawn", "--project", project.id, "--title", "Staged QA Thread", "--prompt", "Staged QA sample thread.", "--send-at", "30d");

  let botId = "";
  try {
    const bot = await rpc(serverUrl, "studio", "bot_create", {
      name: "Staged Bot",
      avatar: "🤖",
      threadId: thread.id,
    });
    botId = bot?.id || bot?.bot?.id || "";
  } catch {}

  let pageId = "";
  try {
    const created = await rpc(serverUrl, "studio", "pages.create", {
      projectId: null,
      parentId: null,
      title: "Staged QA Page",
    });
    pageId = created?.page?.id || created?.id || "";
  } catch {}

  let miniIds = "";
  try {
    miniIds = (await run("python3", ["-I", join(iosRoot, "scripts", "seed-staged-minis.py"), serverUrl], { quiet: true })).trim();
  } catch {}

  const firstMini = miniIds.split(",").filter(Boolean)[0] || "";
  await writeFile(
    join(stagedDir, "capture.env"),
    [
      `export BB_SERVER_URL=${serverUrl}`,
      `export BB_DATA_DIR="${dataDir}"`,
      `export TEST_RUNNER_BBGO_QA_SERVER=${serverUrl}`,
      `export TEST_RUNNER_BBGO_QA_THREAD=${thread.id}`,
      botId ? `export TEST_RUNNER_BBGO_QA_BOT=${botId}` : "",
      pageId ? `export TEST_RUNNER_BBGO_QA_PAGE=${pageId}` : "",
      miniIds ? `export TEST_RUNNER_BBGO_QA_MINI_IDS=${miniIds}` : "",
      firstMini ? `export TEST_RUNNER_BBGO_QA_MINI=${firstMini}` : "",
    ].filter(Boolean).join("\n") + "\n",
  );
  process.stdout.write(`Staged BB ready at ${serverUrl} (bot=${botId || "none"}, thread=${thread.id}, page=${pageId || "none"}, minis=${miniIds || "none"})\n`);
}

const cmd = process.argv[2];
if (cmd === "start") {
  start().catch(async (err) => {
    console.error(err);
    await stop().catch(() => {});
    process.exit(1);
  });
} else if (cmd === "stop") {
  stop().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.error("Usage: staged-server.mjs <start|stop>");
  process.exit(2);
}
