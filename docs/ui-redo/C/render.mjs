#!/usr/bin/env node
/**
 * Before and after renders for the Bot UI redo (REDO.md), from a staged BB.
 * It reuses the README capture setups (scripts/capture/captures/bb-studio-bot*.mjs)
 * and adds a few views they don't cover, then saves each one in dark and
 * light mode as docs/ui-redo/C/<label>/<view>-<scheme>.png.
 *
 *   BB_STAGED_DIR=$TMPDIR/bb-studio-staged-<you> BB_STAGED_PORT=<port> node scripts/staged-bb.mjs start
 *   . "$BB_STAGED_DIR/capture.env"
 *   node docs/ui-redo/C/render.mjs before [view,...]
 *
 * The Move to machine views stub bot_runner_machines and bot_runner_preflight
 * in the page (a staged BB has no second machine), so the dialog's
 * pre-flight states can be seen without one.
 */
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCapture } from "../../../scripts/capture/lifecycle.mjs";
import { CdpClient, ensureChrome } from "../../../scripts/capture/driver.mjs";
import { projectId, threadId, pluginRpc, bbCli, sleep } from "../../../scripts/capture/bb.mjs";
import { BOT_PATH, SIDEBAR, botFixtures, dismissProblems } from "../../../scripts/capture/captures/bb-studio-bot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
if (!label) throw new Error("Usage: node docs/ui-redo/C/render.mjs <before|after> [view,...]");
const only = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
if (!projectId || !threadId) throw new Error("Source the staged BB's capture.env first.");

const context = { projectId, threadId, pluginRpc, bbCli, sleep };
const fixtures = botFixtures(context);
const readme = new Map(fixtures.captures.map((capture) => [capture.id, capture.setup]));

const size = (client, width, height, scale = 1) => client.command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
const scheme = (client, value, motion = "no-preference") => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }, { name: "prefers-reduced-motion", value: motion }] });

const openInfo = async (client) => {
  await client.evaluate(`(() => { document.querySelector('${SIDEBAR} [data-testid=bot-main] + [data-testid=bot-info]').click(); return true; })()`);
  await client.waitForSelector('[aria-label="Dot info"]', 30000);
};
const scrollTo = (client, selector) => client.evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) throw new Error("Nothing at ${selector.replace(/"/g, "'")}");
  el.scrollIntoView({ block: "start" });
  return true;
})()`);

/** Replaces the two machine RPCs in the page with `preflight`'s answer. */
const stubMachines = (client, preflight) => client.evaluate(`(() => {
  const machines = [{ id: "host_mini", name: "Mac mini", connected: true }, { id: "host_red4", name: "red4", connected: false }];
  const preflight = ${JSON.stringify(preflight)};
  const real = window.__realFetch ?? window.fetch;
  window.__realFetch = real;
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const reply = (data) => new Response(JSON.stringify({ ok: true, result: data, data }), { headers: { "content-type": "application/json" } });
    if (url.includes("/rpc/bot_runner_machines")) return reply(machines);
    if (url.includes("/rpc/bot_runner_preflight")) return reply(preflight);
    return real(input, init);
  };
  return true;
})()`);

const runnersView = async (client) => {
  await fixtures.seededRunners();
  await client.navigate(BOT_PATH);
  await client.waitForSelector(SIDEBAR, 30000);
  await dismissProblems(client);
  await openInfo(client);
  await client.waitForSelector('[data-testid="bot-runners"] [data-runner]', 60000);
  await scrollTo(client, '[data-testid="bot-runners"]');
  await sleep(1200);
};

const moveDialog = (preflight) => async (client) => {
  await runnersView(client);
  await stubMachines(client, preflight);
  await client.evaluate(`(() => {
    const button = [...document.querySelectorAll('[data-testid="bot-runners"] button')].find((each) => /Move to machine/.test(each.textContent) || /Move to machine/.test(each.getAttribute("aria-label") ?? ""));
    if (!button) throw new Error("No Move to machine action");
    button.click();
    return true;
  })()`);
  await client.waitForSelector('[role="dialog"]', 15000);
  // Pick the Mac mini, so the dialog asks for its pre-flight.
  await client.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const select = dialog.querySelector('select[aria-label="Machine"]');
    if (select) {
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      set.call(select, "host_mini");
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    const option = dialog.querySelector('[role="radio"][data-machine="host_mini"]');
    if (!option) throw new Error("No machine picker in the dialog");
    option.click();
    return true;
  })()`);
  await sleep(1500);
};

