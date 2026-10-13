#!/usr/bin/env node
/**
 * End-to-end check of Studio's sticky sidebar (packages/bb-studio/src/ui/bot/threadListSwitch.ts)
 * on a staged BB. It clicks through every kind of Bots list entry (the Bot's
 * chat, each runner, the Recent rows, a worker thread, an archived runner's
 * thread), reloads after each, and asserts the sidebar never leaves the Bots
 * list. Then Home on the rail must bring BB's list back, and a thread opened
 * from BB's list must keep it.
 *
 *   node scripts/staged-bb.mjs start
 *   . "$TMPDIR/bb-studio-staged/capture.env"
 *   node scripts/check-bot-sidebar.mjs
 *   node scripts/staged-bb.mjs stop
 */
import { rm } from "node:fs/promises";
import { CdpClient, ensureChrome } from "./capture/driver.mjs";
import { projectId, pluginRpc, bbCli, sleep } from "./capture/bb.mjs";
import { BOT_PATH, LIST_PREF, ORBIT_TITLES, SIDEBAR, botFixtures, clickHome, dismissProblems, openFromBbList } from "./capture/captures/bb-studio-bot.mjs";

if (!projectId) throw new Error("Set BB_CAPTURE_PROJECT_ID (source the staged BB's capture.env).");
const fixtures = botFixtures({ projectId, pluginRpc, bbCli, sleep });
const BOTS = "studio/bot";
const NATIVE = "thread-list/thread-list";
const results = [];

const pref = async () => JSON.parse(await bbCli(["settings", "ui", "get", LIST_PREF]));
const path = (client) => client.evaluate("location.pathname");

/**
 * Counts, every 50 ms in the page, the moments the sidebar shows the wrong
 * list once it first showed the right one: a flip. A reload starts a new count.
 */
const watch = (client, want) => client.evaluate(`(() => {
  clearInterval(window.__sidebarWatch);
  window.__sidebarFlips = 0; window.__sidebarSeen = false;
  window.__sidebarWatch = setInterval(() => {
    const bots = !!document.querySelector('${SIDEBAR}');
    const right = ${want === "bots" ? "bots" : "!bots"};
    if (right) window.__sidebarSeen = true;
    else if (window.__sidebarSeen) window.__sidebarFlips++;
  }, 50);
  return true;
})()`);

/** Waits for `want` ("bots" or "native") in the DOM and the preference, then holds it for `holdMs` without a flip. */
async function expectList(client, want, label, holdMs = 3000) {
  const started = Date.now();
  for (;;) {
    const bots = await client.poll(`!!document.querySelector('${SIDEBAR}')`);
    const value = await pref();
    const ok = want === "bots" ? bots === true && value === BOTS : bots === false && value === NATIVE && await client.poll(`!!document.querySelector('[data-sidebar="sidebar"]')`);
    if (ok) break;
    if (Date.now() - started > 30000) throw new Error(`${label}: wanted ${want}, the sidebar has ${bots ? "the Bots list" : "no Bots list"} and ${LIST_PREF} is ${value} (${await path(client)})`);
    await sleep(250);
  }
  await watch(client, want);
  const end = Date.now() + holdMs;
  while (Date.now() < end) {
    const value = await pref();
    if (value !== (want === "bots" ? BOTS : NATIVE)) throw new Error(`${label}: ${LIST_PREF} flipped to ${value}`);
    await sleep(400);
  }
  const flips = await client.evaluate("window.__sidebarFlips");
  if (flips) throw new Error(`${label}: the sidebar flipped away from ${want} (${flips} samples)`);
}

/** Asserts the list, reloads the page, and asserts it again on the same route. */
async function step(client, want, label) {
  const at = await path(client);
  await expectList(client, want, label);
  await client.command("Page.reload", { ignoreCache: false });
  await sleep(1500);
  if ((await path(client)) !== at) throw new Error(`${label}: the reload moved from ${at} to ${await path(client)}`);
  await expectList(client, want, `${label} (after reload)`);
  results.push(`${want === "bots" ? "Bots" : "BB's"} list kept: ${label} ${at}, reloaded`);
  process.stdout.write(`  ok  ${label}  ${at}\n`);
}

/** Opens a group if it's closed. */
const openGroup = (client, title) => client.evaluate(`(() => {
  const toggle = document.querySelector('${SIDEBAR} section[aria-label="${title}"] > button[aria-expanded]');
  if (!toggle) throw new Error("No ${title} group in the Bots list");
  if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
  return true;
})()`);

