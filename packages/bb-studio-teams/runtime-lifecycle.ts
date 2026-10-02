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
import { errorText, jobPrompt, jobInput, missingThread, primaryLane, timelineRows } from "./runtime";
export async function settleFromEvent(this: Runtime, 
    threadId: string,
    text: string | null,
    error?: string | null,
    acceptJoinedDirectMessage = false,
  ) {
    const job = this.activeJobForThread(threadId);
    if (!job) {
      this.complete(threadId, text, error ?? undefined);
      return;
    }
    try {
      const thread = await this.bb.sdk.threads.get({ threadId });
      if (error !== undefined ? thread.status !== "error" : thread.status !== "idle") return;
      const matches = await this.latestPromptMatches(threadId, jobPrompt(job));
      if (
        (matches === false || (job.requiresPromptMatch && matches !== true)) &&
        !acceptJoinedDirectMessage
      )
        return;
      if (error === undefined && text?.trim()) {
        const output = (await this.bb.sdk.threads.output({ threadId })).output;
        if (output?.trim() && output.trim() !== text.trim()) return;
      }
    } catch (cause) {
      if (missingThread(cause)) {
        this.complete(threadId, null, "The work conversation was deleted.");
        return;
      }
      this.bb.log.debug(
        `Persistent bot event verification failed: ${errorText(cause)}`,
      );
      return;
    }
    const current = this.activeJobForThread(threadId);
    if (
      current?.id !== job.id ||
      current.triggerMessageId !== job.triggerMessageId
    )
      return;
    this.complete(
      threadId,
      text,
      error === undefined
        ? undefined
        : error?.trim() || (await this.failureFromThread(threadId, job)),
      error !== undefined && await this.providerFailed(threadId, job),
    );
  }

export function complete(this: Runtime, threadId: string, text: string | null, error?: string, providerFailure = false) {
    const c = this.store.byThread(threadId);
    if (!c) return;
    const lane = primaryLane(c.botId, c.key);
    if (this.busy.get(lane)?.threadId === threadId)
      this.busy.delete(lane);
    const job = this.activeJobForThread(threadId);
    if (!job) return;
    const bot = this.store.get(job.botId);
    if (providerFailure && !text?.trim() && !job.outputAttachments.length &&
      bot.fallbackProviderId && !job.fallbackAttempted &&
      (bot.fallbackProviderId !== bot.providerId || bot.fallbackModel !== bot.model ||
        bot.fallbackReasoningLevel !== bot.reasoningLevel) &&
      !job.forkSourceThreadId && c.key === job.conversationKey) {
      // Reuse the same job and prompt, but start a fresh session on the fallback.
      // The failed thread remains in history for inspection.
      this.store.archiveConversation(c);
      job.fallbackAttempted = true;
      job.threadId = null;
      job.status = "queued";
      job.startedAt = null;
      job.dispatchStartedAt = null;
      job.turnMs = undefined;
      job.clockAt = undefined;
      job.requiresPromptMatch = false;
      job.error = null;
      this.store.putJob(job);
      this.changed();
      return;
    }
    if (error || (!text?.trim() && !job.outputAttachments.length)) {
      if (providerFailure && job.fallbackAttempted && c.key === job.conversationKey)
        this.store.archiveConversation(c);
      job.status = "error";
      job.error =
        error ||
        "The turn finished without an answer. Inspect the conversation.";
    } else {
      job.reply = text?.trim() || "[PASS]";
      job.status = "done";
    }
    this.store.putJob(job);
    this.changed();
  }

