import { isAutoTitlePlaceholder } from "./room-titles";
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
import type { Runtime, MessageAuthor, SteerRequest } from "./runtime";
import { errorText, missingThread, recipients, jobPrompt, jobInput, primaryLane } from "./runtime";
export function enqueue(this: Runtime, 
    bot: Bot,
    args: Partial<Job> & Pick<Job, "id" | "text" | "conversationKey">,
  ) {
    const now = Date.now();
    return this.store.enqueue({
      botId: bot.id,
      threadId: null,
      status: "queued",
      reply: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      dispatchStartedAt: null,
      roomId: null,
      runId: null,
      triggerMessageId: null,
      depth: 0,
      attachments: [],
      outputAttachments: [],
      ...args,
    });
  }

export function wake(this: Runtime, bot: Bot) {
    if (bot.retired) throw new Error("Restore this bot before waking it.");
    if (this.store.work(bot.id).some((j) => j.conversationKey === "mission"))
      return false;
    const queued = this.enqueue(bot, {
      id: randomUUID(),
      conversationKey: "mission",
      text: "Review MISSION.md and MEMORY.md. Take one useful, bounded step toward your mission. Record progress and unfinished work in MEMORY.md. If blocked or there is nothing useful to do, say so and stop.",
    });
    this.store.put({ ...bot, lastWakeAt: Date.now() });
    this.changed();
    return queued;
  }
  /** Persist a channel notice without creating a bot job or triggering members. */

export function postSystemMessage(this: Runtime, 
    room: Room,
    text: string,
    system: "bot_joined",
  ): RoomMessage {
    const now = Date.now();
    const id = `system:${randomUUID()}`;
    const message: RoomMessage = {
      id,
      roomId: room.id,
      runId: id,
      botId: null,
      speaker: "BB",
      system,
      text,
      createdAt: now,
      attachments: [],
      replyTo: null,
    };
    const current = this.store.room(room.id);
    this.store.db.transaction(() => {
      this.store.putMessage(message);
      this.store.putRoom({
        ...current,
        updatedAt: Math.max(current.updatedAt + 1, now),
      });
    })();
    return message;
  }

export function postTimeoutNotice(this: Runtime, job: Job) {
    const currentJob = this.store.job(job.id);
    if (
      !currentJob ||
      currentJob.status !== "cancelled" ||
      !currentJob.timedOut ||
      !currentJob.timeoutNoticePending
    )
      return;
    job = currentJob;
    if (!job.roomId) return;
    const room = this.store.findRoom(job.roomId);
    if (!room) return;
    const id = `system:timeout:${job.id}`;
    if (this.store.message(id)) {
      this.store.clearTimeoutNoticePending(job.id);
      return;
    }
    const bot = this.store.get(job.botId);
    const progress =
      job.activitySnippet?.trim() || "No activity update was recorded.";
    const message = messageSchema.parse({
      id,
      roomId: room.id,
      runId: job.runId ?? id,
      botId: null,
      speaker: "BB",
      system: "bot_timeout",
      sourceThreadId: job.threadId ?? undefined,
      sourceJobId: job.id,
      conversationKey: job.conversationKey,
      text: [
        `${bot.name}'s response stopped before its final report.`,
        "The bot work thread and workspace are preserved, and this task is incomplete.",
        `Last recorded progress: ${progress}`,
      ].join(" "),
      createdAt: Date.now(),
    });
    this.store.db.transaction(() => {
      this.store.putMessage(message);
      this.store.queueNotification(
        `timeout:${job.id}`,
        room.id,
        "timeout",
        job.id,
      );
      this.store.clearTimeoutNoticePending(job.id);
      const current = this.store.room(room.id);
      this.store.putRoom({
        ...current,
        updatedAt: Math.max(current.updatedAt + 1, message.createdAt),
      });
    })();
    this.changed("channel", room.id);
  }

