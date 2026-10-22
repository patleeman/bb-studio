import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { botFixtures, BOT_PATH } from "./bb-studio-bot.mjs";
import {
  advanceMaintenanceWindow,
  backdateThread,
  stagedAutomation,
  stagedPendingInteraction,
  stagedThread,
} from "./bot-capture-fixtures.mjs";

const exec = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();

/** Real maintenance exercise and its matching Bot info screenshot. */
export default function maintenanceCaptures(context) {
  const { bbCli, pluginRpc, projectId, sleep } = context;
  const { json, seededBot } = botFixtures(context);

  const seed = async () => {
    const bot = await seededBot();
    const chain = await pluginRpc("studio", "bot_chain", { botId: bot.id });
    const children = (await Promise.all(chain.threadIds.map((parent) => json(["thread", "list", "--parent-thread", parent, "--include-hidden"]).catch(() => [])))).flat();
    const pending = children.find((thread) => thread.title === "Rotate the ORBIT-42 deploy key");
    const targeted = children.find((thread) => thread.title === "Check the launch checklist for blockers");
    const clean = children.find((thread) => thread.title === "Summarize this week's ORBIT-42 threads");
    if (!pending) throw new Error("Could not seed the Bot's pending-question thread");
    if (!targeted) throw new Error("Could not seed a finished Bot-owned thread for the automation target");
    if (!clean) throw new Error("Could not seed a Bot-owned thread for the clean workspace case");
    await bbCli(["thread", "wait", clean.id, "--status", "idle", "--timeout", "180"]);
    const interaction = stagedPendingInteraction(pending.id);
    if (!interaction || interaction.status !== "pending") throw new Error(`The pending-question fixture is ${interaction?.status ?? "missing"}, not pending`);

    // Use two existing Bot-owned idle children so the fixtures remain inside
    // the staged seed, with one pushed clean branch and one dirty checkout.
    const workspaceThread = process.env.BB_CAPTURE_WORKSPACE_THREAD_ID;
    if (!workspaceThread) throw new Error("The staged seed has no Orbit workspace thread");
    const workspace = JSON.parse(await bbCli(["thread", "show", workspaceThread, "--json"])).environment?.path;
    if (!workspace) throw new Error("The staged workspace thread has no Git checkout");
    const dirtyChildren = await json(["thread", "list", "--parent-thread", clean.id, "--include-hidden"]);
    const dirty = dirtyChildren.find((thread) => thread.title === "Pull the ORBIT-42 thread digests");
    if (!dirty) throw new Error("Could not seed a Bot-owned thread for the dirty workspace case");
    await bbCli(["thread", "wait", dirty.id, "--status", "idle", "--timeout", "180"]);
    // Its completion wakes the parent with a child-completed message. Wait
    // for that follow-up too; the clean candidate below is a separate sibling.
    await bbCli(["thread", "wait", clean.id, "--status", "idle", "--timeout", "180"]);
    const fixtureRoot = join(dirname(process.env.BB_DATA_DIR), "maintenance-fixtures");
    const configuredRemotes = exec("git", ["-C", workspace, "remote"]).split("\n");
    if (configuredRemotes.includes("origin")) exec("git", ["-C", workspace, "remote", "remove", "origin"]);
    rmSync(fixtureRoot, { recursive: true, force: true });
    mkdirSync(fixtureRoot, { recursive: true });
    const origin = join(fixtureRoot, "origin.git");
    exec("git", ["clone", "--quiet", "--bare", workspace, origin]);
    const cleanPath = JSON.parse(await bbCli(["thread", "show", clean.id, "--json"])).environment?.path;
    const dirtyPath = JSON.parse(await bbCli(["thread", "show", dirty.id, "--json"])).environment?.path;
    if (!cleanPath || !dirtyPath) throw new Error("The clean and dirty Bot threads need registered worktree paths");
    exec("git", ["-C", cleanPath, "remote", "add", "origin", origin]);
    exec("git", ["-C", cleanPath, "fetch", "--quiet", "origin", "main"]);
    exec("git", ["-C", cleanPath, "branch", "--set-upstream-to=origin/main"]);
    // Only tracked changes block an archive; untracked scratch files don't.
    const trackedFile = exec("git", ["-C", dirtyPath, "ls-files"]).split("\n")[0];
    if (!trackedFile) throw new Error("The dirty workspace fixture has no tracked file to change");
    appendFileSync(join(dirtyPath, trackedFile), "\nUncommitted staged maintenance fixture.\n");
    if (exec("git", ["-C", cleanPath, "status", "--porcelain"])) throw new Error("The clean workspace fixture is already dirty");
    if (exec("git", ["-C", cleanPath, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]) !== "origin/main") throw new Error("The clean workspace fixture does not track origin/main");
    if (!exec("git", ["-C", dirtyPath, "status", "--porcelain"])) throw new Error("The dirty workspace fixture has no uncommitted file");

    // The existing finished child is aged too, so removing automation-target
    // protection would make the test fail by archiving it.
    for (const id of [clean.id, dirty.id, pending.id, targeted.id]) backdateThread(id, 8);
    const cleanRow = JSON.parse(await bbCli(["thread", "show", clean.id, "--json"]));
    const dirtyRow = JSON.parse(await bbCli(["thread", "show", dirty.id, "--json"]));
    if (!cleanRow.environment?.id || !dirtyRow.environment?.id) throw new Error("The clean and dirty thread fixtures need workspace environments");
    const cleanBranch = exec("git", ["-C", cleanPath, "branch", "--show-current"]);
    const remoteBranch = `origin/${cleanBranch}`;
    exec("git", ["-C", cleanPath, "push", "--quiet", "-u", "origin", cleanBranch]);
    await bbCli(["environment", "update", cleanRow.environment.id, "--merge-base-branch", remoteBranch]);
    const cleanStatus = JSON.parse(await bbCli(["environment", "status", cleanRow.environment.id, "--merge-base-branch", remoteBranch, "--json"]));
    const dirtyStatus = JSON.parse(await bbCli(["environment", "status", dirtyRow.environment.id, "--json"]));
    if (cleanStatus.outcome !== "available" || cleanStatus.workspace.workingTree.state !== "clean" || cleanStatus.workspace.mergeBase?.mergeBaseBranch !== remoteBranch || cleanStatus.workspace.mergeBase.aheadCount !== 0 || cleanStatus.workspace.mergeBase.hasCommittedUnmergedChanges) {
      throw new Error(`The eligible workspace is not provably clean and pushed: ${JSON.stringify(cleanStatus)}`);
    }
    if (dirtyStatus.outcome !== "available" || dirtyStatus.workspace.workingTree.state === "clean" || !dirtyStatus.workspace.workingTree.hasUncommittedChanges) {
      throw new Error(`The dirty workspace fixture was not reported dirty: ${JSON.stringify(dirtyStatus)}`);
    }

    // A live, future-scheduled automation protects this old finished child.
    const overviewBefore = await pluginRpc("automations", "automations_overview", null);
    if (!overviewBefore.automations.some((entry) => entry.automation.enabled && entry.automation.execution.targetThreadId === targeted.id)) {
      await bbCli([
        "automation", "create", "--project", projectId, "--name", "Maintenance target guard",
        "--cron", "0 0 1 1 *", "--timezone", "UTC", "--prompt", "Reply exactly [PASS].",
        "--provider", "codex", "--model", "gpt-6.1-sol", "--target-thread", targeted.id, "--json",
      ]);
    }
    const overview = await pluginRpc("automations", "automations_overview", null);
    if (!overview.automations.some((entry) => entry.automation.enabled && entry.automation.execution.targetThreadId === targeted.id)) {
      throw new Error("The targeted thread has no live automation pointing at it");
    }

    // The staged fixtures predate the plugin's ownership sweep. Adopt them
    // through the same supported operation as the Bot sidebar so Maintenance
    // sees each one in both its dry and live runs.
    for (const threadId of [dirty.id, pending.id, targeted.id]) {
      await pluginRpc("studio", "bot_thread_adopt", { botId: bot.id, threadId });
      const owner = await pluginRpc("studio", "bot_thread_owner", { threadId });
      if (owner.botId !== bot.id) throw new Error(`The staged fixture ${threadId} is owned by ${owner.botId ?? "no Bot"}, not ${bot.id}`);
    }

    // Keep the clean candidate out of the worker's child-completed chain: that
    // system reply refreshes its parent timestamp. Start a direct Bot sibling
    // with the pushed clean environment and wait for its real final answer.
    const cleanThread = JSON.parse(await bbCli([
      "thread", "spawn", "--project", projectId, "--environment", cleanRow.environment.id,
      "--parent-thread", bot.threadId, "--provider", "codex", "--model", "gpt-6.1-sol",
      "--reasoning-level", "low", "--title", "Maintenance clean workspace thread",
      "--prompt", "Reply exactly [PASS].", "--json",
    ]));
    await bbCli(["thread", "wait", cleanThread.id, "--status", "idle", "--timeout", "180"]);
    await pluginRpc("studio", "bot_thread_adopt", { botId: bot.id, threadId: cleanThread.id });
    const cleanOwner = await pluginRpc("studio", "bot_thread_owner", { threadId: cleanThread.id });
    if (cleanOwner.botId !== bot.id) throw new Error(`The clean fixture is owned by ${cleanOwner.botId ?? "no Bot"}, not ${bot.id}`);
    for (const id of [cleanThread.id, dirty.id, pending.id, targeted.id]) backdateThread(id, 8);
    const agedClean = stagedThread(cleanThread.id);
    if (!agedClean || Date.now() - agedClean.updated_at < 4 * 86_400_000) throw new Error("The clean finished fixture is not older than four days");

    const before = [cleanThread.id, dirty.id, pending.id, targeted.id].map((id) => stagedThread(id));
    if (before.some((thread) => !thread || thread.archived_at != null)) throw new Error("A maintenance fixture was archived before the dry run");
    return { bot, clean: cleanThread.id, dirty: dirty.id, pending: pending.id, targeted: targeted.id };
  };

  // Create a real one-shot after Bot info mounts. Schedule it after both real
  // dry runs so the live Run now can move its completed reminder to Done.
  const seedReminder = async (bot) => {
    const scheduledAt = Date.now() + 45_000;
    const reminder = await pluginRpc("studio", "bot_automation_create", {
      botId: bot.id, kind: "reminder", name: `Maintenance one-shot reminder ${Date.now()}`,
      instruction: "Reply exactly [PASS].", schedule: { type: "once", at: scheduledAt },
      model: { model: "gpt-6.1-sol", reasoning: "low" },
    });
    const localReminder = stagedAutomation(reminder.id);
    const backingIds = JSON.parse(localReminder?.bb_ids ?? "[]");
    if (localReminder?.state !== "active" || !backingIds.length) throw new Error("The one-shot reminder has no active backing automation");
    return { id: reminder.id, state: localReminder.state, backingIds, scheduledAt };
  };

  const inspectDryRun = async (fixture) => {
    const view = await pluginRpc("studio", "bot_maintenance_get", { botId: fixture.bot.id });
    const last = view.runs[0];
    if (!view.settings.enabled || view.liveAt <= Date.now() || !last?.dryRun || (!last.summary.startsWith("Dry run: would archive") && !last.summary.startsWith("Dry run stopped:"))) {
      throw new Error(`Turning maintenance on did not start a one-day dry run with a summary: ${JSON.stringify(last)}`);
    }
    for (const id of [fixture.clean, fixture.dirty, fixture.pending, fixture.targeted]) {
      if (stagedThread(id)?.archived_at != null) throw new Error(`Dry run archived ${id}`);
    }
    const reminderState = stagedAutomation(fixture.reminder)?.state ?? null;
    return {
      succeeded: last.summary.startsWith("Dry run: would archive"),
      eligible: last.actions.some((action) => action.includes("Maintenance clean workspace thread")),
      dirtyNeedsCall: last.needsCall.some((entry) => entry.threadId === fixture.dirty),
      cleanNeedsCall: last.needsCall.some((entry) => entry.threadId === fixture.clean),
      reminderUnchanged: reminderState === fixture.reminderStateBefore,
      reminderState,
      summary: last.summary,
    };
  };

  const captures = [{
    id: "studio-bot-maintenance", packageDir: "bb-studio", fileName: "bot-maintenance.png",
    setup: async (client) => {
      const fixture = await seed();
      await client.navigate(`${BOT_PATH}/${fixture.bot.id}`);
      await client.waitForSelector('[data-testid="bot-maintenance"]', 30000);
      const reminder = await seedReminder(fixture.bot);
      fixture.reminder = reminder.id;
      fixture.reminderStateBefore = reminder.state;
      fixture.reminderBackingIds = reminder.backingIds;
      fixture.reminderScheduledAt = reminder.scheduledAt;
      // Opening Bot info and creating a schedule can touch the Bot's recent
      // threads. Apply the test clock last, then verify the SDK-facing age.
      for (const id of [fixture.clean, fixture.dirty, fixture.pending, fixture.targeted]) backdateThread(id, 8);
      const agedClean = stagedThread(fixture.clean);
      if (!agedClean || Date.now() - agedClean.updated_at < 4 * 86_400_000) throw new Error("The clean finished fixture is not older than four days");
      let current = await pluginRpc("studio", "bot_maintenance_get", { botId: fixture.bot.id });
      if (current.settings.enabled && current.liveAt <= Date.now()) {
        await client.evaluate(`(() => { const checkbox = document.querySelector('[data-testid="bot-maintenance"] input[type="checkbox"]'); if (checkbox.checked) checkbox.click(); return true; })()`);
        await sleep(500);
        current = await pluginRpc("studio", "bot_maintenance_get", { botId: fixture.bot.id });
      }
      const runsBeforeEnable = current.runs.length;
      await client.evaluate(`(() => {
        const section = document.querySelector('[data-testid="bot-maintenance"]');
        if (!section) throw new Error("Maintenance section is missing");
        section.scrollIntoView({ block: "start" });
        section.querySelector("details").open = true;
        const checkbox = section.querySelector('input[type="checkbox"]');
        if (!checkbox.checked) checkbox.click();
        return true;
      })()`);
      await client.waitForText("Dry run until", 30000);
      let enabledView = null;
      for (let i = 0; i < 120; i++) {
        enabledView = await pluginRpc("studio", "bot_maintenance_get", { botId: fixture.bot.id });
        if ((current.settings.enabled && current.liveAt > Date.now() && enabledView.runs.length > 0) || (enabledView.runs.length > runsBeforeEnable && enabledView.runs[0]?.dryRun)) break;
        await sleep(1000);
      }
      if (!enabledView?.runs[0]?.dryRun) throw new Error("Turning maintenance on did not record its initial dry run");
      const initialDryRun = await inspectDryRun(fixture);
      if (!initialDryRun.eligible || !initialDryRun.dirtyNeedsCall || initialDryRun.cleanNeedsCall || !initialDryRun.reminderUnchanged) {
        throw new Error(`The initial dry run did not classify the clean, dirty and reminder fixtures: ${JSON.stringify(initialDryRun)}`);
      }
      if (initialDryRun.succeeded) await client.waitForText("Dry run: would archive", 30000);
      else await client.waitForText("Dry run stopped", 30000);
      const enabledRuns = enabledView.runs.length;
      await client.evaluate(`(() => {
        const section = document.querySelector('[data-testid="bot-maintenance"]');
        [...section.querySelectorAll("button")].find((button) => button.textContent.trim() === "Dry run").click();
        return true;
      })()`);
      let latest = null;
      for (let i = 0; i < 120; i++) {
        const view = await pluginRpc("studio", "bot_maintenance_get", { botId: fixture.bot.id });
        latest = view.runs[0] ?? null;
        if (view.runs.length > enabledRuns && latest?.dryRun) break;
        await sleep(1000);
      }
      if (!latest?.dryRun) throw new Error("The explicit Dry run button did not record a new preview");
      const refreshedDryRun = await inspectDryRun(fixture);
      if (!refreshedDryRun.eligible || !refreshedDryRun.dirtyNeedsCall || refreshedDryRun.cleanNeedsCall || !refreshedDryRun.reminderUnchanged) {
        throw new Error(`The explicit dry run did not preserve the expected classification: ${JSON.stringify(refreshedDryRun)}`);
      }
      if (refreshedDryRun.succeeded) {
        await client.waitForText("Proposed actions", 30000);
        await client.evaluate(`(() => {
          const section = document.querySelector('[data-testid="bot-maintenance"]');
          const proposed = [...section.querySelectorAll("summary")].find((summary) => summary.textContent.includes("Proposed actions"));
          if (!proposed) throw new Error("The dry-run actions are missing");
          proposed.parentElement.open = true;
          const needsCall = [...section.querySelectorAll("h4")].find((heading) => heading.textContent.includes("Needs your call"));
          if (!needsCall) throw new Error("Needs your call is missing from the dry-run summary");
          section.scrollIntoView({ block: "start" });
          return true;
        })()`);
        await client.waitForText("Needs your call", 30000);
        await client.waitForText("Pull the ORBIT-42 thread digests", 30000);
      } else {
        await client.waitForText("Dry run stopped", 30000);
        await client.evaluate(`document.querySelector('[data-testid="bot-maintenance"]')?.scrollIntoView({ block: "start" })`);
      }
      await sleep(700);

      // Captures happen before this cleanup. Bot info's separate Automations
      // panel reconciles completed one-shot reminders to Done when it polls.
      // Unmount that panel after the screenshot so Maintenance can make and
      // record the transition itself. The settings row is the only test clock
      // moved, and this RPC is the same handler used by Run now.
      return async () => {
        await client.navigate("/");
        if (await client.poll('Boolean(document.querySelector("[data-testid=\\\"bot-maintenance\\\"]"))')) {
          throw new Error("Bot info stayed mounted while waiting for the reminder schedule");
        }
        let completedReminder = null;
        for (let i = 0; i < 120; i++) {
          const overview = await pluginRpc("automations", "automations_overview", null);
          completedReminder = overview.automations.find((entry) => fixture.reminderBackingIds.includes(entry.automation.id))?.automation ?? null;
          if (completedReminder?.lastRunStatus === "succeeded" && completedReminder.lastRunAt && completedReminder.nextRunAt == null) break;
          if (completedReminder?.lastRunStatus && !["running", "succeeded"].includes(completedReminder.lastRunStatus.toLowerCase())) {
            throw new Error(`The one-shot reminder finished ${completedReminder.lastRunStatus}`);
          }
          await sleep(1000);
        }
        if (completedReminder?.lastRunStatus !== "succeeded" || !completedReminder.lastRunAt || completedReminder.nextRunAt != null) {
          throw new Error(`The scheduled one-shot reminder did not finish through its real schedule: ${JSON.stringify(completedReminder)}`);
        }
        const reminderBeforeMaintenance = stagedAutomation(fixture.reminder);
        if (reminderBeforeMaintenance?.state !== "active") throw new Error(`The reminder moved to ${reminderBeforeMaintenance?.state ?? "missing"} before Maintenance ran`);
        advanceMaintenanceWindow(fixture.bot.id);
        await pluginRpc("studio", "bot_maintenance_run", { botId: fixture.bot.id, dryRun: false });
        for (let i = 0; i < 120; i++) {
          const view = await pluginRpc("studio", "bot_maintenance_get", { botId: fixture.bot.id });
          if (view.runs.length > enabledRuns + 1 && !view.runs[0]?.dryRun) { latest = view.runs[0]; break; }
          await sleep(1000);
        }
        const view = await pluginRpc("studio", "bot_maintenance_get", { botId: fixture.bot.id });
        const live = view.runs[0];
        if (!live || live.dryRun || view.runs.length <= enabledRuns + 1) throw new Error(`Run now did not record a live maintenance result: ${JSON.stringify(live)}`);
        const cleanArchived = stagedThread(fixture.clean)?.archived_at != null;
        const dirtyArchived = stagedThread(fixture.dirty)?.archived_at != null;
        const pendingArchived = stagedThread(fixture.pending)?.archived_at != null;
        const targetedArchived = stagedThread(fixture.targeted)?.archived_at != null;
        const interaction = stagedPendingInteraction(fixture.pending);
        const targeted = await pluginRpc("automations", "automations_overview", null);
        const automationUntouched = targeted.automations.some((entry) => entry.automation.enabled && entry.automation.execution.targetThreadId === fixture.targeted);
        const reminderDone = stagedAutomation(fixture.reminder)?.state === "done";
        const activity = await pluginRpc("studio", "bot_activity", { botId: fixture.bot.id });
        const actualRuns = (activity.maintenance ?? []).filter((run) => !run.dryRun);
        const archiveActions = live.actions.filter((action) => action.startsWith("Archive "));
        const observed = {
          initialDryRunEligible: initialDryRun.eligible,
          initialDryRunSummary: initialDryRun.summary,
          initialDirtyNeedsCall: initialDryRun.dirtyNeedsCall,
          explicitDryRunEligible: refreshedDryRun.eligible,
          explicitDryRunSummary: refreshedDryRun.summary,
          explicitDirtyNeedsCall: refreshedDryRun.dirtyNeedsCall,
          reminderStateBeforeMaintenance: reminderBeforeMaintenance.state,
          reminderLastRunStatus: completedReminder.lastRunStatus,
          reminderLastRunAt: completedReminder.lastRunAt,
          reminderStateAfterDryRun: refreshedDryRun.reminderState,
          reminderUnchangedAfterDryRun: refreshedDryRun.reminderUnchanged,
          cleanNeedsCall: refreshedDryRun.cleanNeedsCall,
          cleanArchived,
          dirtyNeedsCall: live.needsCall.some((entry) => entry.threadId === fixture.dirty),
          archivedActions: archiveActions,
          dirtyArchived,
          pendingArchived,
          pendingInteraction: interaction?.status ?? null,
          targetedArchived,
          automationUntouched,
          reminderDone,
          activityLiveEntries: actualRuns.length,
          liveSummary: live.summary,
        };
        process.stdout.write(`Maintenance staged observations: ${JSON.stringify(observed)}\n`);
        if (!cleanArchived || dirtyArchived || pendingArchived || targetedArchived || interaction?.status !== "pending" || !automationUntouched || !reminderDone || reminderBeforeMaintenance.state !== "active" || !actualRuns[0]?.actions.some((action) => action.includes("Move done reminder to Done:")) || actualRuns.length !== 1 || !actualRuns[0]?.summary.startsWith("Archived 1 finished threads") || archiveActions.length !== 1 || !archiveActions[0]?.includes("Maintenance clean workspace thread") || !live.needsCall.some((entry) => entry.threadId === fixture.dirty) || !initialDryRun.eligible || !initialDryRun.dirtyNeedsCall || !refreshedDryRun.eligible || !refreshedDryRun.dirtyNeedsCall) {
          throw new Error(`Staged maintenance acceptance failed: expected only the clean finished thread to archive. Observed ${JSON.stringify(observed)}`);
        }
      };
    },
  }];
  return captures;
}
