#!/usr/bin/env node
/**
 * End-to-end check of Studio's sidebar list (packages/bb-studio/src/ui/bot/threadListSwitch.ts)
 * on a staged BB. The list is always the Bots list (`studio/bot`: Threads, then
 * Bots) except on the Studio panel (/plugins/studio/studio and below, but not
 * the Bot page /plugins/studio/studio/bot…), where it is `studio/studio-items`.
 * It checks the rail has no Bot item, clicks through every kind of Bots list
 * entry (the Bot's chat, each runner, the Recent rows, a worker thread, an
 * archived runner's thread), reloading after each, and asserts the sidebar
 * never leaves the Bots list. Home on the rail and a thread opened from the
 * Threads section keep it; the Studio panel switches to the Studio items list,
 * and leaving it (to a thread or the Bot page) switches back.
 *
 *   node scripts/staged-bb.mjs start
 *   . "$TMPDIR/bb-studio-staged/capture.env"
 *   node scripts/check-bot-sidebar.mjs
 *   node scripts/staged-bb.mjs stop
 */
import { rm } from "node:fs/promises";
import { CdpClient, ensureChrome } from "./capture/driver.mjs";
import { projectId, pluginRpc, bbCli, sleep } from "./capture/bb.mjs";
import { BOT_PATH, LIST_PREF, ORBIT_TITLES, SIDEBAR, THREADS, botFixtures, clickHome, dismissProblems, openFromBbList } from "./capture/captures/bb-studio-bot.mjs";

if (!projectId) throw new Error("Set BB_CAPTURE_PROJECT_ID (source the staged BB's capture.env).");
const fixtures = botFixtures({ projectId, pluginRpc, bbCli, sleep });
const BOTS = "studio/bot";
const STUDIO = "studio/studio-items";
const STUDIO_PATH = "/plugins/studio/studio";
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

/** Waits for `want` ("bots" or "studio") in the DOM and the preference, then holds it for `holdMs` without a flip. */
async function expectList(client, want, label, holdMs = 3000) {
  const started = Date.now();
  for (;;) {
    const bots = await client.poll(`!!document.querySelector('${SIDEBAR}')`);
    const value = await pref();
    const ok = want === "bots" ? bots === true && value === BOTS : bots === false && value === STUDIO;
    if (ok) break;
    if (Date.now() - started > 30000) throw new Error(`${label}: wanted ${want}, the sidebar has ${bots ? "the Bots list" : "no Bots list"} and ${LIST_PREF} is ${value} (${await path(client)})`);
    await sleep(250);
  }
  await watch(client, want);
  const end = Date.now() + holdMs;
  while (Date.now() < end) {
    const value = await pref();
    if (value !== (want === "bots" ? BOTS : STUDIO)) throw new Error(`${label}: ${LIST_PREF} flipped to ${value}`);
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
  results.push(`${want === "bots" ? "Bots" : "Studio items"} list kept: ${label} ${at}, reloaded`);
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

/** Throws if BB's rail has a Bot item. */
const assertNoRailBot = (client) => client.evaluate(`(() => {
  const rail = document.querySelector('nav[aria-label="Primary navigation"]');
  if (!rail) throw new Error("No rail");
  if ([...rail.querySelectorAll("button, a")].some((each) => (each.getAttribute("aria-label") ?? each.textContent.trim()) === "Bot")) throw new Error("The rail still has a Bot item");
  return true;
})()`);

/** Waits for `threadId`'s page. */
async function waitForThread(client, threadId, label) {
  const started = Date.now();
  while (!(await path(client))?.match(new RegExp(`/threads/${threadId}(/|$)`))) {
    if (Date.now() - started > 30000) throw new Error(`${label}: wanted thread ${threadId}, at ${await path(client)}`);
    await sleep(200);
  }
  results.push(`${label}: landed on ${threadId}`);
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

  // A fresh window: Home has the Bots list, the rail no Bot item.
  await client.navigate("/");
  await client.evaluate(`(() => { sessionStorage.clear(); return true; })()`);
  await client.navigate("/");
  await dismissProblems(client);
  await assertNoRailBot(client);
  results.push("The rail has no Bot item");
  await step(client, "bots", "Home in a fresh window");
  // The Bot page lands on the Bot's chat with the Bots list.
  await client.navigate(BOT_PATH);
  await waitForThread(client, bot.threadId, "The Bot page in a fresh window");
  await client.waitForSelector(SIDEBAR, 30000);
  await step(client, "bots", "Bot page (the Bot's chat)");

  await clickRow(client, `${SIDEBAR} [data-testid=bot-main]`, "the Bot's chat", bot.threadId);
  await step(client, "bots", "Bot chat");

  await openGroup(client, "Runners");
  for (const runner of runners) {
    await openGroup(client, "Runners");
    await clickRow(client, `${SIDEBAR} section[aria-label="Runners"] button[data-runner="${runner.id}"]`, `runner ${runner.name}`, runner.threadId);
    await step(client, "bots", `runner ${runner.name}${runner.threadId === archived ? " (archived thread)" : ""}`);
  }

  // Home on the rail from a runner keeps the Bots list.
  const live = runners.find((runner) => runner.threadId && runner.threadId !== archived);
  if (!live) throw new Error("No runner with a live thread");
  await openGroup(client, "Runners");
  await clickRow(client, `${SIDEBAR} section[aria-label="Runners"] button[data-runner="${live.id}"]`, `runner ${live.name}`, live.threadId);
  await expectList(client, "bots", `runner ${live.name}`, 500);
  await clickHome(client);
  await step(client, "bots", `Home on runner ${live.name}`);

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

  // Home keeps the Bots list; a thread opened from the Threads section too.
  await clickHome(client);
  await step(client, "bots", "Home");
  await client.waitForSelector(THREADS, 30000);
  await openFromBbList(client, ORBIT_TITLES[0]);
  await step(client, "bots", `Threads section: ${ORBIT_TITLES[0]}`);

  // The Studio panel has the Studio items list; leaving it to a thread brings the Bots list back.
  await client.navigate(STUDIO_PATH);
  await step(client, "studio", "Studio panel");
  await client.navigate(`/threads/${worker.id}`);
  await waitForThread(client, worker.id, "Leaving the Studio panel for a thread");
  await step(client, "bots", "thread after the Studio panel");
  // ...and leaving it for the Bot page too.
  await client.navigate(STUDIO_PATH);
  await step(client, "studio", "Studio panel again");
  await client.navigate(BOT_PATH);
  await client.waitForSelector(SIDEBAR, 30000);
  await step(client, "bots", "Bot page after the Studio panel");

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
