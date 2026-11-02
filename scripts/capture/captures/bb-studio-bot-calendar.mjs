// The Bot's Automations week (src/ui/bot/AutomationsCalendar.tsx) and its
// sidebar without Schedule, in dark and light, from a staged BB seeded with a
// realistic mix: two runners (every 2 h and daily), the Bot's check-in every
// 2 h, a daily 13:00 check, a weekly Monday job, a paused watcher, a watcher
// whose run failed, and a one-off reminder. "before" ids shoot the same
// surfaces on a Studio from before the calendar (the sidebar's Schedule and
// the Automations list). Renders go to assets/bot-calendar/{before,after}/;
// only studio-bot-automations-week is a README asset.
import { BOT_PATH, dismissProblems, SIDEBAR } from "./bb-studio-bot.mjs";

const ALL = [0, 1, 2, 3, 4, 5, 6];
const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
const FAIL_SCRIPT = "echo 'status.orbit.dev: connection refused' >&2\nexit 2";
const QUIET_SCRIPT = "exit 0";
/** Long enough that a run started before a shot is still going: the live block. */
const DIGEST_JOB = "Write the ORBIT-42 daily digest: first run `sleep 90` in the shell. There is nothing new: finish without any message.";

export default ({ pluginRpc, bbCli, sleep }) => {
  let seeded = null;
  const seed = async () => {
    if (seeded) return seeded;
    let { bot } = await pluginRpc("studio", "bot_get", {});
    if (!bot) {
      ({ bot } = await pluginRpc("studio", "bot_create", { name: "Dot", avatar: "🟣", shape: "blob", color: "#7c66dc", prompt: "Hi Dot. In one short sentence, say you'll keep an eye on the ORBIT-42 launch." }));
      await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "240"]).catch(() => {});
    }
    // Runners: one every 2 h, one daily.
    let { runners } = await pluginRpc("studio", "bot_runners", {});
    for (const spec of [
      { name: "Inbox triage", job: "Triage the ORBIT-42 inbox. There is nothing new: finish without any message.", schedule: { cadence: "every2hours", time: "00:00" } },
      { name: "Daily digest", job: DIGEST_JOB, schedule: { cadence: "daily", time: "08:00" } },
    ]) if (!runners.some((runner) => runner.name === spec.name)) await pluginRpc("studio", "bot_runner_create", spec);
    ({ runners } = await pluginRpc("studio", "bot_runners", {}));
    for (const runner of runners) if (runner.threadId) await bbCli(["thread", "wait", runner.threadId, "--status", "idle", "--timeout", "300"]).catch(() => {});
    const digest = runners.find((runner) => runner.name === "Daily digest");
    if (digest.job !== DIGEST_JOB) await pluginRpc("studio", "bot_runner_update", { id: digest.id, job: DIGEST_JOB });
    // The Bot's own check-in, every 2 h.
    await pluginRpc("studio", "bot_checkin_preset", { preset: "morning" });
    await pluginRpc("studio", "bot_automation_update", { id: "heartbeat", schedule: { type: "interval", every: 2, unit: "hours", days: ALL, from: "00:00", to: "23:59" } });
    let { automations } = await pluginRpc("studio", "bot_automations", {});
    const has = (name) => automations.some((each) => each.name === name);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(15, 30, 0, 0);
    if (!has("Lunch check")) await pluginRpc("studio", "bot_automation_create", { kind: "checkin", name: "Lunch check", instruction: "Check what changed on ORBIT-42 this morning.", schedule: { type: "times", days: ALL, times: ["13:00"] } });
    if (!has("Weekly review")) await pluginRpc("studio", "bot_automation_create", { kind: "checkin", name: "Weekly review", instruction: "Review last week's ORBIT-42 progress.", schedule: { type: "times", days: [1], times: ["09:00"] } });
    if (!has("Call Dana back")) await pluginRpc("studio", "bot_automation_create", { kind: "reminder", name: "Call Dana back", instruction: "Remind me to call Dana about the launch date.", schedule: { type: "once", at: tomorrow.getTime() } });
    if (!has("Release watch")) await pluginRpc("studio", "bot_automation_create", { kind: "watcher", name: "Release watch", instruction: "Only if it's ORBIT-42.", schedule: { type: "interval", every: 15, unit: "minutes", days: ALL }, script: { body: QUIET_SCRIPT, interpreter: "bash", timeoutMs: 30000 } });
    if (!has("Status probe")) await pluginRpc("studio", "bot_automation_create", { kind: "watcher", name: "Status probe", instruction: "Tell me if the status page is down.", schedule: { type: "times", days: ALL, times: ["10:00", "16:00", "22:00"] }, script: { body: FAIL_SCRIPT, interpreter: "bash", timeoutMs: 30000 } });
    ({ automations } = await pluginRpc("studio", "bot_automations", {}));
    const watch = automations.find((each) => each.name === "Release watch");
    if (watch.state === "active") await pluginRpc("studio", "bot_automation_pause", { id: watch.id });
    const probe = automations.find((each) => each.name === "Status probe");
    const failedRuns = async () => (await pluginRpc("studio", "bot_automation_runs", { id: probe.id })).runs.filter((run) => run.status === "failed");
    if (!(await failedRuns()).length) {
      await pluginRpc("studio", "bot_automation_run_now", { id: probe.id });
      for (let i = 0; i < 40 && !(await failedRuns()).length; i++) await sleep(3000);
    }
    if (!(await failedRuns()).length) throw new Error(`Status probe has no failed run: ${JSON.stringify((await pluginRpc("studio", "bot_automation_runs", { id: probe.id })).runs)}`);
    seeded = { bot, probe, watch, digest };
    return seeded;
  };

  /** The Bot page with its sidebar group open, in `mode`. */
  const botPage = async (client, mode) => {
    await scheme(client, mode);
    const { bot } = await seed();
    // Its Info, the Bot page, with the Bots list beside it.
    await client.navigate(`${BOT_PATH}/${bot.id}`);
    await client.waitForSelector(`[aria-label="${bot.name} info"]`, 30000);
    await client.waitForSelector(SIDEBAR, 30000);
    await dismissProblems(client);
    for (const text of ["Runners", "Inbox triage", "Daily digest"]) await client.waitForText(text, 60000);
    const dark = await client.evaluate(`document.documentElement.classList.contains("dark")`);
    if (dark !== (mode === "dark")) throw new Error(`BB isn't in ${mode} mode`);
  };
  /** Automations at the top of the page; the week scrolled to 7:00 so the day's checks show. */
  const toAutomations = async (client) => {
    await client.waitForSelector('section[aria-label="Automations"]', 30000);
    await client.evaluate(`(() => { document.querySelector('section[aria-label="Automations"]').scrollIntoView({ block: "start" }); return true; })()`);
    await sleep(400);
  };
  const toWeek = async (client) => {
    await toAutomations(client);
    await client.waitForSelector("[data-testid=automations-calendar] [data-band]", 30000);
    await client.waitForSelector('[data-testid=automations-calendar] [data-status="failed"]', 60000);
    await client.waitForSelector('[data-testid=calendar-paused] [data-paused]', 30000);
    await client.evaluate(`(() => { const grid = document.querySelector("[data-testid=automations-calendar] .overflow-y-auto"); grid.scrollTop = 7 * 36; return true; })()`);
    for (const text of ["Today", "Lunch check", "Weekly review", "Call Dana back", "Status probe", "Inbox triage · every 2 h", "Check-in · every 2 h", "Paused", "Release watch"]) await client.waitForText(text, 30000);
    await sleep(500);
  };
  /** Starts the Daily digest so the week shows a run going on now. */
  const liveRun = async () => {
    const { digest } = await seed();
    const running = async () => (await pluginRpc("studio", "bot_runners", {})).runners.find((runner) => runner.id === digest.id)?.running;
    if (!(await running())) await pluginRpc("studio", "bot_runner_run_now", { id: digest.id });
    for (let i = 0; i < 30 && !(await running()); i++) await sleep(1000);
    if (!(await running())) throw new Error("The Daily digest run didn't start");
  };
  const hover = async (client, selector) => {
    const point = await client.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("Nothing to hover: ${selector.replace(/"/g, "'")}"); el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 30), y: r.top + Math.min(r.height / 2, 10) }; })()`);
    await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, buttons: 0 });
    await client.waitForSelector("[data-radix-popper-content-wrapper]", 5000);
    await sleep(500);
  };
  const sidebarHas = (client, wanted) => client.evaluate(`(() => {
    const groups = [...document.querySelectorAll('${SIDEBAR} section')].map((section) => section.getAttribute("aria-label"));
    if (${wanted ? "!" : ""}groups.includes("Schedule")) throw new Error("Sidebar groups: " + groups.join(", "));
    return groups;
  })()`);

  const both = (name, setup) => ["dark", "light"].map((mode) => ({
    id: `studio-bot-calendar-${name}-${mode}`, packageDir: "bb-studio", fileName: `bot-calendar/${name.replace(/^(before|after)-/, "$1/")}-${mode}.png`, showSidebar: true,
    setup: async (client) => { try { await setup(client, mode); } catch (error) { await scheme(client, ""); throw error; } },
  }));
  const week = async (client, mode) => {
    await liveRun(); await botPage(client, mode); await toWeek(client);
    // A live block, or a "+N" chip pulsing with it in a crowded slot.
    await client.waitForSelector('[data-testid=automations-calendar] [data-status="running"], [data-testid=automations-calendar] [data-fold-live]', 30000);
    await sleep(500);
  };
  return [
    // The README's shot.
    { id: "studio-bot-automations-week", packageDir: "bb-studio", fileName: "bot-automations-week.png", showSidebar: true, setup: async (client) => { try { await week(client, "dark"); } finally { await scheme(client, ""); } } },
    ...both("before-sidebar", async (client, mode) => { await botPage(client, mode); await client.waitForText("Schedule", 30000); await sidebarHas(client, true); }),
    ...both("before-automations", async (client, mode) => { await botPage(client, mode); await toAutomations(client); await client.waitForSelector('[data-automation]', 30000); }),
    ...both("after-sidebar", async (client, mode) => { await botPage(client, mode); await sidebarHas(client, false); }),
    ...both("after-week", week),
    // A wider window: the week grows with the page.
    { id: "studio-bot-calendar-after-week-1728-dark", packageDir: "bb-studio", fileName: "bot-calendar/after/week-1728-dark.png", showSidebar: true, setup: async (client) => {
      await client.command("Emulation.setDeviceMetricsOverride", { width: 1728, height: 1000, deviceScaleFactor: 1, mobile: false });
      try { await week(client, "dark"); } catch (error) { await scheme(client, ""); throw error; }
    } },
    ...both("after-hover", async (client, mode) => { await botPage(client, mode); await toWeek(client); await hover(client, '[data-testid=automations-calendar] [data-source][data-status="scheduled"][aria-label^="Lunch check"]'); }),
    ...both("after-failed", async (client, mode) => { await botPage(client, mode); await toWeek(client); await hover(client, '[data-testid=automations-calendar] [data-status="failed"]'); await client.waitForText("connection refused", 5000); }),
    ...both("after-list", async (client, mode) => {
      await botPage(client, mode); await toWeek(client);
      await client.evaluate(`(() => { [...document.querySelectorAll('[role=tab]')].find((each) => each.textContent.trim() === "List").click(); return true; })()`);
      await client.waitForSelector("[data-testid=automation-last-failure]", 30000);
      await client.waitForText("connection refused", 10000);
      await toAutomations(client);
    }),
    ...both("after-paused", async (client, mode) => {
      await botPage(client, mode); await toWeek(client);
      await client.evaluate(`(() => { document.querySelector("[data-testid=calendar-paused]").scrollIntoView({ block: "center" }); return true; })()`);
      await sleep(300);
    }),
  ];
};
