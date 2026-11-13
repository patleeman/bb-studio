// The redesigned Bot page (src/ui/bot/BotPage.tsx, BotControls.tsx and the
// week in AutomationsCalendar.tsx), in dark and light, from a staged BB seeded
// like a busy Chief of Staff: eight runners (an area sweep from 5:00 to 5:15,
// a midday check from 1:00 to 1:15 PM, a weekday standup, a nightly build), heartbeats
// every 2 hours and an hourly inbox watch (frequent, so hidden by default),
// the Bot's own morning card, evening wrap-up and Friday review, a reminder,
// and two paused watchers. Real jobs come from Studio's RPCs; yesterday's and
// today's run history is written into the staged automations database, so
// the week shows real outcomes without waiting a day.
//
// The quiet shots come first: nothing running and nothing waiting. Then the
// busy fixture adds what needs the user (a failed Security run, a pending chat
// question, two due loops, maintenance's call) and starts three runner runs.
// Renders go to assets/bot-redesign/, named like the mockups' PNGs.
import { createRequire } from "node:module";
import { join } from "node:path";
import { readStagedInstance } from "../../staged-instance.mjs";
import { BOT_PATH, dismissProblems } from "./bb-studio-bot.mjs";
import { clickHeaderAction } from "../header-actions.mjs";

const require = createRequire(import.meta.url);
const ALL = [0, 1, 2, 3, 4, 5, 6];
const DAY = 86_400_000;
const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
const QUIET = "There is nothing new: finish without any message.";
const WIDTH = 1280;

/** The same key Studio saves a group's name under (src/calendar-group-key.ts). */
const hhmm = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const groupKey = (from, to, ids) => `${hhmm(from)}-${hhmm(to)}|${[...new Set(ids)].sort().join(",")}`;

const RUNNERS = [
  { name: "Staff", job: `Check the staff calendar and messages. ${QUIET}`, schedule: { cadence: "custom", time: "05:15", cron: "15 5,13 * * *" } },
  { name: "Home & Family", job: `Check the family calendar and school emails. ${QUIET}`, schedule: { cadence: "daily", time: "05:10" } },
  { name: "Comms", job: `Sort new email and draft replies. ${QUIET}`, schedule: { cadence: "daily", time: "05:05" } },
  { name: "Systems", job: `Check the servers, backups and disks on homelab. ${QUIET}`, schedule: { cadence: "daily", time: "05:00" } },
  { name: "House", job: `Check the house sensors and deliveries. ${QUIET}`, schedule: { cadence: "daily", time: "13:00" } },
  { name: "Security", job: `Check the cameras and door locks. ${QUIET}`, schedule: { cadence: "daily", time: "13:00" } },
  { name: "Project Lead", job: `Run the GB Studio standup. ${QUIET}`, schedule: { cadence: "weekdays", time: "10:00" } },
  { name: "Set up GB Studio", job: `Build GB Studio and report the result. ${QUIET}`, schedule: { cadence: "daily", time: "21:00" } },
];
/** While working now: a first sentence that says what it's doing, and a long sleep so the run is still going at the shot. */
const WORKING = {
  Comms: "Drafting replies to 3 emails from this morning. First run `sleep 900` in the shell, then finish without any message.",
  "Project Lead": "Reviewing the GB Studio pull request. First run `sleep 900` in the shell, then finish without any message.",
  Systems: "Checking the backup on homelab. First run `sleep 900` in the shell, then finish without any message.",
};
const every = (hours) => ({ type: "interval", every: hours, unit: "hours", days: ALL, from: "00:00", to: "23:59" });
const QUIET_SCRIPT = { body: "exit 0", interpreter: "bash", timeoutMs: 30000 };
/** Studio automations: [kind, name, schedule, target runner name or null, state]. */
const JOBS = [
  ["watcher", "Inbox watch", every(1), null, "active"],
  ["watcher", "Systems heartbeat", every(2), "Systems", "active"],
  ["watcher", "Home heartbeat", every(2), "Home & Family", "active"],
  ["watcher", "Security heartbeat", every(2), "Security", "active"],
  ["watcher", "Staff heartbeat", every(2), "Staff", "active"],
  ["watcher", "Camera digest", { type: "times", days: ALL, times: ["08:00"] }, "Security", "active"],
  ["checkin", "Morning card", { type: "times", days: ALL, times: ["07:00"] }, null, "active"],
  ["checkin", "Evening wrap-up", { type: "times", days: ALL, times: ["18:00"] }, null, "active"],
  ["checkin", "Week in review", { type: "times", days: [5], times: ["16:00"] }, null, "active"],
  ["watcher", "Newsletter digest", { type: "times", days: [1, 2, 3, 4, 5], times: ["11:00"] }, "Comms", "paused"],
  ["watcher", "Filter change reminder", { type: "times", days: [6], times: ["09:00"] }, "House", "paused"],
];
const INSTRUCTION = { "Morning card": "Send me the morning card: today's calendar, what needs me, and the weather.", "Evening wrap-up": "Wrap up the day: what got done and what's left for tomorrow.", "Week in review": "Review the week: what moved, what's stuck, what's next." };