/** Answers `method` with `data` in every page from now on; returns the cleanup. */
const stubOnLoad = async (client, method, data) => {
  const { identifier } = await client.command("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const real = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/rpc/${method}")) return new Response(JSON.stringify({ ok: true, result: ${JSON.stringify(data)}, data: ${JSON.stringify(data)} }), { headers: { "content-type": "application/json" } });
      return real(input, init);
    };
  })()` });
  return () => client.command("Page.removeScriptToEvaluateOnNewDocument", { identifier });
};

/**
 * Maintenance on, in its first day's dry run, with one finished run. Stubbed:
 * stable BB 0.47 stops a real dry run ("sdk.environments.pullRequest is not a
 * function"), so a staged run has nothing to show.
 */
const maintenanceView = async (client) => {
  await fixtures.seededBot();
  const { bot } = await pluginRpc("studio", "bot_get", {});
  const now = Date.now();
  const cleanup = await stubOnLoad(client, "bot_maintenance_get", {
    settings: { enabled: true, enabledAt: now - 2 * 3600_000, memoryWords: 8000, rules: { threads: true, workers: true, automations: true, memory: false, skills: true, adopt: true } },
    liveAt: now + 22 * 3600_000,
    runs: [{
      at: now - 2 * 3600_000, dryRun: true,
      summary: "Dry run: would archive 2 finished threads, 1 worker; Skills: Nothing to retire",
      actions: ["Archive thread: Summarize this week's ORBIT-42 threads", "Archive thread: Check the launch checklist for blockers", "Archive worker: Pull the ORBIT-42 thread digests", "Skills: Nothing to retire"],
      needsCall: [{ threadId: bot.threadId, title: "Draft Monday's status update", reason: "Uncommitted changes to 1 tracked file." }],
      suggestions: [{ text: "Consider adopting Review the launch checklist as a runner", threadId: bot.threadId, automationId: "auto_stub" }],
    }],
  });
  await client.navigate(`${BOT_PATH}/${bot.id}`);
  await client.waitForSelector('[data-testid="bot-maintenance"]', 30000);
  await dismissProblems(client);
  await client.evaluate(`(() => {
    const section = document.querySelector('[data-testid="bot-maintenance"]');
    for (const toggle of section.querySelectorAll('details, button[aria-expanded="false"]')) { if (toggle.tagName === "DETAILS") toggle.open = true; else toggle.click(); }
    return true;
  })()`);
  await sleep(500);
  await scrollTo(client, '[data-testid="bot-maintenance"]');
  await sleep(800);
  return cleanup;
};

/** The warnings' confirmation, after Move runner. */
const moveConfirm = (preflight) => async (client) => {
  await moveDialog(preflight)(client);
  await client.evaluate(`(() => {
    const button = [...document.querySelectorAll('[role="dialog"] button')].find((each) => each.textContent.trim() === "Move runner");
    if (!button) throw new Error("No Move runner button");
    button.click();
    return true;
  })()`);
  await client.waitForText("Move anyway", 10000);
  await sleep(800);
};

/** A runner whose every run takes ten minutes, so it can be seen mid-run. Its first run starts when it's made. */
const RELEASE_WATCH = { name: "Release watch", job: "Use the shell to run `sleep 600`. Then finish without any message and without calling runner_report.", schedule: { cadence: "hourly", time: "09:00" } };

/** A thread the Bot started that runs for ten minutes, so Running has a thread that's really running. */
const CANARY = { title: "Watch the ORBIT-42 canary", prompt: "Use the shell to run `sleep 600`, then reply in one sentence that the canary looks healthy." };
const isRunning = (status) => ["starting", "active"].includes(status);
const runningCanary = async () => {
  const { bot } = await pluginRpc("studio", "bot_get", {});
  const kids = await fixtures.json(["thread", "list", "--parent-thread", bot.threadId, "--include-hidden"]).catch(() => []);
  const canary = kids.find((thread) => thread.title === CANARY.title);
  const status = async (id) => (await fixtures.json(["thread", "show", id]).catch(() => null))?.thread?.status;
  if (canary && isRunning(await status(canary.id))) return;
  const project = (await fixtures.json(["thread", "show", bot.threadId])).thread.projectId;
  const made = canary
    ? (await bbCli(["thread", "tell", canary.id, CANARY.prompt]), canary)
    : await fixtures.json(["thread", "spawn", "--project", project, "--parent-thread", bot.threadId, "--title", CANARY.title, "--prompt", CANARY.prompt]);
  const id = made.id ?? made.thread?.id;
  for (let i = 0; !isRunning(await status(id)); i++) {
    if (i > 120) throw new Error("The canary thread didn't start");
    await sleep(500);
  }
};

/** The Bots list with a thread running and Release watch mid-run, for the running states. */
const runningView = async (client) => {
  // Not the README setup: it waits for every runner to go idle.
  await fixtures.seededBot();
  await runningCanary();
  await client.navigate(BOT_PATH);
  await client.waitForSelector(SIDEBAR, 30000);
  await dismissProblems(client);
  const { runners } = await pluginRpc("studio", "bot_runners", {});
  const watch = runners.find((runner) => runner.name === RELEASE_WATCH.name) ?? await pluginRpc("studio", "bot_runner_create", RELEASE_WATCH);
  const status = async () => (await fixtures.json(["thread", "show", watch.threadId]).catch(() => null))?.thread?.status;
  if (!isRunning(await status())) await pluginRpc("studio", "bot_runner_run_now", { id: watch.id });
  for (let i = 0; !isRunning(await status()); i++) {
    if (i > 60) throw new Error("Release watch didn't start its run");
    await sleep(500);
  }
  // The list polls every 15 s; let it see the run.
  await sleep(16_000);
  await scrollTo(client, SIDEBAR);
};
const sidebarClip = async (client) => {
  const rect = await client.evaluate(`(() => { const r = document.querySelector('${SIDEBAR}').getBoundingClientRect(); return { x: r.x, y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 560) }; })()`);
  return rect;
};

const PREFLIGHT = { machine: "host_mini", machineName: "Mac mini", providerName: "Codex", signInHint: null, install: false, blocked: null, warnings: [] };
const VIEWS = {
  // The README captures, as they are.
  // The whole window: the sidebar, and the chat's header (cache time, Bot info).
  sidebar: { setup: readme.get("studio-bot"), width: 1440, height: 1200 },
  info: { setup: readme.get("studio-bot-info"), width: 1440, height: 560 },
  "profile-changes": { setup: readme.get("studio-bot-profile-changes"), width: 1440, height: 560 },
  "profile-edit": { setup: readme.get("studio-bot-profile-edit"), width: 1440, height: 650 },
  maintenance: { setup: maintenanceView, width: 1440, height: 900 },
  skills: { setup: readme.get("studio-bot-skills"), width: 1440, height: 700 },
  // Views the README captures don't show.
  runners: { setup: runnersView, width: 1440, height: 700 },
  // Running now vs scheduled, at 2x: the Bots list, and the same under reduced motion.
  running: { setup: runningView, width: 1440, height: 1200, scale: 2, clip: sidebarClip, gif: true },
  "running-reduced-motion": { setup: runningView, width: 1440, height: 1200, scale: 2, clip: sidebarClip, motion: "reduce" },
  // The pre-flight's own messages (src/runner-machines.ts).
  "move-ready": { setup: moveDialog({ ...PREFLIGHT, warnings: ["Path does not exist on Mac mini: ~/Projects/orbit/status.md", "Mac-only tool may be unavailable on Mac mini: osascript"] }), width: 1440, height: 800 },
  "move-confirm": { setup: moveConfirm({ ...PREFLIGHT, warnings: ["Path does not exist on Mac mini: ~/Projects/orbit/status.md", "Mac-only tool may be unavailable on Mac mini: osascript"] }), width: 1440, height: 800 },
  "move-install": { setup: moveDialog({ ...PREFLIGHT, install: true, blocked: "Install Codex on Mac mini" }), width: 1440, height: 800 },
  "move-signin": { setup: moveDialog({ ...PREFLIGHT, blocked: "Codex needs sign-in on Mac mini. codex login", signInHint: "codex login" }), width: 1440, height: 800 },
};

const outDir = join(here, label);
await mkdir(outDir, { recursive: true });
const { webSocketUrl, process: chromeProcess, profileDir } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
const failures = [];
try {
  await client.connect();
  for (const [name, view] of Object.entries(VIEWS)) {
    if (only && !only.has(name)) continue;
    for (const mode of ["dark", "light"]) {
      process.stdout.write(`${name} (${mode})… `);
      await size(client, view.width, view.height, view.scale);
      await scheme(client, mode, view.motion);
      try {
        await runCapture(client, async (c) => {
          const cleanup = await view.setup(c);
          // Setups resize the page; the scheme stays. Staging's plugin-problem card can come back over the sidebar.
          if (view.scale) await size(c, view.width, view.height, view.scale);
          await scheme(c, mode, view.motion);
          await dismissProblems(c);
          await sleep(400);
          return cleanup;
        }, async () => {
          const file = join(outDir, `${name}-${mode}.png`);
          const clip = typeof view.clip === "function" ? await view.clip(client) : view.clip;
          await client.capture(file, clip);
          process.stdout.write(`${resolve(file)}\n`);
          // The running arc's motion over about 5 s, as a GIF. Each frame keeps
          // the time it was on screen, so the turn plays at its real speed.
          if (view.gif && mode === "dark") {
            const frames = join(tmpdir(), `bot-running-frames-${process.pid}`);
            await mkdir(frames, { recursive: true });
            const shots = [];
            const end = Date.now() + 5000;
            while (Date.now() < end) {
              const frame = join(frames, `${String(shots.length).padStart(3, "0")}.png`);
              await client.capture(frame, clip);
              shots.push({ frame, at: Date.now() });
            }
            const list = shots.map((shot, i) => `file '${shot.frame}'\nduration ${(((shots[i + 1]?.at ?? shot.at + 80) - shot.at) / 1000).toFixed(3)}`).join("\n");
            await writeFile(join(frames, "list.txt"), `ffconcat version 1.0\n${list}\nfile '${shots.at(-1).frame}'\n`);
            const gif = join(outDir, `${name}.gif`);
            execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(frames, "list.txt"), "-vf", "fps=20,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none", gif]);
            await rm(frames, { recursive: true, force: true });
            process.stdout.write(`  ${resolve(gif)}\n`);
          }
        });
      } catch (error) {
        failures.push(`${name} (${mode}): ${error.message}`);
        process.stdout.write(`failed: ${error.message}\n`);
      }
    }
  }
} finally {
  client.socket?.close();
  if (chromeProcess) {
    const exited = new Promise((done) => chromeProcess.once("exit", done));
    chromeProcess.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
