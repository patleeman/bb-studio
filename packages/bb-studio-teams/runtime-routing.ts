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
import type { Runtime, SteerRequest } from "./runtime";
import { errorText, jobPrompt, jobInput, missingThread, primaryLane } from "./runtime";
export function dispatchMessage(this: Runtime, 
    room: Room,
    run: RoomRun,
    message: RoomMessage,
    botId: string,
    depth: number,
    action: DispatchAction,
    snapshot?: RoutingTask,
  ): { action: DispatchAction; steer?: SteerRequest } {
    const key = this.targetKey(message, botId);
    const activeJob = this.store
      .work(botId)
      .find(
        (job) =>
          job.conversationKey === key &&
          ["dispatching", "running"].includes(job.status),
      );
    // A coordinated task with live delegates must retain its root and return path.
    // Queue a correction instead of moving the source job into another run.
    if (action === "steer" && activeJob &&
        this.delegations.get(`job:${this.delegations.rootJob(activeJob).id}`)?.status === "waiting")
      action = "followup";
    // A slow classifier must never steer a different task that started meanwhile.
    if (snapshot && snapshot.jobId !== activeJob?.id && action === "steer")
      action = "followup";
    const previousRun = activeJob?.runId
      ? this.store.runs(room.id).find((r) => r.id === activeJob.runId)
      : undefined;
    if (action === "steer" && activeJob && previousRun) {
      const previous = {
        runId: previousRun.id,
        triggerMessageId: activeJob.triggerMessageId,
        text: activeJob.text,
        attachments: [...activeJob.attachments],
      };
      previousRun.pendingJobIds = previousRun.pendingJobIds.filter(
        (id) => id !== activeJob.id,
      );
      previousRun.status =
        previousRun.pendingJobIds.length || previousRun.routing === "pending"
          ? "running"
          : "done";
      this.store.putRun(previousRun);
      activeJob.pendingSteer = {
        priorPrompt:
          activeJob.pendingSteer?.priorPrompt ?? jobPrompt(activeJob),
      };
      activeJob.requiresPromptMatch = true;
      activeJob.runId = run.id;
      activeJob.triggerMessageId = message.id;
      activeJob.attachments = [...message.attachments];
      activeJob.dispatchAction = "steer";
      activeJob.taskTitle = message.text.slice(0, 240);
      this.prepareGroup(activeJob, this.store.get(botId));
      run.pendingJobIds.push(activeJob.id);
      return {
        action,
        steer: {
          roomId: room.id,
          jobId: activeJob.id,
          botId,
          message,
          previous,
        },
      };
    }
    const source =
      activeJob?.threadId ??
      this.store.conversations(botId).find((c) => c.key === key)?.threadId;
    // Automatic routing only forks existing sessions. Explicit requests fail visibly below.
    if (action === "fork" && !source && message.sendMode !== "fork")
      action = "followup";
    this.invite(room, run, message, botId, depth, {
      conversationKey:
        action === "fork" ? `group:${room.id}:fork:${message.id}` : key,
      dispatchAction: action,
      ...(action === "fork" && source ? { forkSourceThreadId: source } : {}),
      ...(action === "fork" && !source
        ? {
            status: "error" as const,
            error:
              "This bot has no session to fork yet. Send a regular message first.",
          }
        : {}),
    });
    return { action };
  }


export function startSteer(this: Runtime, request: Pick<SteerRequest, "jobId">): Promise<void> {
    if (!this.store.job(request.jobId)?.threadId) return Promise.resolve();
    const running = this.steerTasks.get(request.jobId);
    if (running) return running;
    const task = Promise.resolve()
      .then(async () => {
        const job = this.store.job(request.jobId);
        if (
          !job?.pendingSteer ||
          !job.threadId ||
          !["dispatching", "running"].includes(job.status)
        )
          return;
        let prompt = jobPrompt(job);
        const current = () => {
          const live = this.store.job(job.id);
          return live?.pendingSteer &&
            live.triggerMessageId === job.triggerMessageId &&
            ["running", "dispatching"].includes(live.status)
            ? live
            : null;
        };
        try {
          if (job.attachments.length) {
            const thread = await this.bb.sdk.threads.get({
              threadId: job.threadId,
            });
            await this.prepareProjectAttachments(job, thread.projectId);
            const live = current();
            if (!live) return;
            live.text = job.text;
            live.attachments = job.attachments;
            this.store.putJob(live);
            prompt = jobPrompt(job);
          }
          if (job.pendingSteer.attemptedAt) {
            const matches = await this.latestPromptMatches(
              job.threadId,
              prompt,
            );
            const queued = await this.bb.sdk.threads.queuedMessages.list({
              threadId: job.threadId,
            });
            const delivered =
              matches === true ||
              queued.some((q) =>
                q.content.some((b) => b.type === "text" && b.text === prompt),
              );
            const live = current();
            if (!live) return;
            if (delivered) {
              delete live.pendingSteer;
              live.error = null;
              this.store.putJob(live);
              return;
            }
            // Do not retry an uncertain send while the timeline is unavailable.
            if (
              matches === null ||
              Date.now() - job.pendingSteer.attemptedAt < 3000
            )
              return;
          }
          const live = current();
          if (!live) return;
          live.pendingSteer!.attemptedAt = Date.now();
          this.store.putJob(live);
          await this.bb.sdk.threads.send({
            threadId: job.threadId,
            mode: "steer",
            input: jobInput(job),
          });
          const accepted = current();
          if (accepted) {
            delete accepted.pendingSteer;
            accepted.error = null;
            this.store.putJob(accepted);
          }
        } catch (cause) {
          const live = current();
          if (live) {
            live.error = `Checking correction delivery: ${errorText(cause)}`;
            this.store.putJob(live);
          }
          this.bb.log.warn(
            `Steering a channel response needs recovery: ${errorText(cause)}`,
          );
        }
        this.changed();
      })
      .finally(() => {
        if (this.steerTasks.get(request.jobId) === task)
          this.steerTasks.delete(request.jobId);
      });
    this.steerTasks.set(request.jobId, task);
    return task;
  }

  /** Retry title work for blank channels after a plugin/server restart. */

