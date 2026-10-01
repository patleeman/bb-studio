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
import { errorText, jobPrompt, jobInput, missingThread, primaryLane } from "./runtime";
export function sourceJobForMessage(this: Runtime, message: RoomMessage) {
    if (message.sourceJobId) return this.store.job(message.sourceJobId);
    if (message.botId && message.sourceThreadId)
      return (
        this.store
          .work(message.botId)
          .find(
            (job) =>
              job.threadId === message.sourceThreadId && isExecuting(job),
          ) ?? null
      );
    return this.store.job(message.id);
  }

export function messageAncestors(this: Runtime, message: RoomMessage) {
    const source = this.sourceJobForMessage(message);
    return source ? this.delegations.ancestors(source) : new Set<string>();
  }

export function trackDelegation(this: Runtime, 
    message: RoomMessage,
    run: RoomRun,
    sourceThreadId = message.sourceThreadId,
    sourceJob: Job | null = null,
  ) {
    if (!message.botId) return;
    sourceJob ??= message.sourceJobId
      ? this.store.job(message.sourceJobId)
      : null;
    sourceJob ??= sourceThreadId
      ? (this.store
          .work(message.botId)
          .find((job) => job.threadId === sourceThreadId && isExecuting(job)) ??
        null)
      : this.store.job(message.id);
    const ancestors = sourceJob
      ? this.delegations.ancestors(sourceJob)
      : new Set<string>();
    const replyBot = message.replyTo
      ? this.store.message(message.replyTo)?.botId
      : null;
    const jobs = this.store
      .requestJobs(run.id)
      .filter(
        (job) =>
          job.triggerMessageId === message.id &&
          job.botId !== message.botId &&
          !ancestors.has(job.botId) &&
          (mentioned(
            message.sentText ?? message.text,
            this.store.get(job.botId).handle,
          ) ||
            job.botId === replyBot ||
            mentionsEveryone(message.sentText ?? message.text)),
      );
    this.delegations.track(message, run, jobs, sourceJob);
  }

export function startReturns(this: Runtime, room: Room) {
    for (const group of this.delegations.pending(room.id)) {
      if (
        this.returnTasks.has(group.id) ||
        this.returnTasks.size >= 4 ||
        group.retryAt > Date.now() ||
        this.abort.signal.aborted
      )
        continue;
      const task = this.resolveReturn(group)
        .catch((cause) => {
          const current = this.delegations.get(group.id);
          if (current?.status === "waiting" && !this.abort.signal.aborted) {
            current.retryAt = Date.now() + 30000;
            current.error = errorText(cause);
            this.delegations.put(current);
          }
        })
        .finally(() => this.returnTasks.delete(group.id));
      this.returnTasks.set(group.id, task);
    }
  }

export async function timeoutDelegate(this: Runtime, 
    job: Job,
    deadlineGroupId: string,
    seen = new Set<string>(),
  ) {
    if (
      (this.delegations.get(deadlineGroupId)?.deadlineAt ?? Infinity) >
      Date.now()
    )
      return;
    if (seen.has(job.id)) return;
    seen.add(job.id);
    const nested = this.delegations.get(
      `job:${this.delegations.rootJob(job).id}`,
    );
    if (nested?.status === "waiting") {
      for (const result of this.delegations
        .results(nested)
        .filter((result) => result.status === "pending")) {
        const child = this.store.job(result.jobId);
        if (child) await this.timeoutDelegate(child, deadlineGroupId, seen);
      }
      if (
        (this.delegations.get(deadlineGroupId)?.deadlineAt ?? Infinity) >
        Date.now()
      )
        return;
      this.delegations.put({ ...nested, status: "ignored" });
    }
    const reason = "Direct delegation timed out before all delegates settled.";
    await this.locked(job.botId, async () => {
      const current = this.store.job(job.id);
      if (
        !current ||
        current.triggerMessageId !== job.triggerMessageId ||
        (this.delegations.get(deadlineGroupId)?.deadlineAt ?? Infinity) >
          Date.now()
      )
        return;
      if (current.status === "done" && nested?.status === "waiting")
        this.store.putJob({
          ...current,
          status: "cancelled",
          timedOut: true,
          error: reason,
        });
      else if (
        !["done", "error", "cancelled"].includes(current.status) ||
        current.cancellationPending
      )
        await this.cancel(current, reason, false, true);
    });
  }

export async function resolveReturn(this: Runtime, group: Delegation) {
    const source = group.sourceJobId
      ? this.delegations.attempt(group.sourceJobId)
      : null;
    if (source && ["queued", "dispatching", "running"].includes(source.status))
      return;
    let results = this.delegations.results(group);
    if (results.some((result) => result.status === "pending")) {
      if (Date.now() < group.deadlineAt) return;
      for (const result of results.filter(
        (result) => result.status === "pending",
      )) {
        const job = this.store.job(result.jobId);
        if (job) await this.timeoutDelegate(job, group.id);
      }
      results = this.delegations.results(group);
      if (results.some((result) => result.status === "pending")) return;
    }
    if (!this.returnDecision)
      throw new Error("Delegation classifier is unavailable.");
    const snapshot = JSON.stringify(results);
    const shouldReturn =
      source?.status !== "cancelled" &&
      (group.planned || await this.returnDecision(group, this.abort.signal));
    if (this.abort.signal.aborted) return;
    await this.locked(`room:${group.roomId}`, async () => {
      const live = this.delegations.get(group.id);
      if (
        !live ||
        live.status !== "waiting" ||
        JSON.stringify(this.delegations.results(live)) !== snapshot
      )
        return;
      const latestSource = live.sourceJobId
        ? this.delegations.attempt(live.sourceJobId)
        : null;
      if (
        latestSource?.id !== source?.id ||
        latestSource?.status !== source?.status ||
        latestSource?.triggerMessageId !== source?.triggerMessageId
      )
        return;
      const room = this.store.findRoom(live.roomId);
      const run = room
        ? this.store
            .runs(room.id)
            .find((candidate) => candidate.id === live.runId)
        : null;
      const bot = this.store.get(live.requesterBotId);
      this.store.db.transaction(() => {
        live.status = "ignored";
        if (
          shouldReturn &&
          latestSource?.status !== "cancelled" &&
          room &&
          !room.archived &&
          room.memberIds.includes(bot.id) &&
          !bot.retired &&
          run &&
          run.status !== "stopped" &&
          run.pendingJobIds.length + run.settledJobIds.length < 32
        ) {
          const id = `return:${live.id}:${bot.id}`;
          if (
            this.enqueue(bot, {
              id,
              conversationKey: live.conversationKey,
              roomId: room.id,
              runId: run.id,
              triggerMessageId: this.delegations.returnTrigger(live),
              delegationId: source?.delegationId,
              returnOf: live.id,
              ...(source?.rootTaskId ? { rootTaskId: source.rootTaskId } : {}),
              ...(source ? { parentTaskId: source.id } : {}),
              ...(source?.coordinatorId ? { coordinatorId: source.coordinatorId } : {}),
              depth: 2,
              text: this.delegations.prompt(live),
              taskTitle: "Synthesize delegate results",
            })
          )
            run.pendingJobIds.push(id);
          live.status = "returned";
          live.returnJobId = id;
          run.status = "running";
          this.store.putRun(run);
        }
        this.delegations.put(live);
      })();
      this.changed();
    });
  }