export async function cancel(this: Runtime, 
    job: Job,
    reason: string,
    requireStopped = false,
    timedOut = false,
  ) {
    const persistedJob = this.store.job(job.id);
    job.timedOut ||= persistedJob?.timedOut ?? false;
    job.timeoutNoticePending ||= persistedJob?.timeoutNoticePending ?? false;
    job.cancellationPending =
      !!job.threadId ||
      job.status === "dispatching" ||
      !!job.cancellationPending;
    job.status = "cancelled";
    job.timedOut ||= timedOut;
    if (timedOut) job.timeoutNoticePending = true;
    job.error = reason;
    this.store.putJob(job);
    const activityRefresh = job.timedOut
      ? this.refreshJobActivity(job)
      : Promise.resolve(job);
    let stopSucceeded = false;
    let stopFailure: unknown;
    if (job.threadId) {
      try {
        const queued = await this.bb.sdk.threads.queuedMessages.list({
          threadId: job.threadId,
        });
        for (const entry of queued)
          await this.bb.sdk.threads.queuedMessages.delete({
            threadId: job.threadId,
            queuedMessageId: entry.id,
          });
        await this.bb.sdk.threads.stop({ threadId: job.threadId });
        stopSucceeded = true;
      } catch (cause) {
        if (missingThread(cause)) stopSucceeded = true;
        else stopFailure = cause;
      }
      if (stopSucceeded) {
        const current = this.store.job(job.id);
        if (current?.cancellationPending) {
          current.cancellationPending = false;
          this.store.putJob(current);
        }
        const lane = primaryLane(job.botId, job.conversationKey);
        if (this.busy.get(lane)?.threadId === job.threadId)
          this.busy.delete(lane);
      }
    }
    await activityRefresh;
    const current = this.store.job(job.id);
    if (current?.status === "cancelled" && current.timedOut) {
      try {
        this.postTimeoutNotice(current);
      } catch (cause) {
        this.bb.log.warn(`Posting timeout status failed: ${errorText(cause)}`);
      }
    }
    if (stopFailure) throw stopFailure;
    if (requireStopped && this.store.job(job.id)?.cancellationPending)
      throw new Error(
        "Still locating a cancelled response. Try again after automatic cleanup finishes.",
      );
    this.changed();
  }

export async function stopRoom(this: Runtime, room: Room) {
    for (const run of this.store.runs(room.id))
      this.routingAborts.get(run.id)?.abort();
    // Publish answers that already finished before archiving/cancelling pending work.
    await this.driveRoom(room);
    room = this.store.room(room.id);
    const next = { ...room, paused: false, updatedAt: Date.now() };
    this.store.putRoom(next);
    // Keep the run and roster retryable until host cleanup succeeds.
    for (const bot of this.store.all())
      await this.locked(bot.id, async () => {
        for (const job of this.store.work(bot.id))
          if (job.roomId === room.id)
            await this.cancel(job, "Channel archived by the owner.", true);
      });
    for (const run of this.store.runs(room.id))
      if (run.status === "queued" || run.status === "running") {
        run.status = "stopped";
        run.remaining = [];
        run.next = [];
        this.store.putRun(run);
      }
    this.changed("channel", room.id);
    return next;
  }

export async function retire(this: Runtime, id: string, retired: boolean): Promise<Bot> {
    return this.locked("rooms", async () => {
      const roomIds = this.store
        .rooms()
        .map((r) => r.id)
        .sort();
      const lockRooms = async (i: number): Promise<Bot> => {
        if (i < roomIds.length)
          return this.locked(`room:${roomIds[i]}`, () => lockRooms(i + 1));
        return this.locked(id, async () => {
          const bot = this.store.get(id);
          if (!!bot.retired === retired) return bot;
          if (retired) {
            for (const job of this.store.work(id))
              await this.cancel(job, "Bot archived by the owner.", true);
            // Threads with this profile are the owner's; their messages stay.
            // Releasing an idle session drops the profile from the next turn.
            for (const c of this.store
              .conversations(id)
              .filter((c) => c.kind === "admin")) {
              try {
                const thread = await this.bb.sdk.threads.get({ threadId: c.threadId });
                if (thread.status === "idle")
                  await this.bb.sdk.threads.stop({ threadId: c.threadId });
              } catch (cause) {
                if (!missingThread(cause)) throw cause;
              }
            }
          }
          const next = {
            ...bot,
            retired,
            // Archiving and restoring both leave the mission schedule off.
            intervalMinutes: 0,
            updatedAt: Math.max(Date.now(), bot.updatedAt + 1),
          };
          this.store.db.transaction(() => {
            this.store.put(next);
            if (retired)
              for (const room of this.store.rooms())
                if (room.memberIds.includes(id))
                  this.store.putRoom({
                    ...room,
                    memberIds: room.memberIds.filter((b) => b !== id),
                    updatedAt: Date.now(),
                  });
          })();
          this.busy.delete(id);
          this.changed();
          return next;
        });
      };
      return lockRooms(0);
    });
  }

