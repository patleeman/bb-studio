// The Bot page's Needs you failures (src/ui/bot/pageModel.ts failedRuns, and
// BotPage.tsx's rows), from a staged BB seeded with Patrick's live cases:
//
// - Morning card: Saturday's 8:00 AM Morning kick failed ("Script exited with
//   code null"); today's 8:00 AM run since was a quiet "skipped: empty
//   output". It's no longer a failure.
// - Project Lead: a runner paused on purpose, whose Wednesday 12:00 AM run
//   failed ("Target thread thr_… is in an error state"). It stays out of
//   Needs you; Paused marks it.
// - Three failures that still need Patrick, one per known error shape:
//   Status probe ("Script exited with code 2"), Backup check ("Target thread
//   thr_… is in an error state") and Evening wrap-up (a timeout, in the Bot's
//   chat at the message it sent, so Open deep-links to it).
//
// The ids are studio-bot-needs-you-<mode>; BB_NEEDS_YOU_PHASE (before or
// after, default after) names the files: assets/needs-you/<phase>-<mode>.png.
// In the after phase the capture also clicks Open on Evening wrap-up and
// checks BB went to the chat at that message (/threads/<id>#msg=<seq>).
import { createRequire } from "node:module";
import { join } from "node:path";
import { readStagedInstance } from "../../staged-instance.mjs";
import { BOT_PATH, dismissProblems } from "./bb-studio-bot.mjs";

const require = createRequire(import.meta.url);
const ALL = [0, 1, 2, 3, 4, 5, 6];
const PHASE = process.env.BB_NEEDS_YOU_PHASE === "before" ? "before" : "after";
const QUIET_SCRIPT = { body: "exit 0", interpreter: "bash", timeoutMs: 30000 };
const daily = (time) => ({ type: "times", days: ALL, times: [time] });
const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });

function stagedDb(name) {
  const { dataDir } = readStagedInstance();
  const Database = require("../../../packages/bb-studio/node_modules/better-sqlite3");
  return new Database(join(dataDir, name), { timeout: 5000 });
}
/** Local wall-clock time `days` from today. */
const at = (days, hour, minute = 0) => { const date = new Date(); date.setDate(date.getDate() + days); date.setHours(hour, minute, 0, 0); return date.getTime(); };
/** Days back to the last `weekday` (0 Sunday) before today. */
const back = (weekday) => -(((new Date().getDay() - weekday + 7) % 7) || 7);

