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

async function pluginRpc(pluginId, method, input) {
  const response = await fetch(`${serverUrl}/api/v1/plugins/${pluginId}/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? `${pluginId}/${method} failed`);
  return payload.result;
}

async function until(what, check, timeoutMs = 300000) {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(3000);
  }
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
  const commit = (await run("git", ["rev-parse", ref], { cwd: repoRoot, quiet: true })).trim();
  const branches = await run("git", ["branch", "-r", "--contains", commit], { cwd: repoRoot, quiet: true });
  if (!/\borigin\/main\b/.test(branches)) {
    throw new Error(`${commit} isn't on origin/main yet. BB installs from GitHub, so push it first or pass --ref.`);
  }
  return commit;
}

/**
 * A thread that asks "SQLite or Postgres?" with smart reactions on, so its
 * reply ends with suggested reactions. Running it also gives the thread a
 * workspace in the Orbit repository, where the artifact capture stages its
 * report. GPT-6-Luna leaves the reactions out, so this uses GPT-6.1-Sol.
 */
async function seedSmartReactionsThread(project, machine, orbitDir) {
  await bb("plugin", "config", "emoji-react", "set", "smartReactions", "true");
  const thread = await bb(
    "thread", "spawn", "--project", project.id, "--machine", machine.id, "--environment", orbitDir,
    "--provider", "codex", "--model", "gpt-6.1-sol", "--reasoning-level", "low",
    "--title", "Pick a database for the todo app",
    "--prompt", "I'm building a small todo app just for me. Should it store its data in SQLite or Postgres? Give me two short sentences on the trade-off, then ask me which one I want.",
  );
  await bb("thread", "wait", thread.id, "--timeout", "5m");
  const events = await bb("thread", "messages", thread.id);
  const reply = events.findLast((event) => event.type === "item/completed" && event.data.item.type === "agentMessage")?.data.item.text ?? "";
  if (!/::reactions\{[^}]*SQLite[^}]*Postgres/.test(reply)) throw new Error(`The SQLite or Postgres reply has no smart reactions: ${reply}`);
  await bb("thread", "read", thread.id);
  return thread;
}

/** The Command view's deterministic fixture, in ordinary BB threads. */
async function seedCommand(machine, project) {
  const commandFixtures = join(fixturesDir, "command");
  const makeThread = async (name, mission) => {
    const text = await readFile(join(commandFixtures, mission), "utf8");
    // Seed standing context as agent-only input so native transcripts show the conversation.
    const response = await fetch(`${serverUrl}/api/v1/threads`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id, origin: "app", environment: { type: "project-default" },
        providerId: "codex", model: "gpt-6-luna", reasoningLevel: "low",
        input: [
          { type: "text", text: "Join the ORBIT-42 launch check.", mentions: [] },
          { type: "text", visibility: "agent-only", mentions: [], text: text + "\n\nFor this initial setup message, reply only Ready to work. Do not use tools or change files." },
        ],
      }),
    });
    const thread = await response.json();
    if (!response.ok || !thread.id) throw new Error(`Could not seed ${name}: ${JSON.stringify(thread)}`);
    await bb("thread", "wait", thread.id, "--timeout", "180s");
    // After the first reply, so BB's automatic title can't replace it.
    const renamed = await fetch(`${serverUrl}/api/v1/threads/${thread.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: name }),
    });
    if (!renamed.ok) throw new Error(`Could not name the ${name} fixture`);
    return thread.id;
  };
  const atlas = await makeThread("Atlas", "atlas-mission.md");
  const scribe = await makeThread("Scribe", "scribe-mission.md");
  const spaceId = await seedSpace("Launch work", [atlas, scribe]);
  await seedLaunch(spaceId, atlas, scribe);
  // BB's automatic title can land after the first rename; name them again.
  for (const [id, name] of [[atlas, "Atlas"], [scribe, "Scribe"]]) {
    const renamed = await fetch(`${serverUrl}/api/v1/threads/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: name }),
    });
    if (!renamed.ok) throw new Error(`Could not name the ${name} fixture`);
  }
}

/** A Studio Space holding these threads, the first one its lead. */
async function seedSpace(name, threadIds) {
  const { space } = await pluginRpc("studio", "createSpace", {name});
  await pluginRpc("studio", "spaceMembers", {id:space.id, add:threadIds.map(id => ({pluginId:"bb-thread", id}))});
  await pluginRpc("studio", "space_set_lead", {spaceId:space.id, threadId:threadIds[0]});
  return space.id;
}

/** The Launch work conversation, sent from its Command view: each thread's fixed reply, from its instructions. */
async function seedLaunch(spaceId, atlas, scribe) {
  const send = (threadIds, text) => pluginRpc("studio","commandSend",{spaceId,threadIds,text});
  const replied = start => async () => (await pluginRpc("studio","commandFeed",{spaceId})).entries.some(e=>e.role==="assistant"&&e.text.startsWith(start));
  // Each reply takes 10 to 20 seconds when the turn works.
  const timeout = 180000;
  await send([atlas, scribe], "@atlas @scribe Here's the ORBIT-42 launch brief. The owner is Atlas, Scribe keeps the release-check log, and release is Friday. Are you both ready?");
  await until("Atlas to read the brief",replied("Ready. I checked the brief"),timeout);
  await until("Scribe to read the brief",replied("Ready. I'll keep the decision log"),timeout);
  await send([atlas], "Please run the release check.");
  await until("Atlas release check",replied("Release check passed:"),timeout);
  await send([scribe], "@scribe Atlas asks you to log the release check.");
  await until("Scribe release log",replied("Logged: release check passed."),timeout);
}

async function start() {
  const { plugins } = JSON.parse(await readFile(join(repoRoot, ".bb/plugins.json"), "utf8"));
  const pluginFlag = process.argv.indexOf("--plugin");
  const capturePlugin = pluginFlag >= 0 ? process.argv[pluginFlag + 1] : null;
  if (pluginFlag >= 0 && !plugins.some(({ name }) => name === capturePlugin)) throw new Error("Use --plugin with an installed plugin ID from .bb/plugins.json.");
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
  const smartReactionsThread = !capturePlugin || ["emoji-react", "artifacts"].includes(capturePlugin)
    ? await seedSmartReactionsThread(project, machine, orbitDir) : null;
  if (!capturePlugin || capturePlugin === "studio") await seedCommand(machine, project);

  const envFile = join(stagedDir, "capture.env");
  await writeFile(
    envFile,
    [
      `export BB_DATA_DIR="${dataDir}"`,
      `export BB_SERVER_URL=${serverUrl}`,
      `export BB_CAPTURE_PROJECT_ID=${project.id}`,
      `export BB_CAPTURE_THREAD_ID=${threads[0].id}`,
      "unset BB_CAPTURE_SMART_REACTIONS_THREAD_ID BB_CAPTURE_WORKSPACE_THREAD_ID",
      ...(smartReactionsThread ? [
        `export BB_CAPTURE_SMART_REACTIONS_THREAD_ID=${smartReactionsThread.id}`,
        `export BB_CAPTURE_WORKSPACE_THREAD_ID=${smartReactionsThread.id}`,
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
  if (await healthy()) await run(join(binDir, "bb-app"), ["stop", "--data-dir", dataDir]);
  await rm(stagedDir, { recursive: true, force: true });
  process.stdout.write(`Stopped the staged BB and removed ${stagedDir}\n`);
}

const command = process.argv[2];
if (command === "start") await start();
else if (command === "stop") await stop();
else throw new Error("Usage: node scripts/staged-bb.mjs start [--ref <commit>] [--plugin <id>] | stop");
