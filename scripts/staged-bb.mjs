#!/usr/bin/env node
/**
 * Run a staged BB for README screenshots: the current stable BB on its own
 * data directory and ports, every plugin installed from GitHub at a pushed
 * commit the way users install them, and a seeded demo project. It never
 * touches ~/.bb or the BB you work in.
 *
 *   node scripts/staged-bb.mjs start [--ref <pushed commit>]
 *   . "$TMPDIR/bb-studio-staged/capture.env"
 *   node scripts/capture-plugin-screenshots.mjs --plugin studio-navigation
 *   node scripts/staged-bb.mjs stop
 *
 * BB_STAGED_DIR moves the instance (default $TMPDIR/bb-studio-staged) and
 * BB_STAGED_PORT picks its server port (default 48986); the host daemon and
 * the capture Chrome take the next two ports. stop deletes the directory, so
 * every start seeds the same state.
 */
import { spawn } from "node:child_process";
import { cp, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoSource = "git:github.com/patleeman/bb-studio";
const releaseFeedUrl = "https://github.com/get-bb/bb/releases/download/desktop-latest/latest-mac.yml";
const stagedDir = process.env.BB_STAGED_DIR ?? join(tmpdir(), "bb-studio-staged");
const port = Number(process.env.BB_STAGED_PORT ?? "48986");
const serverUrl = `http://127.0.0.1:${port}`;
const dataDir = join(stagedDir, "data");
const binDir = join(stagedDir, "bb-app", "node_modules", ".bin");
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

// Demo threads in the seeded project. Their first message is scheduled weeks
// out, so no agent runs and the sidebar shows the same rows every time.
const ORBIT_THREADS = [
  "Draft the ORBIT-42 release notes",
  "Review the launch checklist",
  "Plan the Friday release window",
];

// Drop the BB_* variables of the thread this script may run inside: BB_CLI and
// BB_HOST_DAEMON_PORT would send the CLI to the BB you work in.
function stagedEnv(extra) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("BB_")));
  return { ...env, PATH: `${binDir}:${process.env.PATH}`, ...extra };
}

function run(command, args, { cwd = stagedDir, quiet = false } = {}) {
  const env = stagedEnv({ BB_DATA_DIR: dataDir, BB_SERVER_URL: serverUrl });
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolvePromise(stdout);
      reject(new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout}`));
    });
    if (!quiet) child.stderr.pipe(process.stderr);
  });
}

const bb = async (...args) => JSON.parse(await run(join(binDir, "bb"), [...args, "--json"], { quiet: true }));

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
  const commit = (await run("git", ["rev-parse", ref], { cwd: repoRoot, quiet: true })).trim();
  const branches = await run("git", ["branch", "-r", "--contains", commit], { cwd: repoRoot, quiet: true });
  if (!/\borigin\/main\b/.test(branches)) {
    throw new Error(`${commit} isn't on origin/main yet. BB installs from GitHub, so push it first or pass --ref.`);
  }
  return commit;
}

async function start() {
  const refFlag = process.argv.indexOf("--ref");
  const ref = await pushedRef(refFlag >= 0 ? process.argv[refFlag + 1] : "HEAD");
  if (await healthy()) throw new Error(`Something already answers at ${serverUrl}. Run stop, or set BB_STAGED_PORT.`);
  await rm(stagedDir, { recursive: true, force: true });
  await mkdir(stagedDir, { recursive: true });

  const version = await stableVersion();
  process.stdout.write(`Installing bb-app ${version} in ${stagedDir}\n`);
  await run("npm", ["install", "--prefix", join(stagedDir, "bb-app"), `bb-app@${version}`, "--no-audit", "--no-fund"]);

  const log = await open(join(stagedDir, "launcher.log"), "a");
  const launcher = spawn(
    join(binDir, "bb-app"),
    ["--bundled", "--data-dir", dataDir, "--server-port", String(port), "--host-daemon-port", String(port + 1)],
    { cwd: stagedDir, detached: true, stdio: ["ignore", log.fd, log.fd], env: stagedEnv({ BB_TELEMETRY: "0" }) },
  );
  launcher.unref();
  await log.close();
  const started = Date.now();
  while (!(await healthy())) {
    if (Date.now() - started > 120000) throw new Error(`BB didn't start; see ${join(stagedDir, "launcher.log")}`);
    await sleep(1000);
  }
  process.stdout.write(`BB ${version} is running at ${serverUrl}\n`);

  // Install every plugin as users do, from this repository's Git source.
  const { plugins } = JSON.parse(await readFile(join(repoRoot, ".bb/plugins.json"), "utf8"));
  for (const { name } of plugins) {
    process.stdout.write(`Installing ${name} from ${repoSource}@${ref.slice(0, 7)}\n`);
    await run(join(binDir, "bb"), ["plugin", "install", `${repoSource}@${ref}`, "--plugin", name, "--yes"], { quiet: true });
  }
  // A plugin outside BB Studio, so captures can show that its rows stay. Copy
  // it first: a path install builds into the plugin directory.
  const forecastDir = join(stagedDir, "forecast");
  await cp(join(repoRoot, "scripts/capture/fixtures/forecast"), forecastDir, { recursive: true });
  await run(join(binDir, "bb"), ["plugin", "install", forecastDir, "--yes"], { quiet: true });

  // A demo project backed by its own small Git repository.
  const orbitDir = join(stagedDir, "orbit");
  await mkdir(orbitDir);
  await writeFile(join(orbitDir, "README.md"), "# Orbit\n\nThe ORBIT-42 release.\n");
  await run("git", ["init", "-q"], { cwd: orbitDir });
  await run("git", ["add", "README.md"], { cwd: orbitDir });
  await run("git", ["-c", "user.name=Staged", "-c", "user.email=staged@example.com", "commit", "-qm", "Start Orbit"], { cwd: orbitDir });
  const [machine] = await bb("machine", "list");
  const project = await bb("project", "create", "--name", "Orbit", "--root", orbitDir, "--machine", machine.id);
  const threads = [];
  for (const title of ORBIT_THREADS) {
    threads.push(await bb("thread", "spawn", "--project", project.id, "--title", title, "--prompt", `${title}.`, "--send-at", "30d"));
  }

  const envFile = join(stagedDir, "capture.env");
  await writeFile(
    envFile,
    [
      `export BB_DATA_DIR="${dataDir}"`,
      `export BB_SERVER_URL=${serverUrl}`,
      `export BB_CAPTURE_PROJECT_ID=${project.id}`,
      `export BB_CAPTURE_THREAD_ID=${threads[0].id}`,
      `export BB_CAPTURE_CDP_PORT=${port + 2}`,
      `export PATH="${binDir}:$PATH"`,
      "unset BB_CLI BB_HOST_DAEMON_PORT BB_THREAD_ID BB_PROJECT_ID BB_ENVIRONMENT_ID BB_THREAD_STORAGE",
      "",
    ].join("\n"),
  );
  process.stdout.write(`\nSeeded project Orbit (${project.id}). Point captures at it with:\n  . "${envFile}"\n`);
}

async function stop() {
  if (await healthy()) await run(join(binDir, "bb-app"), ["stop", "--data-dir", dataDir]);
  await rm(stagedDir, { recursive: true, force: true });
  process.stdout.write(`Stopped the staged BB and removed ${stagedDir}\n`);
}

const command = process.argv[2];
if (command === "start") await start();
else if (command === "stop") await stop();
else throw new Error("Usage: node scripts/staged-bb.mjs start [--ref <commit>] | stop");