export function send(this: Runtime, 
    room: Room,
    text: string,
    requestId: string,
    attachments: Attachment[] = [],
    replyTo: string | null = null,
    author?: MessageAuthor,
    scheduled?: { automationId: string; botId: string; name: string },
    requestedMode: SendMode = "auto",
    directMessages: DirectMessageRequest[] = [],
  ): RoomMessage {
    const parsed = parseSendMode(text, requestedMode);
    text = parsed.text;
    const sendMode = scheduled ? "followup" : parsed.mode;
    const directReplyTo =
      author?.botId && directMessages.length
        ? directMessageId(
            author.sourceThreadId,
            directMessages.at(-1)!.requestId,
          )
        : null;
    const existing = this.store.message(requestId);
    if (existing) {
      if (
        existing.roomId !== room.id ||
        existing.botId !== (author?.botId ?? null) ||
        existing.sourceThreadId !== author?.sourceThreadId ||
        existing.automationId !==
          (scheduled?.automationId ?? author?.automationId) ||
        (existing.sentText ?? existing.text) !== text ||
        (existing.sendMode ?? "auto") !== sendMode ||
        existing.replyTo !== (replyTo ?? directReplyTo) ||
        JSON.stringify(existing.attachments.map((a) => a.id)) !==
          JSON.stringify(attachments.map((a) => a.id))
      )
        throw new Error(
          "Message request ID was already used for different content.",
        );
      return existing;
    }
    if (!text.trim() && !attachments.length)
      throw new Error("Write a message or attach a file.");
    if (room.archived)
      throw new Error("Restore this channel before sending a message.");
    if (replyTo && this.store.message(replyTo)?.roomId !== room.id)
      throw new Error("Reply message not found in this group.");
    if (
      directReplyTo &&
      (
        this.store.db
          .prepare(
            "SELECT COUNT(*) AS n FROM room_messages WHERE json_extract(json,'$.replyTo')=?",
          )
          .get(directReplyTo) as { n: number }
      ).n
    )
      throw new Error("This DM already has a channel answer.");
    if (
      author?.botId &&
      !directMessages.length &&
      (
        this.store.db
          .prepare(
            "SELECT COUNT(*) AS n FROM room_messages WHERE json_extract(json,'$.sourceThreadId')=? AND json_extract(json,'$.botId') IS NOT NULL",
          )
          .get(author.sourceThreadId) as { n: number }
      ).n >= 3
    )
      throw new Error(
        "This response has already sent three consultation messages. Summarize the results before requesting more work.",
      );
    if (author && author.depth > 2)
      throw new Error(
        "Bot consultation handoff limit reached. Return your findings to the requesting channel.",
      );
    // Explicit sends may invite new bots. This is committed with the message,
    // so editing a draft or retrying a lost response cannot change membership.
    if (
      !scheduled &&
      this.store.all().some(
        (bot) =>
          bot.retired &&
          !isBroadcastHandle(bot.handle) &&
          mentioned(text, bot.handle),
      )
    )
      throw new Error("Restore the archived bot before mentioning it.");
    const invited = this.store
      .all()
      .filter(
        (bot) =>
          !scheduled &&
          !bot.retired &&
          !isBroadcastHandle(bot.handle) &&
          !room.memberIds.includes(bot.id) &&
          mentioned(text, bot.handle),
      );
    room = {
      ...room,
      memberIds: [...new Set([...room.memberIds, ...invited.map((b) => b.id)])],
    };
    if (room.memberIds.length > 16)
      throw new Error("A channel can have up to 16 bots.");
    const now = Date.now();
    const run: RoomRun = {
      id: requestId,
      roomId: room.id,
      status: "running",
      mode: "concurrent",
      pendingJobIds: [],
      settledJobIds: [],
      round: 1,
      remaining: [],
      next: [],
      jobId: null,
      createdAt: now,
      error: null,
    };
    const m: RoomMessage = {
      id: requestId,
      roomId: room.id,
      runId: run.id,
      botId: author?.botId ?? null,
      speaker: scheduled
        ? `Automation: ${scheduled.name}`
        : (author?.speaker ?? "You"),
      ...((scheduled?.automationId ?? author?.automationId)
        ? { automationId: scheduled?.automationId ?? author?.automationId }
        : {}),
      ...(author
        ? {
            sourceThreadId: author.sourceThreadId,
            ...(author.jobId ? { sourceJobId: author.jobId } : {}),
          }
        : {}),
      text: linkChannelReferences(text, this.store.rooms()),
      sentText: text,
      ...(sendMode !== "auto" ? { sendMode } : {}),
      createdAt: now,
      attachments,
      replyTo: replyTo ?? directReplyTo,
    };
    const shouldAutoTitle =
      !isAutomationTrigger(m) &&
      isAutoTitlePlaceholder(room.name) &&
      !this.store.firstMessage(room.id);
    const ancestors = this.messageAncestors(m);
    const members = room.memberIds
      .map((id) => this.store.get(id))
      .filter(
        (b) => !b.retired && b.id !== author?.botId && !ancestors.has(b.id),
      );
    const replyBot = replyTo ? this.store.message(replyTo)?.botId : null;
    const explicit = members
      .filter((b) => mentioned(text, b.handle) || b.id === replyBot)
      .map((b) => b.id);
    const all = mentionsEveryone(text);
    const returnOnly =
      !all &&
      !explicit.length &&
      [...ancestors].some(
        (id) => id === replyBot || mentioned(text, this.store.get(id).handle),
      );
    const mode = room.responseBehavior ?? "everyone";
    let selected = scheduled
      ? [scheduled.botId]
      : all
        ? members.map((b) => b.id)
        : explicit.length
          ? explicit
          : members.length === 1
            ? [members[0]!.id]
            : mode === "everyone"
              ? members.map((b) => b.id)
              : [];
    if (returnOnly) selected = [];
    if (mode === "smart" && all && !author?.botId && selected.length) {
      const coordinatorId = explicit[0] ?? selected[0]!;
      run.routingPlan = {
        coordinatorId,
        collaboratorIds: selected.filter((id) => id !== coordinatorId),
        executionMode: "parallel",
        finalizerId: coordinatorId,
      };
      m.classifierPlan = run.routingPlan;
    }
    if (
      !scheduled &&
      !returnOnly &&
      members.length &&
      ((mode === "smart" &&
        !author?.botId &&
        (sendMode === "auto" || explicit.length !== 1) &&
        members.length > 1 &&
        !all) ||
        (!author?.botId && sendMode === "auto" && (mode !== "smart" || !all) &&
          this.routingTasks(m, members).some(
            (task) => selected.includes(task.botId) && task.busy,
          )))
    ) {
      run.routing = "pending";
      run.routingDepth = author?.depth ?? 0;
      run.routingBotIds = selected;
      selected = [];
    }
    if (mode === "smart" && !author?.botId && !run.routing && !run.routingPlan && selected.length === 1) {
      run.routingPlan = {
        coordinatorId: selected[0]!, collaboratorIds: [], executionMode: "serialized", finalizerId: selected[0]!,
      };
      m.classifierPlan = run.routingPlan;
    }
    const steerRequests: SteerRequest[] = [];
    const appliedActions: NonNullable<RoomMessage["classifierActions"]> = [];
    this.store.db.transaction(() => {
      if (author?.botId)
        for (const direct of directMessages)
          this.store.putMessage({
            id: directMessageId(author.sourceThreadId, direct.requestId),
            roomId: room.id,
            runId: run.id,
            botId: null,
            speaker: "You",
            system: "bot_dm",
            sourceThreadId: author.sourceThreadId,
            text: `You sent a DM to ${author.speaker}.`,
            createdAt: now,
            attachments: [],
            replyTo: null,
          });
      this.store.putMessage(m);
      this.store.claimAttachments(attachments.map((a) => a.id));
      for (const botId of selected) {
        if (botId === author?.botId) continue;
        const action = sendMode === "auto" ? "followup" : sendMode;
        const dispatch = this.dispatchMessage(
          room,
          run,
          m,
          botId,
          author?.depth ?? 0,
          action,
        );
        if (dispatch.steer) steerRequests.push(dispatch.steer);
        if (dispatch.action !== action)
          appliedActions.push({ botId, action: dispatch.action, suggestedAction: action });
      }
      if (appliedActions.length) this.store.setClassifierActions(m.id, appliedActions);
      if (run.routingPlan?.coordinatorId) {
        const jobs = this.store.requestJobs(run.id).filter((job) => job.triggerMessageId === m.id);
        const coordinator = jobs.find((job) => job.botId === run.routingPlan!.coordinatorId);
        if (coordinator) {
          for (const job of jobs) {
            job.rootTaskId = run.id;
            job.coordinatorId = coordinator.botId;
            if (job.id !== coordinator.id) job.parentTaskId = coordinator.id;
            this.store.putJob(job);
          }
          if (run.routingPlan.executionMode === "parallel")
            this.delegations.trackPlanned(m, run, coordinator, jobs.filter((job) => job.id !== coordinator.id));
        }
      }
      if (!run.pendingJobIds.length && !run.routing) run.status = "done";
      this.trackDelegation(m, run, author?.sourceThreadId);
      this.store.putRun(run);
      if (!isAutomationTrigger(m))
        this.store.putRoom({ ...room, updatedAt: now });
    })();
    for (const bot of invited)
      this.postSystemMessage(
        room,
        `${bot.name} joined the channel.`,
        "bot_joined",
      );
    this.changed("channel", room.id);
    for (const request of steerRequests) this.startSteer(request);
    if (shouldAutoTitle) this.startRoomTitle(this.store.room(room.id), m);
    return m;
  }

