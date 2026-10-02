import { fallbackRoomTitle, isAutoTitlePlaceholder, maxRoomTitleLength, roomTitleThreadPrefix, sanitizeRoomTitle, titleWorkerPriority, type TitleWorker, type TitleTask } from "./room-titles";
export { fallbackRoomTitle, isAutoTitlePlaceholder, roomTitleThreadPrefix, sanitizeRoomTitle } from "./room-titles";
import { attachmentsForProject } from "./project-attachments";
import { linkChannelReferences } from "./channel-references";
import { Delegations, type Delegation } from "./delegations";
import { ChannelData } from "./channel-data";
import { defaultLimits } from "./workspace-contract";
import { createHash, randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type {
  Attachment,
  Bot,
  Conversation,
  Job,
  Room,
  RoomMessage,
  RoomRun,
} from "./contract";
import { isAutomationTrigger, messageSchema } from "./contract";
import type { PermissionMode } from "./contract";
import { Store } from "./store";
import { activitySnippetFromTimeline } from "./activity";
import { isExecuting } from "./job-state";
import {
  directMessageId,
  directMessagesInTurn,
  managedPromptInTurn,
  type DirectMessageRequest,
} from "./direct-messages";
import { mentioned, mentionsEveryone, isBroadcastHandle } from "./mentions";
import { continuationBotId } from "./jev";
export { mentioned } from "./mentions";
import {
  parseSendMode,
  isForkConversation,
  type SendMode,
  type DispatchAction,
  type RoutingDecision,
  type RoutingPlan,
  type RoutingSelection,
  type RoutingTask,
} from "./send-mode";
import type { Runtime } from "./runtime";
import { advanceTurnClock } from "./turn-clock";
import { jobHasProgress, retryStalled, stalledAfterRetry } from "./runtime-stall";
import { errorText, jobPrompt, jobInput, missingThread, primaryLane } from "./runtime";
export async function driveRoom(this: Runtime, room: Room) {
    if (room.archived) return;
    const runs = this.store.runs(room.id, -1, true);
    let changed = false;
    this.store.db.transaction(() => {
      for (const run of runs) {
        // Adopt unfinished discussions saved by the original sequential scheduler.
        if (run.mode !== "concurrent") {
          const trigger = this.store.message(run.id);
          run.pendingJobIds = run.jobId ? [run.jobId] : [];
          run.settledJobIds = [];
          run.mode = "concurrent";
          if (trigger)
            for (const id of [...new Set([...run.remaining, ...run.next])])
              this.invite(room, run, trigger, id, 0);
          run.remaining = [];
          run.next = [];
          run.jobId = null;
          changed = true;
        }
      }
      // Collect across discussions: the room follows completion order, not send order.
      const completed = runs
        .flatMap((run) =>
          run.pendingJobIds.flatMap((id) => {
            const job = this.store.job(id);
            return job && ["done", "error", "cancelled"].includes(job.status)
              ? [{ run, job }]
              : [];
          }),
        )
        .sort((a, b) => a.job.updatedAt - b.job.updatedAt);
      for (const { run, job } of completed) {
        changed = true;
        run.pendingJobIds = run.pendingJobIds.filter((id) => id !== job.id);
        if (run.settledJobIds.includes(job.id)) continue;
        run.settledJobIds.push(job.id);
        if (job.error) run.error = job.error;
        if (
          job.status !== "done" ||
          !room.memberIds.includes(job.botId) ||
          ((!job.reply || job.reply.trim() === "[PASS]") &&
            !job.outputAttachments.length)
        )
          continue;
        const bot = this.store.get(job.botId);
        const ancestors = this.delegations.ancestors(job);
        const delegates = job.depth < 2 && !job.returnOf
          ? room.memberIds.filter((id) => id !== bot.id && !ancestors.has(id) &&
              (mentionsEveryone(job.reply ?? "") || mentioned(job.reply ?? "", this.store.get(id).handle)))
          : [];
        const coordinated = !!job.coordinatorId;
        const isCoordinator = coordinated && job.coordinatorId === job.botId;
        const internalResult = coordinated && (
          !isCoordinator ||
          this.delegations.get(`job:${this.delegations.rootJob(job).id}`)?.status === "waiting" ||
          delegates.length > 0 ||
          !!run.finalMessageId
        );
        const directMessageIds = (job.directMessageRequestIds ?? []).map((id) =>
          directMessageId(job.threadId!, id),
        );
        for (const id of directMessageIds)
          this.store.putMessage({
            id,
            roomId: room.id,
            runId: run.id,
            botId: null,
            speaker: "You",
            system: "bot_dm",
            sourceThreadId: job.threadId!,
            text: `You sent a DM to ${bot.name}.`,
            createdAt: job.updatedAt,
            attachments: [],
            replyTo: null,
          });
        const reply: RoomMessage = {
          id: job.id,
          roomId: room.id,
          runId: run.id,
          botId: bot.id,
          conversationKey: job.conversationKey,
          speaker: bot.name,
          ...(job.automationId ? { automationId: job.automationId } : {}),
          text: job.reply?.trim() === "[PASS]" ? "" : (job.reply ?? ""),
          createdAt: job.updatedAt,
          replyTo: directMessageIds.at(-1) ?? job.triggerMessageId,
          attachments: job.outputAttachments,
          ...(internalResult ? { internalResult: true } : {}),
        };
        if (this.store.putMessage(reply)) {
          if (!internalResult) {
            const currentRoom = this.store.room(room.id);
            this.store.putRoom({
              ...currentRoom,
              updatedAt: Math.max(currentRoom.updatedAt + 1, Date.now()),
            });
            if (isAutoTitlePlaceholder(currentRoom.name))
              this.startRoomTitle(currentRoom, reply);
          }
        }
        if (job.depth < 2 && !job.returnOf) {
          for (const id of delegates)
            this.invite(room, run, reply, id, job.depth + 1);
          this.trackDelegation(reply, run, undefined, job);
        }
        if (isCoordinator && !internalResult && !run.finalMessageId)
          run.finalMessageId = job.id;
      }
      for (const run of runs) {
        run.status =
          run.pendingJobIds.length ||
          run.routing === "pending" ||
          this.delegations.hasPending(run.id)
            ? "running"
            : "done";
        this.store.putRun(run);
      }
    })();
    if (changed) this.changed();
    for (const run of runs)
      if (run.routing === "pending") this.startRouting(room, run);
    this.startReturns(room);
  }

export async function driveJob(this: Runtime, bot: Bot, job: Job, forkJob: boolean) {
    if (job.pendingSteer && job.threadId && !job.cancellationPending) {
      await this.startSteer({ jobId: job.id });
      const steering = this.store.job(job.id);
      if (steering?.pendingSteer) {
        const clock = advanceTurnClock(steering, Date.now());
        this.store.setTurnClock(job.id, clock);
        if (clock.turnMs > (bot.limits ?? defaultLimits).minutesPerTurn * 60000)
          await this.cancel(
            this.store.job(job.id)!,
            "Correction delivery timed out. Inspect the conversation before retrying.",
            false,
            true,
          );
        return;
      }
      // Re-read the cleared marker before normal reconciliation on the next tick.
      return;
    }
    if (job.cancellationPending && job.threadId) {
      await this.cancel(job, job.error ?? "Cancelled by the owner.");
      return;
    }
    if (
      (job.status === "dispatching" || job.status === "running") &&
      job.threadId
    ) {
      let thread;
      try {
        thread = await this.bb.sdk.threads.get({ threadId: job.threadId });
      } catch (cause) {
        if (!missingThread(cause)) throw cause;
        const current = this.store.job(job.id);
        if (current && isExecuting(current)) {
          current.status = "error";
          current.error =
            "The work conversation was deleted. Retry this response to start again.";
          this.store.putJob(current);
        }
        this.store.deleteConversation(job.threadId);
        this.changed();
        return;
      }
      const queued = await this.bb.sdk.threads.queuedMessages.list({
        threadId: job.threadId,
      });
      const current = this.store.job(job.id)!;
      if (!["dispatching", "running"].includes(current.status)) return;
      current.dispatchStartedAt ??= current.updatedAt;
      const clock = advanceTurnClock(current, Date.now());
      Object.assign(current, clock);
      this.store.setTurnClock(current.id, clock);
      const matching = queued.some((entry) =>
        entry.content.some(
          (block) => block.type === "text" && block.text === jobPrompt(current),
        ),
      );
      const limitMs = (bot.limits ?? defaultLimits).minutesPerTurn * 60000;
      const turnMs = current.turnMs ?? 0;
      if (
        thread.status !== "error" &&
        (thread.status === "active" || matching) &&
        !current.wrapUpRequestedAt &&
        turnMs >= limitMs * 0.75 &&
        turnMs < limitMs
      ) {
        if (await jobHasProgress(this, current)) {
          current.pendingSteer = { priorPrompt: jobPrompt(current) };
          current.wrapUpRequestedAt = Date.now();
          current.requiresPromptMatch = true;
          this.store.putJob(current);
          this.changed();
          await this.startSteer({ jobId: current.id });
          return;
        }
        // Nothing to wrap up: send it again once, else let it reach the limit.
        if (!current.stallRetriedAt) {
          await retryStalled(this, current);
          return;
        }
      }
      if (thread.status === "error") {
        const matches = await this.latestPromptMatches(
          job.threadId,
          jobPrompt(current),
        );
        if (
          matches === true ||
          (!current.requiresPromptMatch && matches !== false)
        )
          this.complete(
            job.threadId,
            null,
            "The agent turn failed. Inspect the conversation.",
            await this.providerFailed(job.threadId, current),
          );
      } else if (thread.status === "active" || matching) {
        current.status = "running";
        if (thread.status === "active" && !current.startedAt)
          current.startedAt = Date.now();
        this.store.putJob(current);
      } else if (thread.status === "idle") {
        const matches = await this.latestPromptMatches(
          job.threadId,
          jobPrompt(current),
        );
        const output = (
          await this.bb.sdk.threads.output({ threadId: job.threadId })
        ).output;
        let joinedDirectMessages: DirectMessageRequest[] = [];
        let directMessageInspectionFailed = false;
        if (current.roomId && output?.trim()) {
          try {
            const events = await this.bb.sdk.threads.events.list({
              threadId: job.threadId,
              types: [
                "client/turn/requested",
                "turn/started",
                "turn/completed",
                "turn/input/accepted",
              ],
              order: "desc",
              limit: "100",
            });
            const managedPrompts = [
              jobPrompt(current),
              ...(current.pendingSteer?.priorPrompt
                ? [current.pendingSteer.priorPrompt]
                : []),
            ];
            if (managedPromptInTurn(events, "completed", managedPrompts))
              joinedDirectMessages = directMessagesInTurn(
                events,
                "completed",
                managedPrompts,
              );
          } catch (cause) {
            directMessageInspectionFailed = true;
            this.bb.log.debug(
              `Could not inspect completed direct messages: ${errorText(cause)}`,
            );
          }
        }
        if (
          ((matches !== false &&
            (!current.requiresPromptMatch || matches === true)) ||
            joinedDirectMessages.length > 0) &&
          output?.trim()
        ) {
          this.complete(job.threadId, output);
          const completed = this.store.job(current.id);
          if (completed?.status === "done" && joinedDirectMessages.length)
            this.store.putJob({
              ...completed,
              directMessageRequestIds: joinedDirectMessages.map(
                (request) => request.requestId,
              ),
            });
        } else if (
          !directMessageInspectionFailed &&
          (matches === false || !current.requiresPromptMatch || matches === true)
        )
          this.complete(
            job.threadId,
            null,
            "Dispatch outcome is unknown. Inspect the conversation before sending again.",
          );
      } else if (current.status === "dispatching")
        this.complete(
          job.threadId,
          null,
          "Dispatch outcome is unknown. Inspect the conversation before sending again.",
        );
      const latest = this.store.job(job.id)!;
      if (
        ["dispatching", "running"].includes(latest.status) &&
        (latest.turnMs ?? 0) > (bot.limits ?? defaultLimits).minutesPerTurn * 60000
      )
        await this.cancel(
          latest,
          stalledAfterRetry(this, latest)
            ? `The bot made no progress in ${(bot.limits ?? defaultLimits).minutesPerTurn} minutes, even after a retry. Its provider may be failing or its computer offline; open the work thread to check.`
            : `Turn timed out after ${(bot.limits ?? defaultLimits).minutesPerTurn} minutes. Inspect the conversation before retrying.`,
          false,
          true,
        );
      return;
    }
    if (job.status === "dispatching" || job.cancellationPending) {
      for (let offset = 0; ; offset += 100) {
        const threads = await this.bb.sdk.threads.list({
          projectId: bot.projectId,
          originPluginId: "bot-teams",
          includeHidden: true,
          limit: 100,
          offset,
        });
        for (const thread of threads) {
          const metadata = await this.bb.sdk.threads.getPluginMetadata({
            threadId: thread.id,
          });
          const keys = new Set([
            job.conversationKey,
            `${job.conversationKey}:${job.id}`,
          ]);
          if (
            metadata.botId !== bot.id ||
            typeof metadata.conversationKey !== "string" ||
            !keys.has(metadata.conversationKey)
          )
            continue;
          if (!this.store.byThread(thread.id))
            this.store.putConversation({
              id: randomUUID(),
              botId: bot.id,
              key: metadata.conversationKey!,
              threadId: thread.id,
              title: job.roomId ? this.store.room(job.roomId).name : "Mission",
              kind: job.roomId ? "group" : "mission",
              createdAt: job.createdAt,
            });
          const current = this.store.job(job.id)!;
          current.threadId = thread.id;
          this.store.putJob(current);
          if (current.status === "cancelled")
            await this.cancel(
              current,
              current.error ?? "Cancelled by the owner.",
            );
          this.changed();
          return;
        }
        if (threads.length < 100) break;
      }
      const current = this.store.job(job.id)!;
      if (current.cancellationPending)
        throw new Error(
          "Still locating a cancelled response. Host cleanup will retry automatically.",
        );
      if (current.status === "dispatching") {
        current.status = "error";
        current.error = [
          "Dispatch outcome is unknown. Inspect the conversation before sending again.",
          current.error,
        ]
          .filter(Boolean)
          .join(" ");
        this.store.putJob(current);
        this.changed();
      }
      return;
    }
    const lane = primaryLane(bot.id, job.conversationKey);
    if (!forkJob && this.busy.has(lane)) return;
    if (
      job.forkSourceThreadId &&
      !this.store
        .conversations(bot.id)
        .some((c) => c.key === job.conversationKey)
    ) {
      const provider = (
        await this.bb.sdk.providers.list({ hostId: bot.hostId })
      ).find((p) => p.id === bot.providerId);
      if (!provider?.capabilities.supportsFork) {
        job.status = "error";
        job.error = `Provider ${bot.providerId} does not support session forks. Choose Follow-up or use a fork-capable provider.`;
        this.store.putJob(job);
        this.changed();
        return;
      }
    }
    for (const scope of [
      { botId: bot.id, limits: bot.limits ?? defaultLimits },
      ...(job.roomId
        ? [
            {
              roomId: job.roomId,
              limits: this.store.room(job.roomId).limits ?? defaultLimits,
            },
          ]
        : []),
    ]) {
      const filter =
        "botId" in scope ? "bot_id=?" : "json_extract(json,'$.roomId')=?";
      const scopeId = "botId" in scope ? scope.botId : scope.roomId;
      for (const [window, maximum, label] of [
        [3600000, scope.limits.turnsPerHour, "hour"],
        [86400000, scope.limits.turnsPerDay, "day"],
      ] as const) {
        const count = this.store.db
          .prepare(
            `SELECT COUNT(*) AS n FROM jobs WHERE ${filter} AND COALESCE(json_extract(json,'$.startedAt'),json_extract(json,'$.dispatchStartedAt'))>?`,
          )
          .get(scopeId, Date.now() - window) as { n: number };
        if (count.n >= maximum)
          throw new Error(
            `${"botId" in scope ? "Bot" : "Channel"} limit reached (${maximum} turns per ${label}). Queued work resumes when capacity is available.`,
          );
      }
    }
    if (job.roomId) this.prepareGroup(job, bot);
    job.requiresPromptMatch =
      !!job.forkSourceThreadId ||
      this.store
        .conversations(bot.id)
        .some((c) => c.key === job.conversationKey);
    job.status = "dispatching";
    job.dispatchStartedAt = Date.now();
    this.store.putJob(job);
    try {
      let projectId = bot.projectId;
      let c = this.store
        .conversations(bot.id)
        .find((candidate) => candidate.key === job.conversationKey);
      if (c) {
        try {
          const thread = await this.bb.sdk.threads.get({
            threadId: c.threadId,
          });
          projectId = thread.projectId;
        } catch (cause) {
          if (!missingThread(cause)) throw cause;
          this.store.deleteConversation(c.threadId);
          c = undefined;
          if (job.roomId) this.prepareGroup(job, bot);
        }
      }
      if (!c && job.forkSourceThreadId && job.attachments.length)
        projectId = (
          await this.bb.sdk.threads.get({ threadId: job.forkSourceThreadId })
        ).projectId;
      await this.prepareProjectAttachments(job, projectId);
      this.store.putJob(job);
      // A long-lived bot thread keeps its spawn mode, so every turn carries the
      // channel's current setting. It takes effect on this turn, not the one
      // already running.
      const executionBot = job.fallbackAttempted || c?.providerId === bot.fallbackProviderId &&
        !!bot.fallbackProviderId
        ? {
            ...bot,
            providerId: bot.fallbackProviderId,
            model: bot.fallbackModel,
            reasoningLevel: bot.fallbackReasoningLevel,
          }
        : bot;
      const permissionMode = await this.permissionMode(executionBot, job.roomId);
      if (!c)
        c = job.forkSourceThreadId
          ? await this.forkConversation(bot, job, permissionMode)
          : await this.conversation(
              executionBot,
              job.conversationKey,
              job.roomId ? "group" : "mission",
              job.roomId ? this.store.room(job.roomId).name : "Mission",
              jobPrompt(job),
              job.attachments,
              permissionMode,
            );
      else {
        // The dispatch hook runs during send and must already see this job.
        const pending = this.store.job(job.id)!;
        if (pending.status === "cancelled") return;
        pending.threadId = c.threadId;
        this.store.putJob(pending);
        await this.bb.sdk.threads.send({
          threadId: c.threadId,
          mode: "queue-if-active",
          input: jobInput(job),
          permissionMode,
          executionInputSources: { permissionMode: "explicit" },
        });
      }
      const current = this.store.job(job.id)!;
      current.threadId = c.threadId;
      if (current.status === "dispatching") current.status = "running";
      this.store.putJob(current);
      if (current.status === "cancelled")
        await this.cancel(current, current.error ?? "Cancelled by the owner.");
      else if (current.pendingSteer)
        await this.startSteer({ jobId: current.id });
    } catch (cause) {
      const current = this.store.job(job.id)!;
      if (current.status === "dispatching") {
        current.error = `Checking dispatch after: ${errorText(cause)}`;
        this.store.putJob(current);
      }
      if (!forkJob) this.busy.delete(lane);
    }
    this.changed();
  }

export async function tick(this: Runtime) {
    for (const job of this.store.timedOutJobsWithoutNotice()) {
      const current = await this.refreshJobActivity(job);
      if (current.status === "cancelled" && current.timedOut) {
        try {
          this.postTimeoutNotice(current);
        } catch (cause) {
          this.bb.log.warn(
            `Posting timeout status failed: ${errorText(cause)}`,
          );
        }
      }
    }
    for (const room of this.store.rooms())
      await this.locked(`room:${room.id}`, async () => {
        const current = this.store.findRoom(room.id);
        if (current) await this.driveRoom(current);
      });
    for (const initial of this.store.all()) {
      if (this.abort.signal.aborted) return;
      await this.locked(initial.id, async () => {
        const bot = this.store.get(initial.id);
        try {
          await this.reconcileBusy(bot);
          if (
            !bot.retired &&
            bot.intervalMinutes &&
            Date.now() - bot.lastWakeAt >= bot.intervalMinutes * 60000
          )
            this.wake(bot);
          try {
            await this.drive(bot);
          } finally {
            await this.driveForks(bot);
          }
          if (bot.error) {
            this.store.put({ ...this.store.get(bot.id), error: null });
            this.changed();
          }
        } catch (cause) {
          const error = errorText(cause);
          if (bot.error !== error) {
            this.store.put({ ...this.store.get(bot.id), error });
            this.changed();
          }
        }
      });
    }
  }
