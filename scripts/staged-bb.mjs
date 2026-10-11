#!/usr/bin/env node
/**
 * Run a staged BB for README screenshots: the current stable BB on its own
 * data directory and ports, every plugin installed from GitHub at a pushed
 * commit the way users install them, and seeded demo data. It never touches
 * ~/.bb or the BB you work in. Some fixtures are real agent replies on small
 * models, using this machine's Codex sign-in, so start takes a few minutes.
 *
 *   node scripts/staged-bb.mjs start [--ref <pushed commit>] [--plugin <id>]
 *   . "$TMPDIR/bb-studio-staged/capture.env"
 *   node scripts/capture-plugin-screenshots.mjs --plugin thread-list-plus
 *   node scripts/staged-bb.mjs stop
 *
 * BB_STAGED_DIR moves the instance (default $TMPDIR/bb-studio-staged) and
 * BB_STAGED_PORT picks its server port (default 48986); the host daemon and
 * the capture Chrome take the next two ports. stop deletes the directory, so
 * every start seeds the same state.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoSource = "git:github.com/patleeman/bb-studio";
const releaseFeedUrl = "https://github.com/get-bb/bb/releases/download/desktop-latest/latest-mac.yml";
const stagedDir = resolve(process.env.BB_STAGED_DIR || join(tmpdir(), "bb-studio-staged"));
// start and stop delete stagedDir: refuse anything that holds the repository,
// the home directory, the current directory, or the BB you work in.
{
  const within = (child, parent) => !relative(parent, child).startsWith("..") && !relative(parent, child).startsWith(sep);
  const realBB = join(homedir(), ".bb");
  const unsafe = [repoRoot, homedir(), process.cwd()].some((path) => within(path, stagedDir)) || within(stagedDir, realBB);
  if (unsafe || stagedDir === dirname(stagedDir)) throw new Error(`Refusing to use ${stagedDir} as BB_STAGED_DIR: it would delete the repository, your home directory, or ~/.bb.`);
}
const port = Number(process.env.BB_STAGED_PORT ?? "48986");
if (!Number.isInteger(port) || port < 1024 || port > 65533) throw new Error(`BB_STAGED_PORT must be a port from 1024 to 65533, not ${process.env.BB_STAGED_PORT}`);
const serverUrl = `http://127.0.0.1:${port}`;
const dataDir = join(stagedDir, "data");
const binDir = join(stagedDir, "bb-app", "node_modules", ".bin");
const fixturesDir = join(repoRoot, "scripts/capture/fixtures");
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

/** Whether nothing listens on 127.0.0.1:port, so the staged BB can't reach another server. */
function portFree(candidate) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", () => resolvePromise(false));
    server.listen(candidate, "127.0.0.1", () => server.close(() => resolvePromise(true)));
  });
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

/**
 * A thread that asks "SQLite or Postgres?", so its reply ends with Pages'
 * Next row offering both as quick replies. Running it also gives the thread a
 * workspace in the Orbit repository, where the artifact capture stages its
 * report. GPT-6-Luna leaves the quick replies out, so this uses GPT-6.1-Sol.
 * The Next row is optional for the model, and on low reasoning it sometimes
 * skips it, so the prompt asks for it and a reply without it is retried in a
 * fresh thread; only the thread with the row is kept.
 */
async function seedWorkspaceThread(project, machine, orbitDir) {
  const attempts = 3;
  const replies = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const thread = await bb(
      "thread", "spawn", "--project", project.id, "--machine", machine.id, "--environment", orbitDir,
      "--provider", "codex", "--model", "gpt-6.1-sol", "--reasoning-level", "low",
      "--title", "Pick a database for the todo app",
      "--prompt", "I'm building a small todo app just for me. Should it store its data in SQLite or Postgres? Give me two short sentences on the trade-off, then ask me which one I want, and end with the Next row offering SQLite and Postgres as quick replies.",
    );
    await bb("thread", "wait", thread.id, "--timeout", "5m");
    const events = await bb("thread", "messages", thread.id);
    const reply = events.findLast((event) => event.type === "item/completed" && event.data.item.type === "agentMessage")?.data.item.text ?? "";
    if (/::next\{[^}]*SQLite[^}]*Postgres/.test(reply)) {
      await bb("thread", "read", thread.id);
      return thread;
    }
    replies.push(reply);
    process.stdout.write(`The SQLite or Postgres reply has no Next row quick replies (attempt ${attempt} of ${attempts})\n`);
    await bb("thread", "archive", thread.id).catch(() => {});
  }
  throw new Error(`The SQLite or Postgres reply had no Next row quick replies in ${attempts} attempts. Last reply: ${replies.at(-1)}`);
}