export function startRouting(this: Runtime, room: Room, run: RoomRun) {
    if (
      this.routing.has(run.id) ||
      this.routing.size >= 4 ||
      this.abort.signal.aborted
    )
      return;
    const controller = new AbortController();
    this.routingAborts.set(run.id, controller);
    const signal = AbortSignal.any([this.abort.signal, controller.signal]);
    const task = (async () => {
      let selected: RoutingSelection = [],
        tasks: RoutingTask[] = [],
        error: string | undefined;
      try {
        const message = this.store.message(run.id);
        if (!message) throw new Error("Original message not found.");
        if (!this.route)
          throw new Error(
            "Smart routing is unavailable. Mention a bot in the channel.",
          );
        const ancestors = this.messageAncestors(message);
        const members = room.memberIds
          .map((id) => this.store.get(id))
          .filter(
            (b) => !b.retired && b.id !== message.botId && !ancestors.has(b.id),
          );
        tasks = this.routingTasks(message, members);
        selected = await this.route(
          message,
          room,
          members,
          signal,
          tasks,
          run.routingBotIds ?? [],
        );
      } catch (cause) {
        error = errorText(cause);
        const message = this.store.message(run.id);
        const single = run.routingBotIds?.length === 1 ? run.routingBotIds[0] : null;
        const continuation = message && !run.routingBotIds?.length
          ? continuationBotId(
              message,
              this.store.visibleMessages(room.id, 9).filter((item) => item.id !== message.id),
              room.memberIds.map((id) => this.store.get(id)).filter((bot) => !bot.retired),
            )
          : null;
        const fallbackId = single ?? continuation;
        if (message && fallbackId && !mentionsEveryone(message.sentText ?? message.text)) {
          selected = {
            coordinatorId: fallbackId,
            collaboratorIds: [],
            executionMode: "serialized",
            finalizerId: fallbackId,
            routes: [{ botId: fallbackId, action: "followup" }],
            source: "fallback",
          };
          error = undefined;
        }
      }
      const literal = (room.responseBehavior ?? "everyone") !== "smart";
      const first = Array.isArray(selected) ? selected[0] : undefined;
      const primaryRoute: RoutingDecision | null = first
        ? typeof first === "string"
          ? { botId: first, action: "followup" }
          : first
        : null;
      const plan: RoutingPlan | null = literal ? null : Array.isArray(selected)
        ? {
            coordinatorId: primaryRoute?.botId ?? null,
            collaboratorIds: [],
            executionMode: "serialized",
            finalizerId: primaryRoute?.botId ?? null,
            routes: primaryRoute ? [primaryRoute] : [],
            source: "providers",
          }
        : selected;
      const routes: RoutingDecision[] = plan?.routes ?? (Array.isArray(selected)
        ? selected.map((route) => typeof route === "string" ? { botId: route, action: "followup" } : route)
        : selected.routes);
      if (signal.aborted) return;
      await this.locked(`room:${room.id}`, async () => {
        const current = this.store.findRoom(room.id);
        const live =
          current && this.store.runs(room.id).find((r) => r.id === run.id);
        const message = this.store.message(run.id);
        if (
          !current ||
          current.archived ||
          !live ||
          live.status === "stopped" ||
          live.routing !== "pending" ||
          !message
        )
          return;
        const steers: SteerRequest[] = [];
        const classifierActions: NonNullable<RoomMessage["classifierActions"]> = [];
        this.store.db.transaction(() => {
          const eligible = new Set(current.memberIds.filter((id) => id !== message.botId && !this.messageAncestors(message).has(id)));
          const expectedIds = plan?.coordinatorId
            ? [plan.coordinatorId, ...(plan.executionMode === "parallel" ? plan.collaboratorIds : [])]
            : [];
          if (!error && plan && (
            plan.finalizerId !== plan.coordinatorId ||
            (!plan.coordinatorId && plan.collaboratorIds.length > 0) ||
            (plan.coordinatorId !== null && !eligible.has(plan.coordinatorId)) ||
            plan.collaboratorIds.some((id) => !eligible.has(id) || id === plan.coordinatorId) ||
            new Set(plan.collaboratorIds).size !== plan.collaboratorIds.length ||
            new Set(plan.routes.map((route) => route.botId)).size !== plan.routes.length ||
            plan.routes.length !== expectedIds.length ||
            expectedIds.some((id) => !plan.routes.some((route) => route.botId === id)) ||
            plan.routes.some((route) => !eligible.has(route.botId) || (route.botId !== plan.coordinatorId && !plan.collaboratorIds.includes(route.botId))) ||
            (run.routingBotIds?.length && plan.routes.some((route) => !run.routingBotIds!.includes(route.botId)))
          )) error = "Routing returned an inconsistent assignment.";
          live.routing = error ? "error" : "done";
          live.routingError = error;
          if (!error) {
            if (plan) {
              live.routingPlan = {
                coordinatorId: plan.coordinatorId,
                collaboratorIds: plan.collaboratorIds,
                executionMode: plan.executionMode,
                finalizerId: plan.finalizerId,
                source: plan.source,
              };
              this.store.setClassifierPlan(message.id, live.routingPlan);
            }
            for (const route of routes) {
              const id = route.botId;
              if (
                id === message.botId ||
                !current.memberIds.includes(id) ||
                this.messageAncestors(message).has(id)
              )
                continue;
              const action =
                message.sendMode && message.sendMode !== "auto"
                  ? message.sendMode
                  : route.action;
              const snapshot = tasks.find((task) => task.botId === id);
              const dispatch = this.dispatchMessage(
                current,
                live,
                message,
                id,
                live.routingDepth ?? 0,
                action,
                snapshot,
              );
              if (dispatch.steer) steers.push(dispatch.steer);
              const routedJob = this.store.requestJobs(live.id).find((job) => job.botId === id && job.triggerMessageId === message.id);
              if (routedJob) {
                if (plan) {
                  routedJob.rootTaskId = live.id;
                  routedJob.coordinatorId = plan.coordinatorId ?? undefined;
                  if (id !== plan.coordinatorId) routedJob.parentTaskId = this.store.requestJobs(live.id).find((job) => job.botId === plan.coordinatorId && job.triggerMessageId === message.id)?.id;
                  this.store.putJob(routedJob);
                }
              }
              if (dispatch.action !== action || ((message.sendMode ?? "auto") === "auto" && snapshot?.busy))
                classifierActions.push({
                  botId: id,
                  action: dispatch.action,
                  ...(dispatch.action !== action
                    ? { suggestedAction: action }
                    : {}),
                });
            }
            if (plan?.coordinatorId) {
              const jobs = this.store.requestJobs(live.id).filter((job) => job.triggerMessageId === message.id);
              const coordinator = jobs.find((job) => job.botId === plan.coordinatorId);
              if (coordinator) for (const helper of jobs.filter((job) => job.botId !== coordinator.botId)) {
                helper.parentTaskId = coordinator.id;
                this.store.putJob(helper);
              }
            }
            if (plan?.executionMode === "parallel" && plan.coordinatorId) {
              const jobs = this.store.requestJobs(live.id).filter((job) => job.triggerMessageId === message.id);
              const coordinator = jobs.find((job) => job.botId === plan.coordinatorId);
              if (coordinator) this.delegations.trackPlanned(message, live, coordinator, jobs.filter((job) => plan.collaboratorIds.includes(job.botId)));
            }
          }
          if (classifierActions.length)
            this.store.setClassifierActions(message.id, classifierActions);
          this.trackDelegation(message, live);
          live.status =
            live.pendingJobIds.length || this.delegations.hasPending(live.id)
              ? "running"
              : "done";
          this.store.putRun(live);
        })();
        this.bb.log.debug(`Channel routing ${run.id}: ${error ? "error" : plan ? `${plan.executionMode}/${plan.source ?? "explicit"}/${plan.routes.length} active` : `literal/${routes.length} active`}`);
        for (const steer of steers) this.startSteer(steer);
        this.changed();
      });
    })()
      .catch((cause) =>
        this.bb.log.warn(`Channel routing failed: ${errorText(cause)}`),
      )
      .finally(() => {
        this.routing.delete(run.id);
        this.routingAborts.delete(run.id);
      });
    this.routing.set(run.id, task);
  }

export function retryRouting(this: Runtime, id: string, requestId: string) {
    const room = this.store.room(id),
      run = this.store.runs(id).find((r) => r.id === requestId);
    if (room.archived || !run || run.routing !== "error")
      throw new Error("This routing request cannot be retried.");
    run.routing = "pending";
    run.routingError = undefined;
    run.status = "running";
    this.store.putRun(run);
    this.changed();
  }
