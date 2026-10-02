#!/usr/bin/env node
/** Capture live BB plugin surfaces for README screenshots. Set BB_CAPTURE_ONLY to comma-separated capture IDs to select a subset. */
import { readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, ensureChrome } from "./capture/driver.mjs";
import { projectId, threadId, pluginRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep } from "./capture/bb.mjs";
import { seedPages, seedDrawing, seedArtifact, seedTalkRecording, talkRpc } from "./capture/seed.mjs";
import bb_studio_sidebar from "./capture/captures/bb-studio-sidebar.mjs";
import bb_studio_teams from "./capture/captures/bb-studio-teams.mjs";
import bb_studio_draw from "./capture/captures/bb-studio-draw.mjs";
import bb_studio_chat from "./capture/captures/bb-studio-chat.mjs";
import bb_studio_float from "./capture/captures/bb-studio-float.mjs";
import bb_studio_talk from "./capture/captures/bb-studio-talk.mjs";
import bb_studio_pages from "./capture/captures/bb-studio-pages.mjs";
import bb_studio from "./capture/captures/bb-studio.mjs";
import bb_studio_artifacts from "./capture/captures/bb-studio-artifacts.mjs";
import bb_studio_tasks from "./capture/captures/bb-studio-tasks.mjs";
import bb_studio_reactions from "./capture/captures/bb-studio-reactions.mjs";
import bb_studio_explore from "./capture/captures/bb-studio-explore.mjs";
import bb_studio_feed from "./capture/captures/bb-studio-feed.mjs";
import bb_studio_decisions from "./capture/captures/bb-studio-decisions.mjs";
import bb_studio_mobile from "./capture/captures/bb-studio-mobile.mjs";
import bb_studio_tables from "./capture/captures/bb-studio-tables.mjs";
import bb_studio_navigation from "./capture/captures/bb-studio-navigation.mjs";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginFlag = process.argv.indexOf("--plugin");
if (pluginFlag >= 0 && !process.argv[pluginFlag + 1]) throw new Error("Usage: --plugin <plugin-id>");
const pluginOnly = pluginFlag >= 0 ? process.argv[pluginFlag + 1] : process.env.BB_CAPTURE_PLUGIN;
const pluginIndex = JSON.parse(await readFile(join(repoRoot, ".bb/plugins.json"), "utf8"));
const pluginSource = pluginOnly && pluginIndex.plugins.find((plugin) => plugin.name === pluginOnly)?.source;
if (pluginOnly && !pluginSource) throw new Error(`Unknown plugin ID: ${pluginOnly}`);
const packageOnly = pluginSource?.split("/").at(-1);
const captureOnly = process.env.BB_CAPTURE_ONLY
  ? new Set(process.env.BB_CAPTURE_ONLY.split(",").map((value) => value.trim()).filter(Boolean))
  : null;
if (!projectId || !threadId) throw new Error("Set BB_CAPTURE_PROJECT_ID and BB_CAPTURE_THREAD_ID to a seeded BB thread before capturing.");
const context = { projectId, threadId, pluginRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep, seedPages, seedDrawing, seedArtifact, seedTalkRecording, talkRpc };
const captures = [
  ...bb_studio_sidebar(context),
  ...bb_studio_teams(context),
  ...bb_studio_draw(context),
  ...bb_studio_chat(context),
  ...bb_studio_float(context),
  ...bb_studio_talk(context),
  ...bb_studio_pages(context),
  ...bb_studio(context),
  ...bb_studio_artifacts(context),
  ...bb_studio_tasks(context),
  ...bb_studio_reactions(context),
  ...bb_studio_explore(context),
  ...bb_studio_feed(context),
  ...bb_studio_decisions(context),
  ...bb_studio_mobile(context),
  ...bb_studio_tables(context),
  ...bb_studio_navigation(context)
];

const { webSocketUrl, process: chromeProcess, profileDir } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
await client.connect();
await client.command("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

try {
  for (const capture of captures) {
    if ((captureOnly && !captureOnly.has(capture.id)) || (packageOnly && capture.packageDir !== packageOnly)) continue;
    process.stdout.write(`Capturing ${capture.id}...\n`);
    const cleanup = await capture.setup(client);
    try {
      const outputPath = join(repoRoot, "packages", capture.packageDir, "assets", capture.fileName ?? "staged-preview.png");
      // Use BB's real collapsed-sidebar state so publication does not expose
      // unrelated local projects/threads alongside the deterministic fixtures.
      const privateSidebar = capture.privateSidebar !== false && !capture.showSidebar && (capture.privateSidebar || (capture.packageDir === "bb-studio-teams" && capture.id !== "bots-forks"));
      const collapsedSidebar = privateSidebar && await client.evaluate(`(() => {
        const sidebar = document.querySelector('[data-sidebar="sidebar"]');
        if (['closed', 'collapsed'].includes(sidebar?.closest('[data-state]')?.getAttribute('data-state'))) return false;
        if (!sidebar?.checkVisibility() || sidebar.getBoundingClientRect().right <= 0) return false;
        const button = document.querySelector('button[aria-label^="Toggle sidebar" i]');
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (collapsedSidebar) {
        await sleep(350);
      }
      // A capture may crop the real frame, such as to leave out machine names.
      await client.capture(outputPath, capture.clip ? await capture.clip(client) : undefined);
      if (collapsedSidebar) {
        await client.evaluate(`document.querySelector('button[aria-label^="Toggle sidebar" i]')?.click()`);
        await sleep(350);
      }
      process.stdout.write(`  ${outputPath}\n`);
    } finally {
      if (cleanup) await cleanup();
    }
  }
} finally {
  client.socket?.close();
  if (chromeProcess) {
    // Chrome holds its profile open until it exits.
    const exited = new Promise((resolve) => chromeProcess.once("exit", resolve));
    chromeProcess.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