function stagedDb(name) {
  const { dataDir } = readStagedInstance();
  const Database = require("../../../packages/bb-studio/node_modules/better-sqlite3");
  return new Database(join(dataDir, name), { timeout: 5000 });
}

/** Local wall-clock time `days` from today. */
const at = (days, hour, minute = 0) => { const date = new Date(); date.setDate(date.getDate() + days); date.setHours(hour, minute, 0, 0); return date.getTime(); };

export default ({ pluginRpc, bbCli, sleep }) => {
  let seeded = null;
  let busy = false;

  const waitIdle = async (threadId, timeout = 300) => { if (threadId) await bbCli(["thread", "wait", threadId, "--status", "idle", "--timeout", String(timeout)]).catch(() => {}); };

  /** The Chief of Staff, its runners and jobs, group names and run history. */
  async function seed() {
    if (seeded) return seeded;
    let { bot } = await pluginRpc("studio", "bot_get", {});
    if (!bot) {
      ({ bot } = await pluginRpc("studio", "bot_create", { name: "Chief of Staff", avatar: "🧭", shape: "blob", color: "#2ba59a", prompt: "Reply with one short sentence: you're ready to keep the week moving." }));
      await waitIdle(bot.threadId, 240);
    }
    await pluginRpc("studio", "bot_set", { name: "Chief of Staff", shape: "blob", color: "#2ba59a", role: "You are my chief of staff. Keep my week moving and only interrupt for what matters." });
    await pluginRpc("studio", "bot_checkin_preset", { preset: "off" }).catch(() => {});
    let { runners } = await pluginRpc("studio", "bot_runners", {});
    const made = [];
    for (const spec of RUNNERS) if (!runners.some((runner) => runner.name === spec.name)) made.push((await pluginRpc("studio", "bot_runner_create", spec)).id);
    ({ runners } = await pluginRpc("studio", "bot_runners", {}));
    // A new runner's first run finishes before the shots; a working one (makeBusy) is left running.
    for (const runner of runners) if (made.includes(runner.id)) await waitIdle(runner.threadId);
    for (const spec of RUNNERS) { const runner = runners.find((each) => each.name === spec.name); if (runner.job !== spec.job && !runner.running) await pluginRpc("studio", "bot_runner_update", { id: runner.id, job: spec.job }); }
    const runnerId = (name) => runners.find((runner) => runner.name === name).id;
    let { automations } = await pluginRpc("studio", "bot_automations", {});
    for (const [kind, name, schedule, target, state] of JOBS) {
      let job = automations.find((each) => each.name === name);
      if (!job) job = await pluginRpc("studio", "bot_automation_create", { kind, name, schedule, instruction: INSTRUCTION[name] ?? (kind === "watcher" ? "Tell me only what's new." : ""), ...(kind === "watcher" ? { script: QUIET_SCRIPT, target: target ? runnerId(target) : "main" } : {}) });
      if (JSON.stringify(job.schedule) !== JSON.stringify(schedule) && job.schedule.type !== schedule.type) await pluginRpc("studio", "bot_automation_update", { id: job.id, schedule });
      if (state === "paused" && job.state !== "paused") await pluginRpc("studio", "bot_automation_pause", { id: job.id });
    }
    if (!automations.some((each) => each.name === "Call the county")) {
      const tuesday = new Date(); tuesday.setDate(tuesday.getDate() + ((9 - tuesday.getDay()) % 7 || 7)); tuesday.setHours(11, 0, 0, 0);
      await pluginRpc("studio", "bot_automation_create", { kind: "reminder", name: "Call the county", instruction: "Remind me to call the county about the property tax.", schedule: { type: "once", at: tuesday.getTime() } });
    }
    ({ automations } = await pluginRpc("studio", "bot_automations", {}));
    const id = (name) => automations.find((each) => each.name === name)?.id;
    // The Bot named its two groups.
    await pluginRpc("studio", "bot_calendar_group_rename", { key: groupKey(300, 315, ["Systems", "Comms", "Home & Family", "Staff"].map(id)), name: "Area sweep" });
    await pluginRpc("studio", "bot_calendar_group_rename", { key: groupKey(780, 795, ["Staff", "House", "Security"].map(id)), name: "Midday check" });
    seeded = { bot, runners, automations, id };
    writeHistory(seeded, false);
    return seeded;
  }

  /**
   * Yesterday's and today's runs before now, in the staged automations
   * database: quiet, except Comms' two new emails, the inbox watch's 4 at
   * noon and the camera digest. `failed`: Security's 1:00 PM run today failed.
   */
  function writeHistory({ automations, runners }, failed) {
    const now = Date.now();
    const db = stagedDb("plugins/automations/data.db");
    const studio = stagedDb("plugins/studio/data.db");
    try {
      const mode = new Map(db.prepare("SELECT id, run_mode FROM automations").all().map((row) => [row.id, row.run_mode]));
      const runnerRows = studio.prepare("SELECT id, name, automation_id, thread_id FROM bot_runners").all();
      const rows = [];
      const add = (bbId, when, extra = {}) => { if (bbId && mode.has(bbId) && when < now - 60_000) rows.push({ bbId, when, status: "succeeded", output: null, error: null, thread: null, ...extra }); };
      for (const runner of runners) {
        const row = runnerRows.find((each) => each.id === runner.id);
        const spec = RUNNERS.find((each) => each.name === runner.name);
        // Other captures add runners of their own to the same staged Bot.
        if (!spec) continue;
        const times = spec.schedule.cron ? [[5, 15], [13, 15]] : [spec.schedule.time.split(":").map(Number)];
        for (const day of [-1, 0]) {
          if (spec.schedule.cadence === "weekdays" && [0, 6].includes(new Date(at(day, 12)).getDay())) continue;
          for (const [hour, minute] of times) {
            const when = at(day, hour, minute);
            const fails = failed && runner.name === "Security" && day === 0 && hour === 13;
            add(row?.automation_id, when, { thread: row?.thread_id, ...(fails ? { status: "failed", error: "Couldn't sign in to Wyze" } : {}) });
          }
        }
      }
      for (const job of automations) {
        if (job.kind === "runner" || job.state === "paused") continue;
        const bbId = job.bbIds?.[0];
        const spec = JOBS.find((each) => each[1] === job.name);
        if (!spec) continue;
        const schedule = spec[2];
        for (const day of [-1, 0]) {
          if (schedule.type === "interval") {
            for (let hour = 0; hour < 24; hour += schedule.every) add(bbId, at(day, hour), job.name === "Inbox watch" && day === 0 && hour === 12 ? { output: "4 new, none urgent" } : {});
          } else if (schedule.type === "times" && schedule.days.includes(new Date(at(day, 12)).getDay())) {
            for (const time of schedule.times) { const [hour, minute] = time.split(":").map(Number); add(bbId, at(day, hour, minute), job.name === "Camera digest" ? { output: day === 0 ? "2 deliveries, nothing unusual" : "1 delivery, nothing unusual" } : {}); }
          }
        }
      }
      db.transaction(() => {
        db.prepare("DELETE FROM automation_runs WHERE id LIKE 'run_capture_%'").run();
        const insert = db.prepare("INSERT INTO automation_runs (id, automation_id, run_mode, thread_id, status, trigger, skip_reason, error, output, exit_code, idempotency_key, scheduled_for, started_at, finished_at) VALUES (?, ?, ?, ?, ?, 'schedule', NULL, ?, ?, ?, NULL, ?, ?, ?)");
        for (const row of rows) insert.run(`run_capture_${row.bbId}_${row.when}`, row.bbId, mode.get(row.bbId), row.thread, row.status, row.error, row.output, row.status === "failed" ? 1 : 0, row.when, row.when, row.when + 60_000);
        for (const bbId of new Set(rows.map((row) => row.bbId))) {
          const last = rows.filter((row) => row.bbId === bbId).sort((a, b) => b.when - a.when)[0];
          db.prepare("UPDATE automations SET last_run_at = ?, last_run_status = ?, last_error = ? WHERE id = ?").run(last.when, last.status, last.error, bbId);
        }
      })();
      // Comms told the Bot about two new emails after this morning's sweep.
      for (const row of runnerRows) {
        const last = rows.filter((each) => each.bbId === row.automation_id).sort((a, b) => b.when - a.when)[0];
        studio.prepare("UPDATE bot_runners SET last_run_at = ?, last_report = ?, last_report_at = ?, last_level = ? WHERE id = ?")
          .run(last?.when ?? null, row.name === "Comms" ? "2 new emails" : null, row.name === "Comms" ? at(0, 5, 6) : null, row.name === "Comms" ? "tell" : null, row.id);
      }
    } finally { db.close(); studio.close(); }
  }

  /** What needs the user, and three runs going on now. */
  async function makeBusy() {
    const fixture = await seed();
    if (busy) return fixture;
    writeHistory(fixture, true);
    const { bot, runners } = fixture;
    // Two due loops, and the rest of the board for the summary.
    const loop = (key, title, extra) => ({ id: `loop_capture-${key}`, title, why: "", source: null, kind: "do", options: [], owner: "patrick", trigger: { type: "none" }, priority: "normal", push: false, status: "surfaced", due: null, area: null, createdAt: Date.now() - DAY, updatedAt: Date.now(), closedAt: null, closedBy: null, ...extra });
    const friday = new Date(); friday.setDate(friday.getDate() + ((12 - friday.getDay()) % 7 || 7)); friday.setHours(17, 0, 0, 0);
    const loops = [
      loop("tax", "Pay the property tax installment", { why: "$2,140 on the county portal", due: at(0, 23, 0), priority: "urgent" }),
      loop("deck", "Choose the deck contractor", { kind: "decide", why: "Bayside can start sooner; Hudson is cheaper", options: ["Bayside", "Hudson"], due: friday.getTime() }),
      ...["Renew the car registration", "Book the dentist", "Send the school form", "Plan Mom's birthday", "Order the filter"].map((title, i) => loop(`soon${i}`, title, { status: "queued", trigger: { type: "time", at: at(1 + i, 9) } })),
      ...["Research flights for December", "Compare internet plans"].map((title, i) => loop(`agent${i}`, title, { owner: "cos", status: "in_progress" })),
      ...["Hudson's quote", "The plumber's invoice"].map((title, i) => loop(`wait${i}`, title, { kind: "waiting", status: "queued" })),
      ...["Hosting bill", "Caterer", "Library books", "Insurance card", "Gutter cleaning", "Passport photos"].map((title, i) => loop(`done${i}`, title, { status: "done", closedAt: Date.now() - (i + 1) * 12 * 3_600_000, closedBy: "patrick" })),
    ];
    const studio = stagedDb("plugins/studio/data.db");
    const bbDb = stagedDb("bb.db");
    try {
      studio.transaction(() => {
        studio.prepare("DELETE FROM bot_loops WHERE id LIKE 'loop_capture-%'").run();
        for (const each of loops) studio.prepare("INSERT INTO bot_loops VALUES (?, ?)").run(each.id, JSON.stringify(each));
        studio.prepare("DELETE FROM bot_run_dismissals").run();
        // Last night's maintenance left three finished threads for the user to decide on.
        // The table is append-only: add the run once.
        if (!studio.prepare("SELECT 1 FROM bot_maintenance_runs WHERE bot_id = ? AND at = ?").get(bot.id, at(0, 3))) studio.prepare("INSERT INTO bot_maintenance_runs (bot_id, at, result) VALUES (?, ?, ?)").run(bot.id, at(0, 3), JSON.stringify({ at: at(0, 3), dryRun: false, summary: "Archived 5 finished threads, trimmed Memory by 140 words", actions: ["Archived 5 finished threads"], needsCall: ["Fix the flaky upload test", "Try the new router firmware", "Draft the HOA letter"].map((title, i) => ({ threadId: `thr_capture_call${i}`, title, reason: "Uncommitted changes in its workspace" })), suggestions: [] }));
      })();
      // The Bot asked the user a question in its chat.
      const thread = bbDb.prepare("SELECT provider_id FROM threads WHERE id = ?").get(bot.threadId);
      bbDb.prepare("DELETE FROM pending_interactions WHERE id = 'pi_capture_vault'").run();
      bbDb.prepare("INSERT INTO pending_interactions (id, thread_id, origin_kind, turn_id, provider_id, provider_thread_id, provider_request_id, status, payload, created_at, updated_at) VALUES (?, ?, 'provider', 'turn_capture', ?, ?, 'req_capture_vault', 'pending', ?, ?, ?)")
        .run("pi_capture_vault", bot.threadId, thread?.provider_id ?? "codex", bot.threadId, JSON.stringify({ kind: "user_question", questions: [{ id: "vault", prompt: "Which vault holds the deploy key?", allowFreeText: true, multiSelect: false }] }), Date.now() - 12 * 60_000, Date.now() - 12 * 60_000);
    } finally { studio.close(); bbDb.close(); }
    await bbCli(["studio", "settings", "set", "loopsEnabled", "true"]);
    // Three runners at work.
    const live = (await pluginRpc("studio", "bot_runners", {})).runners;
    for (const [name, job] of Object.entries(WORKING)) {
      const runner = live.find((each) => each.name === name);
      if (runner.running) continue;
      await pluginRpc("studio", "bot_runner_update", { id: runner.id, job });
      await pluginRpc("studio", "bot_runner_run_now", { id: runner.id });
    }
    const running = async () => (await pluginRpc("studio", "bot_runners", {})).runners.filter((runner) => runner.running).length;
    for (let i = 0; i < 60 && await running() < 3; i++) await sleep(2000);
    if (await running() < 3) throw new Error("Three runner runs didn't start");
    busy = true;
    return fixture;
  }

  /**
   * BB's sidebar collapsed before the shot (its projects and threads aren't
   * the fixture's), so the capture step doesn't move the page under a hover.
   */
  const collapseSidebar = async (client) => {
    const clicked = await client.evaluate(`(() => {
      const sidebar = document.querySelector('[data-sidebar="sidebar"]');
      if (['closed', 'collapsed'].includes(sidebar?.closest('[data-state]')?.getAttribute('data-state'))) return false;
      if (!sidebar?.checkVisibility() || sidebar.getBoundingClientRect().right <= 0) return false;
      const button = document.querySelector('button[aria-label^="Toggle sidebar" i]');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (clicked) await sleep(400);
  };
  /** The Bot page at full height (the whole scroll in one frame), in `mode`; Show frequent as `frequent`. */
  const page = async (client, mode, path = "", wait = [], frequent = false) => {
    await scheme(client, mode);
    const { bot } = await seed();
    await client.command("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 1000, deviceScaleFactor: 1, mobile: false });
    await client.navigate(`${BOT_PATH}/${bot.id}${path}`);
    await showFrequent(client, frequent);
    await client.command("Page.reload");
    await client.waitForSelector(path.startsWith("/controls") ? "[data-testid=bot-controls-page]" : "[data-testid=bot-page]", 30000);
    await dismissProblems(client);
    for (const text of wait) await client.waitForText(text, 60000);
    await collapseSidebar(client);
    const dark = await client.evaluate(`document.documentElement.classList.contains("dark")`);
    if (dark !== (mode === "dark")) throw new Error(`BB isn't in ${mode} mode`);
    return bot;
  };
  /** Grows the window to the page's full scroll height. */
  const fullHeight = async (client, selector) => {
    const extra = await client.evaluate(`(() => {
      let node = document.querySelector(${JSON.stringify(selector)});
      while (node && !(node.scrollHeight > node.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(node).overflowY))) node = node.parentElement;
      return node ? node.scrollHeight - node.clientHeight : 0;
    })()`);
    await client.command("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: Math.min(4000, 1000 + extra + 8), deviceScaleFactor: 1, mobile: false });
    await sleep(900);
  };
  const showFrequent = (client, on) => client.evaluate(`(() => { localStorage.setItem("studio.bot.showFrequent", ${on ? '"1"' : '"0"'}); return true; })()`);
  const toWeek = async (client) => {
    await client.waitForSelector("[data-testid=automations-calendar] [data-group]", 60000);
    await client.evaluate(`(() => { document.querySelector("[data-testid=bot-automations]").scrollIntoView({ block: "start" }); return true; })()`);
    await sleep(500);
  };
  const hover = async (client, selector, how = "hover") => {
    const point = await client.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("Nothing at ${selector.replace(/"/g, "'")}"); const r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 }; })()`);
    await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, buttons: 0 });
    if (how === "click") {
      await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
      await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    }
    await client.waitForSelector("[data-testid=calendar-group]", 5000);
    await sleep(500);
  };
  const today = `[data-day="${new Date().toDateString()}"]`;

  const both = (name, setup) => ["dark", "light"].map((mode) => ({
    id: `studio-bot-redesign-${name}-${mode}`, packageDir: "bb-studio", fileName: `bot-redesign/${name}-${mode}.png`, privateSidebar: false,
    setup: async (client) => { try { await setup(client, mode); } catch (error) { await scheme(client, ""); throw error; } },
  }));

  return [
    // Quiet first: nothing running, nothing waiting.
    ...both("main-quiet", async (client, mode) => {
      await page(client, mode, "", ["Nothing running, and nothing needs you.", "Area sweep", "Midday check", "Paused", "Recent", "Runners"]);
      await client.waitForText("Frequent checks ran", 30000);
      await fullHeight(client, "[data-testid=bot-page]");
    }),
    ...both("main-busy", async (client, mode) => {
      await makeBusy();
      await page(client, mode, "", ["Working now", "Needs you", "Security check failed", "Which vault holds the deploy key?", "Pay the property tax installment", "Archive 3 finished threads?", "Drafting replies to 3 emails"]);
      await client.waitForSelector('[data-testid=automations-calendar] [data-group][data-status="failed"]', 30000);
      await client.waitForText("Loops", 30000);
      await fullHeight(client, "[data-testid=bot-page]");
    }),
    ...both("cal-frequent", async (client, mode) => {
      await makeBusy();
      await page(client, mode, "", ["Frequent:"], true);
      await client.waitForSelector("[data-testid=automations-calendar] [data-band]", 30000);
      await client.command("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 1100, deviceScaleFactor: 1, mobile: false });
      await toWeek(client);
    }),
    ...both("cal-group", async (client, mode) => {
      await makeBusy();
      await page(client, mode, "", ["Area sweep"]);
      await client.command("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 1100, deviceScaleFactor: 1, mobile: false });
      await toWeek(client);
      await hover(client, `${today} [data-group][aria-label^="Area sweep"]`, "click");
      await client.evaluate(`(() => { if (!document.querySelector("[data-testid=calendar-group]").textContent.includes("2 new emails")) throw new Error("The Area sweep list doesn't say Comms found 2 new emails"); return true; })()`);
    }),
    ...both("cal-failed", async (client, mode) => {
      await makeBusy();
      await page(client, mode, "", ["Midday check"]);
      await client.command("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 1100, deviceScaleFactor: 1, mobile: false });
      await toWeek(client);
      await hover(client, `${today} [data-group][data-status="failed"]`);
      await client.evaluate(`(() => { const card = document.querySelector("[data-testid=calendar-group]"); if (card.closest("[data-state=closed]") || !/couldn't sign in to Wyze/.test(card.textContent) || !card.textContent.includes("Run again")) throw new Error("The failure card isn't open with the failure and Run again"); return true; })()`);
    }),
    ...both("controls-page", async (client, mode) => {
      await makeBusy();
      await page(client, mode, "/controls", ["Profile", "Model", "Memory", "Skills", "Check-ins", "Prompt cache", "Maintenance", "Profile changes"]);
      await fullHeight(client, "[data-testid=bot-controls-page]");
    }),
    ...both("pane-compact", async (client, mode) => {
      const { bot } = await makeBusy();
      await scheme(client, mode);
      await client.command("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
      await client.navigate(`/threads/${bot.threadId}`);
      await dismissProblems(client);
      // Bot info opens beside the chat by itself; else its header action.
      if (!(await client.poll(`!!document.querySelector("[data-testid=bot-pane]")`))) await clickHeaderAction(client, "^Bot info$", 60000);
      await collapseSidebar(client);
      await client.waitForSelector("[data-testid=bot-pane]", 30000);
      for (const text of ["Working now", "Needs you", "Up next", "Recent", "Controls"]) await client.waitForText(text, 30000);
      await sleep(800);
    }),
  ];
};