async function start() {
  const { plugins } = JSON.parse(await readFile(join(repoRoot, ".bb/plugins.json"), "utf8"));
  const pluginFlag = process.argv.indexOf("--plugin");
  const capturePlugin = pluginFlag >= 0 ? process.argv[pluginFlag + 1] : null;
  if (pluginFlag >= 0 && !plugins.some(({ name }) => name === capturePlugin)) throw new Error("Use --plugin with an installed plugin ID from .bb/plugins.json.");
  const refFlag = process.argv.indexOf("--ref");
  const ref = await pushedRef(refFlag >= 0 ? process.argv[refFlag + 1] : "HEAD");
  if (await healthy()) throw new Error(`Something already answers at ${serverUrl}. Run stop, or set BB_STAGED_PORT.`);
  // Anything else on these ports (another BB that rejects /health, a Chrome
  // with remote debugging) would receive the staged CLI calls and captures.
  for (const candidate of [port, port + 1, port + 2]) {
    if (!(await portFree(candidate))) throw new Error(`Port ${candidate} is in use. Set BB_STAGED_PORT to a free range of three ports.`);
  }
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
  // From here a failure or Ctrl-C stops the staged BB instead of leaving it
  // running; the directory stays for launcher.log until stop.
  const stopLaunched = async () => {
    await run(join(binDir, "bb-app"), ["stop", "--data-dir", dataDir], { quiet: true }).catch(() => {});
  };
  const interrupted = async () => {
    await stopLaunched();
    process.exit(130);
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    await seed({ plugins, capturePlugin, ref, version });
  } catch (error) {
    process.stderr.write(`Start failed; stopping the staged BB. Logs: ${join(stagedDir, "launcher.log")}\n`);
    await stopLaunched();
    throw error;
  } finally {
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
  }
}

async function seed({ plugins, capturePlugin, ref, version }) {
  const started = Date.now();
  while (!(await healthy())) {
    if (Date.now() - started > 120000) throw new Error(`BB didn't start; see ${join(stagedDir, "launcher.log")}`);
    await sleep(1000);
  }
  process.stdout.write(`BB ${version} is running at ${serverUrl}\n`);
  // BB 0.46+ opens a first-run setup guide over every page of a new install;
  // a fixture is set up already.
  await bb("settings", "general", "onboardingCompletedAt", new Date().toISOString());

  // Install every plugin as users do, from this repository's Git source.
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
  // Code for staged agent threads to read.
  await cp(join(fixturesDir, "orbit"), join(orbitDir, "src"), { recursive: true });
  await run("git", ["init", "-q"], { cwd: orbitDir });
  await run("git", ["add", "README.md", "src"], { cwd: orbitDir });
  await run("git", ["-c", "user.name=Staged", "-c", "user.email=staged@example.com", "commit", "-qm", "Start Orbit"], { cwd: orbitDir });
  const [machine] = await bb("machine", "list");
  const project = await bb("project", "create", "--name", "Orbit", "--root", orbitDir, "--machine", machine.id);
  const threads = [];
  for (const title of ORBIT_THREADS) {
    threads.push(await bb("thread", "spawn", "--project", project.id, "--title", title, "--prompt", `${title}.`, "--send-at", "30d"));
  }

  // Talk's meeting notes and Studio Decisions fall back to this model.
  await bb("smart-decisions", "fallback", "codex", "gpt-6-luna", "low");
  process.stdout.write(`Seeding fixtures${capturePlugin ? ` for ${capturePlugin}` : " for the suite"}\n`);
  const workspaceThread = !capturePlugin || capturePlugin === "studio" || capturePlugin === "artifacts"
    ? await seedWorkspaceThread(project, machine, orbitDir) : null;

  const envFile = join(stagedDir, "capture.env");
  await writeFile(
    envFile,
    [
      `export BB_DATA_DIR="${dataDir}"`,
      `export BB_SERVER_URL=${serverUrl}`,
      `export BB_CAPTURE_PROJECT_ID=${project.id}`,
      `export BB_CAPTURE_THREAD_ID=${threads[0].id}`,
      "unset BB_CAPTURE_WORKSPACE_THREAD_ID",
      ...(workspaceThread ? [
        `export BB_CAPTURE_WORKSPACE_THREAD_ID=${workspaceThread.id}`,
      ] : []),
      "unset BB_CAPTURE_ONLY BB_CAPTURE_PLUGIN",
      ...(capturePlugin ? [`export BB_CAPTURE_PLUGIN=${capturePlugin}`] : []),
      `export BB_CAPTURE_CDP_PORT=${port + 2}`,
      `export PATH="${binDir}:$PATH"`,
      "unset BB_CLI BB_HOST_DAEMON_PORT BB_THREAD_ID BB_PROJECT_ID BB_ENVIRONMENT_ID BB_THREAD_STORAGE",
      "",
    ].join("\n"),
  );
  process.stdout.write(`\nSeeded project Orbit (${project.id}). Point captures at it with:\n  . "${envFile}"\n`);
}

async function stop() {
  // Stop even when /health doesn't answer (still starting, or wedged), so
  // deleting the directory can't orphan a running BB.
  if (existsSync(join(binDir, "bb-app"))) {
    try {
      await run(join(binDir, "bb-app"), ["stop", "--data-dir", dataDir]);
    } catch (error) {
      if (await healthy()) throw error;
    }
  }
  await rm(stagedDir, { recursive: true, force: true });
  process.stdout.write(`Stopped the staged BB and removed ${stagedDir}\n`);
}

const command = process.argv[2];
if (command === "start") await start();
else if (command === "stop") await stop();
else throw new Error("Usage: node scripts/staged-bb.mjs start [--ref <commit>] [--plugin <id>] | stop");