/** Clicks a Bots list row with the pointer and waits for its thread page. */
async function clickRow(client, selector, label, threadId) {
  const point = await client.evaluate(`(() => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const row = document.querySelector(${JSON.stringify(selector)});
      if (row) {
        row.scrollIntoView({ block: "center" });
        const rect = row.getBoundingClientRect();
        return resolve({ x: rect.left + Math.min(rect.width / 2, 80), y: rect.top + rect.height / 2 });
      }
      if (Date.now() - started > 30000) return reject(new Error(${JSON.stringify(`No ${label} row in the Bots list`)}));
      setTimeout(tick, 300);
    };
    tick();
  }))()`, true);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await client.command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
  }
  const started = Date.now();
  while (!(await path(client))?.match(threadId ? new RegExp(`/threads/${threadId}(/|$)`) : /\/threads\/[^/]+/)) {
    if (Date.now() - started > 15000) throw new Error(`${label} didn't open its thread (${await path(client)})`);
    await sleep(200);
  }
}

const { webSocketUrl, process: chromeProcess, profileDir } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
let archived = null;
try {
  await client.connect();
  await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  process.stdout.write("Seeding the Bot, its threads and runners...\n");
  const { bot, runners } = await fixtures.seededRunners();
  const worker = await fixtures.json(["thread", "list", "--parent-thread", bot.threadId, "--include-hidden"]).then((threads) => threads.find((thread) => thread.title === "Watch the ORBIT-42 staging deploy"));
  if (!worker) throw new Error("No worker thread (Watch the ORBIT-42 staging deploy) was seeded");
  // An archived thread the Bots list still lists: a runner's, archived (as when a runner is let go).
  const inbox = runners.find((runner) => runner.name === "Inbox watch");
  if (!inbox?.threadId) throw new Error("No Inbox watch runner thread");
  await bbCli(["thread", "archive", inbox.threadId]);
  archived = inbox.threadId;

  // A fresh window: start on Home, then the Bot page from the rail (its URL if this BB has no Bot rail item).
  await client.navigate("/");
  await client.evaluate(`(() => { sessionStorage.clear(); return true; })()`);
  await client.navigate("/");
  await dismissProblems(client);
  const railBot = await client.evaluate(`(() => { const button = document.querySelector('nav[aria-label="Primary navigation"] [aria-label="Bot"]'); if (button) { button.click(); return true; } return false; })()`);
  if (!railBot) await client.navigate(BOT_PATH);
  await client.waitForSelector(SIDEBAR, 30000);
  await step(client, "bots", railBot ? "Bot rail item" : "Bot page");

  await clickRow(client, `${SIDEBAR} [data-testid=bot-main]`, "the Bot's chat", bot.threadId);
  await step(client, "bots", "Bot chat");

  await openGroup(client, "Runners");
  for (const runner of runners) {
    await openGroup(client, "Runners");
    await clickRow(client, `${SIDEBAR} section[aria-label="Runners"] button[data-runner="${runner.id}"]`, `runner ${runner.name}`, runner.threadId);
    await step(client, "bots", `runner ${runner.name}${runner.threadId === archived ? " (archived thread)" : ""}`);
  }

  await openGroup(client, "Recent");
  const recent = await client.evaluate(`[...document.querySelectorAll('${SIDEBAR} section[aria-label="Recent"] button[data-thread]')].slice(0, 3).map((row) => ({ id: row.dataset.thread, title: row.title }))`);
  if (!recent.length) throw new Error("The Bot has no Recent threads");
  for (const thread of recent) {
    await openGroup(client, "Recent");
    await clickRow(client, `${SIDEBAR} section[aria-label="Recent"] button[data-thread="${thread.id}"]`, `Recent ${thread.title}`, thread.id);
    await step(client, "bots", `Recent: ${thread.title}`);
  }

  const group = await client.evaluate(`(() => { const row = document.querySelector('${SIDEBAR} button[data-thread="${worker.id}"]'); return row?.closest("section")?.getAttribute("aria-label") ?? null; })()`);
  if (group) await openGroup(client, group);
  await clickRow(client, `${SIDEBAR} button[data-thread="${worker.id}"]`, "worker thread", worker.id);
  await step(client, "bots", `worker: ${worker.title}`);

  // Home on the rail: a different destination, BB's list.
  await clickHome(client);
  await step(client, "native", "Home");
  // A thread opened from BB's list keeps BB's list.
  await openFromBbList(client, ORBIT_TITLES[0]);
  await step(client, "native", `BB's list: ${ORBIT_TITLES[0]}`);

  process.stdout.write(`\nPASS: ${results.length} steps\n${results.map((line) => `  ${line}`).join("\n")}\n`);
} finally {
  if (archived) await bbCli(["thread", "unarchive", archived]).catch(() => {});
  client.socket?.close();
  if (chromeProcess) {
    const exited = new Promise((resolve) => chromeProcess.once("exit", resolve));
    chromeProcess.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
