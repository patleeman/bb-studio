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

/**
 * A thread that asks a narrow question about Orbit's upload code with Explore
 * on. The code has more wrong with it than the question covers, so the reply
 * ends with an ::explore line of things noticed along the way. GPT-6.1-Sol
 * leaves the line out, and Claude Sonnet 5 sometimes drops its closing quote,
 * which BB then shows as text, so this keeps the first well-formed reply of
 * three and deletes the others. Smart reactions are off meanwhile, so the
 * reply ends with the rows alone.
 */
async function seedExploreThread(project, machine, orbitDir) {
  await bb("plugin", "config", "explore", "set", "explore", "true");
  await bb("plugin", "config", "emoji-react", "set", "smartReactions", "false");
  const replies = [];
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const thread = await bb(
        "thread", "spawn", "--project", project.id, "--machine", machine.id, "--environment", orbitDir,
        "--provider", "claude-code", "--model", "claude-sonnet-5", "--reasoning-level", "medium",
        "--title", "How does Orbit retry uploads?",
        "--prompt", "Read src/retry.ts and src/queue.ts. In one sentence: how many times does uploadWithRetry call upload before it gives up?",
      );
      await bb("thread", "wait", thread.id, "--timeout", "5m");
      const events = await bb("thread", "messages", thread.id);
      const reply = events.findLast((event) => event.type === "item/completed" && event.data.item.type === "agentMessage")?.data.item.text ?? "";
      if (/::explore\{items="[^"]+"\}\s*$/.test(reply)) {
        await bb("thread", "read", thread.id);
        return thread;
      }
      replies.push(reply);
      await bb("thread", "delete", thread.id, "--yes");
    }
  } finally {
    await bb("plugin", "config", "emoji-react", "set", "smartReactions", "true");
  }
  throw new Error(`No retry reply ended with a well-formed ::explore line:\n${replies.join("\n---\n")}`);
}

/**
 * Studio Teams' README fixture (packages/bb-studio-teams/docs/QA.md): four
 * bots, a Launch room where Atlas and Scribe give the fixed replies their
 * missions spell out, a Design review channel, a paused automation, and
 * Atlas's memory of the launch.
 */
async function seedTeams(machine) {
  const teams = join(fixturesDir, "teams");
  const profile = ["--provider", "codex", "--model", "gpt-6-luna", "--reasoning", "low", "--interval", "0", "--machine", machine.id];
  await bb("bots", "create", "Atlas", "--description", "Research and verify the facts", "--avatar", "🧭", ...profile, "--mission-file", join(teams, "atlas-mission.md"));
  await bb("bots", "create", "Scribe", "--description", "Record decisions and next steps", "--avatar", "📝", ...profile, "--mission-file", join(teams, "scribe-mission.md"));
  await bb("bots", "create", "Quinn", "--description", "Review designs for clarity", "--avatar", "🎨", ...profile, "--mission", "Review designs for the owner.");
  await bb("bots", "create", "Relay", "--description", "Hand work between threads", "--avatar", "📡", ...profile, "--mission", "Hand work between threads for the owner.");
  await bb("bots", "memory", "atlas", "--text", "# Memory\n\n- ORBIT-42 ships in the Friday release window.\n- Scribe owns the release-check log.\n");
  const { bots } = await pluginRpc("bot-teams", "list", null);
  const member = handle => ({kind:"bot",id:bots.find(b=>b.handle===handle).id});
  const launch = await pluginRpc("bot-teams", "viewCreate", {name:"Launch work",members:[member("atlas"),member("scribe")],requestId:crypto.randomUUID()});
  await pluginRpc("bot-teams", "viewCreate", {name:"Design review",members:[member("quinn")],requestId:crypto.randomUUID()});
  const send = text => pluginRpc("bot-teams","viewSend",{id:launch.id,text,targets:[],requestId:crypto.randomUUID()});
  const replied = start => async () => (await pluginRpc("bot-teams","view",{id:launch.id})).entries.some(e=>e.role==="assistant"&&e.text.startsWith(start));
  await send("@atlas @scribe Here's the ORBIT-42 launch brief. The owner is Atlas, Scribe keeps the release-check log, and release is Friday. Are you both ready?");
  await until("Atlas to read the brief",replied("Ready. I checked the brief"));
  await until("Scribe to read the brief",replied("Ready. I'll keep the decision log"));
  await send("@atlas Please run the release check.");
  await until("Atlas release check",replied("Release check passed:"));
  await send("@scribe Atlas asks you to log the release check.");
  await until("Scribe release log",replied("Logged: release check passed."));

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
  // Code for the Explore thread to read, with more in it than the question asks about.
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
  const exploreThread = !capturePlugin || capturePlugin === "explore"
    ? await seedExploreThread(project, machine, orbitDir) : null;
  if (!capturePlugin || capturePlugin === "bot-teams") await seedTeams(machine);

  const envFile = join(stagedDir, "capture.env");
  await writeFile(
    envFile,
    [
      `export BB_DATA_DIR="${dataDir}"`,
      `export BB_SERVER_URL=${serverUrl}`,
      `export BB_CAPTURE_PROJECT_ID=${project.id}`,
      `export BB_CAPTURE_THREAD_ID=${threads[0].id}`,
      "unset BB_CAPTURE_SMART_REACTIONS_THREAD_ID BB_CAPTURE_WORKSPACE_THREAD_ID BB_CAPTURE_EXPLORE_THREAD_ID",
      ...(smartReactionsThread ? [
        `export BB_CAPTURE_SMART_REACTIONS_THREAD_ID=${smartReactionsThread.id}`,
        `export BB_CAPTURE_WORKSPACE_THREAD_ID=${smartReactionsThread.id}`,
      ] : []),
      ...(exploreThread ? [`export BB_CAPTURE_EXPLORE_THREAD_ID=${exploreThread.id}`] : []),
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