export async function retryJob(this: Runtime, id: string): Promise<Job> {
    const original = this.store.job(id);
    if (!original?.roomId)
      throw new Error("Only channel responses can be retried.");
    return this.locked(`room:${original.roomId}`, async () => {
      const job = this.store.job(id);
      if (!job?.roomId)
        throw new Error("This response is no longer available.");
      const room = this.store.room(job.roomId);
      if (room.archived)
        throw new Error("Restore this channel before retrying.");
      const bot = this.store.get(job.botId);
      if (bot.retired || !room.memberIds.includes(bot.id))
        throw new Error("Invite this bot before retrying.");
      if (
        !["error", "cancelled"].includes(job.status) ||
        job.cancellationPending
      )
        throw new Error("Wait for this response to stop before retrying.");
      const retryId = `retry:${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
      const existing = this.store.job(retryId);
      if (existing) return existing;
      const run = this.store.runs(room.id).find((r) => r.id === job.runId);
      if (!run) throw new Error("The original discussion was not found.");
      this.store.db.transaction(() => {
        this.enqueue(bot, {
          id: retryId,
          retryOf: id,
          delegationId: job.delegationId,
          returnOf: job.returnOf,
          rootTaskId: job.rootTaskId,
          parentTaskId: job.parentTaskId,
          coordinatorId: job.coordinatorId,
          dispatchAction: job.dispatchAction,
          forkSourceThreadId: job.forkSourceThreadId,
          ...(job.automationId ? { automationId: job.automationId } : {}),
          text: job.text,
          conversationKey: job.conversationKey,
          roomId: room.id,
          runId: run.id,
          triggerMessageId: job.triggerMessageId,
          depth: job.depth,
          attachments: job.attachments,
        });
        if (job.delegationId) {
          const group = this.delegations.get(job.delegationId);
          if (group?.status === "waiting") {
            group.deadlineAt = Math.max(
              group.deadlineAt,
              Date.now() + (bot.limits ?? defaultLimits).minutesPerTurn * 60000,
            );
            this.delegations.put(group);
          }
        }
        this.store.putRun({
          ...run,
          status: "running",
          pendingJobIds: [...run.pendingJobIds, retryId],
        });
      })();
      this.changed();
      return this.store.job(retryId)!;
    });
  }

export async function deleteRoom(this: Runtime, id: string): Promise<boolean> {
    return this.locked(`room:${id}`, async () => {
      if (!this.store.findRoom(id)) return false;
      for (const run of this.store.runs(id))
        this.routingAborts.get(run.id)?.abort();
      // Wait for in-flight dispatches to finish registering their threads. Use
      // a stable lock order so simultaneous deletions cannot deadlock.
      const botIds = [
        ...new Set(this.store.roomJobs(id, -1).map((j) => j.botId)),
      ].sort();
      const remove = async (index: number): Promise<boolean> => {
        if (index < botIds.length)
          return this.locked(botIds[index]!, () => remove(index + 1));
        const jobs = this.store.roomJobs(id, -1);
        if (jobs.some((j) => j.status === "dispatching" && !j.threadId))
          throw new Error(
            "A bot response is still being located. Check channel activity and try deleting again.",
          );
        for (const job of jobs) {
          // Retry interrupted cancellation too; don't delete the record until
          // BB confirms its queued input and active turn have both stopped.
          if (!["done", "error"].includes(job.status))
            await this.cancel(job, "Channel deleted by the owner.");
          if (this.store.job(job.id)?.cancellationPending)
            throw new Error(
              "Still locating a cancelled response. Try deleting again after cleanup finishes.",
            );
        }
        const deleted = this.store.db.transaction(() => {
          this.store.db
            .prepare("DELETE FROM channel_notifications WHERE room_id=?")
            .run(id);
          this.store.db
            .prepare("DELETE FROM delegations WHERE room_id=?")
            .run(id);
          this.store.db
            .prepare("DELETE FROM channel_context WHERE room_id=?")
            .run(id);
          this.store.db
            .prepare("DELETE FROM document_revisions WHERE scope=?")
            .run(`channel:${id}`);
          this.store.db
            .prepare("DELETE FROM routing_usage WHERE room_id=?")
            .run(id);
          return this.store.deleteRoom(id);
        })();
        this.changed();
        return deleted;
      };
      return remove(0);
    });
  }

export async function refreshJobActivity(this: Runtime, job: Job): Promise<Job> {
    if (!job.threadId) return this.store.job(job.id) ?? job;
    try {
      const timeline = await this.bb.sdk.threads.timeline({
        threadId: job.threadId,
        includeNestedRows: "true",
        segmentLimit: "100",
      });
      const activitySnippet = activitySnippetFromTimeline(
        timeline,
        job.dispatchStartedAt ?? job.startedAt,
      );
      if (!activitySnippet || activitySnippet === job.activitySnippet)
        return this.store.job(job.id) ?? job;
      return (
        this.store.updateActivitySnippet(job.id, activitySnippet) ??
        this.store.job(job.id) ??
        job
      );
    } catch (cause) {
      if (!missingThread(cause))
        this.bb.log.debug(
          `Channel activity refresh failed: ${errorText(cause)}`,
        );
      return this.store.job(job.id) ?? job;
    }
  }

export async function roomJobsWithActivity(this: Runtime, roomId: string): Promise<Job[]> {
    const jobs = this.store.roomJobs(roomId).map((job) => {
      const title =
        job.taskTitle ??
        (job.triggerMessageId
          ? this.store.message(job.triggerMessageId)?.text.slice(0, 240)
          : undefined);
      if (job.status !== "queued") return { ...job, taskTitle: title };
      const pending = this.store
        .work(job.botId)
        .filter(
          (j) =>
            isForkConversation(job.conversationKey)
              ? isForkConversation(j.conversationKey)
              : j.conversationKey === job.conversationKey,
        );
      return {
        ...job,
        taskTitle: title,
        queuePosition: pending.findIndex((j) => j.id === job.id) + 1,
        queueReason:
          this.store.get(job.botId).error ??
          (isForkConversation(job.conversationKey)
            ? "Waiting for a fork slot"
            : "Waiting for this bot's earlier work"),
      };
    });
    return Promise.all(
      jobs.map(async (job) => {
        if (
          job.status === "error" &&
          job.error === "Agent turn failed." &&
          job.threadId
        ) {
          let lookup = this.failureLookups.get(job.id);
          if (!lookup) {
            lookup = this.failureFromThread(
              job.threadId,
              job,
              job.updatedAt + 1000,
            );
            this.failureLookups.set(job.id, lookup);
          }
          const detail = await lookup;
          if (detail !== job.error) {
            const updated = this.store.replaceGenericJobError(job.id, detail);
            if (updated) {
              this.failureLookups.delete(job.id);
              this.changed();
              return { ...updated, taskTitle: job.taskTitle };
            }
          }
        }
        if (!job.threadId || !["dispatching", "running"].includes(job.status))
          return job;
        const current = await this.refreshJobActivity(job);
        return { ...current, taskTitle: job.taskTitle };
      }),
    );
  }