export default ({ pluginRpc, bbCli, sleep }) => {
  let seeded = null;
  const waitIdle = async (threadId, timeout = 300) => { if (threadId) await bbCli(["thread", "wait", threadId, "--status", "idle", "--timeout", String(timeout)]).catch(() => {}); };

  async function seed() {
    if (seeded) return seeded;
    let { bot } = await pluginRpc("studio", "bot_get", {});
    if (!bot) {
      ({ bot } = await pluginRpc("studio", "bot_create", { name: "Chief of Staff", avatar: "🧭", shape: "blob", color: "#2ba59a", prompt: "Reply with one short sentence: you're ready to keep the week moving." }));
      await waitIdle(bot.threadId, 240);
    }
    await pluginRpc("studio", "bot_checkin_preset", { preset: "off" }).catch(() => {});
    let { runners } = await pluginRpc("studio", "bot_runners", {});
    let lead = runners.find((runner) => runner.name === "Project Lead");
    if (!lead) {
      lead = await pluginRpc("studio", "bot_runner_create", { name: "Project Lead", job: "Run the GB Studio standup. There is nothing new: finish without any message.", schedule: { cadence: "daily", time: "00:00" } });
      await waitIdle(lead.threadId);
    }
    if (lead.state !== "paused") await pluginRpc("studio", "bot_runner_pause", { id: lead.id });
    let { automations } = await pluginRpc("studio", "bot_automations", {});
    const jobs = [
      ["watcher", "Morning card", daily("08:00")],
      ["watcher", "Status probe", daily("13:00")],
      ["watcher", "Backup check", daily("06:00")],
      ["checkin", "Evening wrap-up", daily("18:00")],
    ];
    for (const [kind, name, schedule] of jobs) {
      if (automations.some((each) => each.name === name)) continue;
      await pluginRpc("studio", "bot_automation_create", { kind, name, schedule, instruction: kind === "watcher" ? "Tell me only what's new." : "Wrap up the day: what got done and what's left for tomorrow.", ...(kind === "watcher" ? { script: QUIET_SCRIPT, target: "main" } : {}) });
    }
    ({ automations } = await pluginRpc("studio", "bot_automations", {}));
    seeded = { bot, lead, automations };
    writeHistory(seeded);
    return seeded;
  }

  /** The runs, written into the staged automations database (every other run of these jobs removed). */
  function writeHistory({ bot, lead, automations }) {
    const db = stagedDb("plugins/automations/data.db");
    const studio = stagedDb("plugins/studio/data.db");
    const bbDb = stagedDb("bb.db");
    try {
      const mode = new Map(db.prepare("SELECT id, run_mode FROM automations").all().map((row) => [row.id, row.run_mode]));
      const bbId = (name) => automations.find((each) => each.name === name)?.bbIds?.[0];
      const leadRow = studio.prepare("SELECT automation_id, thread_id FROM bot_runners WHERE id = ?").get(lead.id);
      // The Bot's first message in its chat: the Evening wrap-up run that timed out sent it.
      const sent = bbDb.prepare("SELECT sequence AS seq, created_at FROM events WHERE thread_id = ? AND type = 'client/turn/requested' ORDER BY sequence LIMIT 1").get(bot.threadId);
      if (!sent) throw new Error("The Bot's chat has no message for Evening wrap-up's run");
      const runs = [
        // Saturday's Morning kick failed; today's run was quiet.
        { bbId: bbId("Morning card"), when: at(-1, 8), status: "failed", error: "Script exited with code null", exit: null },
        { bbId: bbId("Morning card"), when: at(0, 8), status: "skipped", skip: "empty output", exit: 0 },
        // Project Lead, paused: Wednesday's midnight run failed.
        { bbId: leadRow.automation_id, when: at(back(3), 0), status: "failed", error: `Target thread ${leadRow.thread_id} is in an error state`, thread: leadRow.thread_id },
        // Still failing.
        { bbId: bbId("Status probe"), when: at(-1, 13), status: "skipped", skip: "empty output", exit: 0 },
        { bbId: bbId("Status probe"), when: at(0, 13), status: "failed", error: "Script exited with code 2", exit: 2 },
        { bbId: bbId("Backup check"), when: at(0, 6), status: "failed", error: `Target thread ${bot.threadId} is in an error state`, exit: 0 },
        { bbId: bbId("Evening wrap-up"), when: sent.created_at - 500, status: "failed", error: "Timed out waiting for the turn to finish", thread: bot.threadId },
      ];
      for (const run of runs) if (!run.bbId || !mode.has(run.bbId)) throw new Error(`No staged automation for a run at ${new Date(run.when)}`);
      db.transaction(() => {
        for (const id of new Set(runs.map((run) => run.bbId))) db.prepare("DELETE FROM automation_runs WHERE automation_id = ?").run(id);
        const insert = db.prepare("INSERT INTO automation_runs (id, automation_id, run_mode, thread_id, status, trigger, skip_reason, error, output, exit_code, idempotency_key, scheduled_for, started_at, finished_at) VALUES (?, ?, ?, ?, ?, 'schedule', ?, ?, NULL, ?, NULL, ?, ?, ?)");
        for (const run of runs) insert.run(`run_needsyou_${run.bbId}_${run.when}`, run.bbId, mode.get(run.bbId), run.thread ?? null, run.status, run.skip ?? null, run.error ?? null, run.exit ?? null, run.when, run.when, run.when + 30_000);
        for (const id of new Set(runs.map((run) => run.bbId))) {
          const last = runs.filter((run) => run.bbId === id).sort((a, b) => b.when - a.when)[0];
          db.prepare("UPDATE automations SET last_run_at = ?, last_run_status = ?, last_error = ? WHERE id = ?").run(last.when, last.status, last.error ?? null, id);
        }
      })();
      studio.prepare("DELETE FROM bot_run_dismissals").run();
      studio.prepare("UPDATE bot_runners SET last_run_at = ? WHERE id = ?").run(at(back(3), 0), lead.id);
      seeded.sent = sent;
    } finally { db.close(); studio.close(); bbDb.close(); }
  }

  const NEEDS = '[data-testid="bot-needs"]';
  /** The Needs you section, with a margin. */
  const clipNeeds = (client) => client.evaluate(`(() => {
    const section = document.querySelector(${JSON.stringify(NEEDS)});
    if (!section) throw new Error("No Needs you section");
    const rect = section.getBoundingClientRect();
    return { x: Math.max(0, rect.x - 16), y: Math.max(0, rect.y - 12), width: rect.width + 32, height: rect.height + 24 };
  })()`);

  return ["dark", "light"].map((mode) => ({
    id: `studio-bot-needs-you-${mode}`, packageDir: "bb-studio", fileName: `needs-you/${PHASE}-${mode}.png`, privateSidebar: false,
    clip: clipNeeds,
    setup: async (client) => {
      try {
        await scheme(client, mode);
        const { bot } = await seed();
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
        await client.navigate(`${BOT_PATH}/${bot.id}`);
        await client.waitForSelector("[data-testid=bot-page]", 30000);
        await dismissProblems(client);
        await client.waitForText("Status probe failed", 60000);
        await client.waitForText("Evening wrap-up failed", 60000);
        const rows = await client.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${NEEDS} li`)})].map((row) => row.textContent)`);
        const text = rows.join("\n");
        if (PHASE === "before") {
          // main as it was: the stale failures, and the raw errors after "It ".
          for (const want of ["Morning card failed Sat at 8:00 AM", "Project Lead check failed Wed at 12:00 AM", "It Script exited with code 2"]) if (!text.includes(want)) throw new Error(`Before: Needs you lacks "${want}": ${text}`);
        } else {
          for (const want of ["The script stopped with an error (exit 2).", "Its thread hit an error.", "It took too long."]) if (!text.includes(want)) throw new Error(`After: Needs you lacks "${want}": ${text}`);
          for (const gone of ["Morning card", "Project Lead", "It Script", "code null", "thr_"]) if (text.includes(gone)) throw new Error(`After: Needs you still shows "${gone}": ${text}`);
          const paused = await client.evaluate(`document.querySelector("[data-testid=calendar-paused]")?.textContent ?? ""`);
          if (!/Project Lead.*Last run failed/.test(paused)) throw new Error(`After: Paused doesn't mark Project Lead failed: ${paused}`);
          if (mode === "light") {
            // Open on Evening wrap-up goes to the Bot's chat at the message its run sent.
            await client.evaluate(`(() => { const row = [...document.querySelectorAll(${JSON.stringify(`${NEEDS} li`)})].find((each) => each.textContent.includes("Evening wrap-up")); [...row.querySelectorAll("button")].find((each) => each.textContent === "Open").click(); return true; })()`);
            const want = `/threads/${bot.threadId}#msg=${seeded.sent.seq}`;
            let href = "";
            for (let i = 0; i < 40 && !href.includes(want); i++) { await sleep(250); href = await client.evaluate("location.pathname + location.hash"); }
            if (!href.includes(want)) throw new Error(`Open went to ${href}, not ${want}`);
            await client.navigate(`${BOT_PATH}/${bot.id}`);
            await client.waitForText("Evening wrap-up failed", 60000);
          }
        }
        await sleep(600);
      } catch (error) { await scheme(client, ""); throw error; }
    },
  }));
};
