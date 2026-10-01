import { publishChange } from "./realtime-server";
import { recoverRoomTitles, findTitleWorkers, startRoomTitle, generateRoomTitle, cleanupTitleThread, applyRoomTitle } from "./runtime-title";
import { dispatchMessage, startSteer, startRouting, retryRouting } from "./runtime-routing";
import { driveRoom, driveJob, tick } from "./runtime-drive";
import { fallbackRoomTitle, isAutoTitlePlaceholder, maxRoomTitleLength, requestRoomTitle, roomTitleThreadPrefix, sanitizeRoomTitle, titleWorkerPriority, type TitleWorker, type TitleTask } from "./room-titles";
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
export const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
export const missingThread = (cause: unknown) =>
  /(?:^|\b)(?:thread not found|thread does not exist|HTTP 404)(?:\b|$)/i.test(
    errorText(cause),
  );
/**
 * "You" is the owner's label in the channel UI. In a bot's prompt it would read
 * as the bot itself, so name the owner in the third person there.
 */
export const promptSpeaker = (message: Pick<RoomMessage, "botId" | "speaker">) =>
  !message.botId && message.speaker === "You" ? "the owner" : message.speaker;
/** Primary work is serial within a conversation, but separate channels have separate lanes. */
export const primaryLane = (botId: string, conversationKey: string) =>
  conversationKey.startsWith("group:")
    ? `${botId}:${conversationKey}`
    : botId;
export function recipients(text: string, members: Bot[]) {
  const selected = members
    .filter((b) => mentioned(text, b.handle))
    .map((b) => b.id);
  return mentionsEveryone(text) || !selected.length
    ? members.map((b) => b.id)
    : selected;
}
export const jobPrompt = (job: Job) => {
  const forkNote = isForkConversation(job.conversationKey)
    ? "This is a separate fork. Handle only the new request; do not resume inherited work. The primary session owns shared MEMORY.md; do not edit it from this fork. Include useful durable findings in your channel answer."
    : "";
  const wrapUpNote = job.wrapUpRequestedAt
    ? `Time check: stop new implementation work now. Save the current state in the existing worktree without reverting or committing. In ${job.roomId ? "this channel" : "this conversation"}, report what is done, what changed, what remains, checks/screenshots completed, and any blockers. Then finish your response.`
    : "";
  return [
    ...(job.roomId ? [] : ["Read MISSION.md and MEMORY.md before acting."]),
    forkNote,
    wrapUpNote,
    job.text,
    `Request: ${job.id}`,
  ]
    .filter(Boolean)
    .join("\n\n");
};

export const jobInput = (job: Job) => [
  { type: "text" as const, text: jobPrompt(job), mentions: [] },
  ...job.attachments.map((attachment) =>
    attachment.type === "localImage"
      ? { type: "localImage" as const, path: attachment.path }
      : {
          type: "localFile" as const,
          path: attachment.path,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        },
  ),
];

type TimelineRowLike = {
  kind?: unknown;
  role?: unknown;
  text?: unknown;
  children?: unknown;
};

function timelineRows(rows: unknown): TimelineRowLike[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const value = row as TimelineRowLike;
    return [value, ...timelineRows(value.children)];
  });
}


export type SteerRequest = {
  roomId: string;
  jobId: string;
  botId: string;
  message: RoomMessage;
  previous: {
    runId: string;
    triggerMessageId: string | null;
    text: string;
    attachments: Attachment[];
  };
};

export type MessageAuthor = {
  jobId?: string;
  automationId?: string;
  botId: string | null;
  speaker: string;
  sourceThreadId: string;
  depth: number;
};
export class Runtime {
  locks = new Map<string, Promise<unknown>>();
  routing = new Map<string, Promise<void>>();
  routingAborts = new Map<string, AbortController>();
  titleTasks = new Map<string, TitleTask>();
  failureLookups = new Map<string, Promise<string>>();
  returnTasks = new Map<string, Promise<void>>();
  returnDecision?: (group: Delegation, signal: AbortSignal) => Promise<boolean>;
  readonly delegations: Delegations;
  steerTasks = new Map<string, Promise<void>>();
  route?: (
    message: RoomMessage,
    room: Room,
    members: Bot[],
    signal: AbortSignal,
    tasks?: RoutingTask[],
    requiredBotIds?: string[],
  ) => Promise<RoutingSelection>;
  readonly busy = new Map<string, { threadId: string; at: number }>();
  readonly abort = new AbortController();
  readonly data: ChannelData;
  constructor(
    readonly bb: BbPluginApi,
    readonly store: Store,
  ) {
    this.data = new ChannelData(store);
    this.delegations = new Delegations(store);
  }
  /** Called after every change; channel threads deliver new messages from here. */
  readonly onChanged = new Set<() => void>();
  changed(scope: "all" | "bots" | "channel" = "all", id?: string) {
    publishChange(this.bb, scope, id);
    for (const listener of this.onChanged) listener();
  }
  /** Modes a provider offers on one machine. Cached: dispatch runs per turn. */
  providerModes = new Map<
    string,
    { modes: readonly string[]; at: number }
  >();
  async supportedModes(bot: Bot): Promise<readonly string[] | null> {
    const key = `${bot.hostId}:${bot.providerId}`;
    const cached = this.providerModes.get(key);
    if (cached && Date.now() - cached.at < 300_000) return cached.modes;
    try {
      const provider = (
        await this.bb.sdk.providers.list({ hostId: bot.hostId })
      ).find((p) => p.id === bot.providerId);
      if (!provider) return null;
      const modes = provider.capabilities.permissionModes;
      this.providerModes.set(key, { modes, at: Date.now() });
      return modes;
    } catch (cause) {
      this.bb.log.debug(`Permission modes unavailable: ${String(cause)}`);
      return null;
    }
  }
  /**
   * A channel's setting overrides its bots for work started there, so the owner
   * can open the gate for one session without editing every profile. A bot whose
   * provider cannot offer that mode keeps its own.
   */
  async permissionMode(
    bot: Bot,
    roomId: string | null | undefined,
  ): Promise<PermissionMode> {
    const room = roomId ? this.store.findRoom(roomId) : null;
    const wanted = room?.permissionMode ?? null;
    if (!wanted || wanted === bot.permissionMode) return bot.permissionMode;
    const modes = await this.supportedModes(bot);
    return !modes || modes.includes(wanted) ? wanted : bot.permissionMode;
  }
  async locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    const next = (this.locks.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(work);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
  async conversation(
    bot: Bot,
    key: string,
    kind: Conversation["kind"],
    title: string,
    prompt?: string,
    attachments: Attachment[] = [],
    permissionMode?: PermissionMode,
  ): Promise<Conversation> {
    if (bot.retired) throw new Error("Restore this bot before starting work.");
    const existing = this.store
      .conversations(bot.id)
      .find((c) => c.key === key);
    if (existing) return existing;
    const emptyDirectMessage = kind === "admin" && key === "admin" && !prompt && !attachments.length;
    const thread = await this.bb.sdk.threads.spawn({
      projectId: bot.projectId,
      environment: {
        type: "host",
        hostId: bot.hostId,
        workspace: { type: "personal" },
      },
      input: emptyDirectMessage ? [{
        type: "text",
        text: "",
        mentions: [],
      }] : [
        {
          type: "text",
          text: prompt ?? "",
          mentions: [],
        },
        ...attachments.map((a) =>
          a.type === "localImage"
            ? { type: "localImage" as const, path: a.path }
            : {
                type: "localFile" as const,
                path: a.path,
                name: a.name,
                mimeType: a.mimeType,
                sizeBytes: a.sizeBytes,
              },
        ),
      ],
      sendAt: Date.now() + (emptyDirectMessage ? 60_000 : 1500),
      ...(kind === "admin" ? {} : {
        title: kind === "group" ? `${bot.name} work · #${title}` : `${bot.name} · ${title}`,
      }),
      visibility: "hidden",
      providerId: bot.providerId,
      ...(bot.model ? { model: bot.model } : {}),
      reasoningLevel: bot.reasoningLevel,
      executionInputSources: {
        providerId: "explicit",
        ...(bot.model ? { model: "explicit" as const } : {}),
        reasoningLevel: "explicit",
      },
      permissionMode: permissionMode ?? bot.permissionMode,
      pluginMetadata: { botId: bot.id, conversationKey: key },
    });
    if (emptyDirectMessage) {
      try {
        let removed = false;
        for (let attempt = 0; attempt < 10 && !removed; attempt++) {
          const queued = await this.bb.sdk.threads.queuedMessages.list({ threadId: thread.id });
          const start = queued.find((item) =>
            item.content.length === 1 && item.content[0]?.type === "text" &&
            item.content[0].text === "");
          if (start) {
            // BB resolved the model onto this start message only. Keep it on the
            // thread, or the owner's first message has no model to run with.
            await this.bb.sdk.threads.update({
              threadId: thread.id,
              model: start.model,
              reasoningLevel: start.reasoningLevel,
            });
            await this.bb.sdk.threads.queuedMessages.delete({
              threadId: thread.id,
              queuedMessageId: start.id,
            });
            removed = true;
          } else if (attempt < 9) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        if (!removed) throw new Error("Could not clear the pending direct-message start.");
      } catch (cause) {
        await this.bb.sdk.threads.delete({
          threadId: thread.id,
          childThreadsConfirmed: true,
        }).catch(() => {});
        throw cause;
      }
    }
    const c: Conversation = {
      id: randomUUID(),
      botId: bot.id,
      key,
      threadId: thread.id,
      title,
      kind,
      createdAt: Date.now(),
      providerId: bot.providerId,
      model: bot.model,
    };
    this.store.putConversation(c);
    if (bot.error) this.store.put({ ...this.store.get(bot.id), error: null });
    this.changed("bots", bot.id);
    return c;
  }
  async forkConversation(
    bot: Bot,
    job: Job,
    permissionMode: PermissionMode,
  ): Promise<Conversation> {
    const sourceThreadId = job.forkSourceThreadId!;
    // The dispatch hook holds the first input until both conversation and job are registered.
    const thread = await this.bb.sdk.threads.fork({
      sourceThreadId,
      visibility: "hidden",
      title: `${bot.name} work · #${this.store.room(job.roomId!).name} · Fork`,
      permissionMode,
      pluginMetadata: { botId: bot.id, conversationKey: job.conversationKey },
      input: [
        { type: "text", text: jobPrompt(job), mentions: [] },
        ...job.attachments.map((a) =>
          a.type === "localImage"
            ? { type: "localImage" as const, path: a.path }
            : {
                type: "localFile" as const,
                path: a.path,
                name: a.name,
                mimeType: a.mimeType,
                sizeBytes: a.sizeBytes,
              },
        ),
      ],
    });
    const c: Conversation = {
      id: randomUUID(),
      botId: bot.id,
      key: job.conversationKey,
      threadId: thread.id,
      title: `${this.store.room(job.roomId!).name} · Fork`,
      kind: "group",
      createdAt: Date.now(),
    };
    this.store.putConversation(c);
    return c;
  }

  async driveForks(bot: Bot) {
    const first = new Map<string, Job>();
    for (const job of this.store.work(bot.id))
      if (
        isForkConversation(job.conversationKey) &&
        !first.has(job.conversationKey)
      )
        first.set(job.conversationKey, job);
    // Reconcile active forks first, then fill available slots. A blocked dispatch
    // must not prevent another fork from completing or being cleaned up.
    let active = [...first.values()].filter(
      (j) => j.status !== "queued",
    ).length;
    const failures: unknown[] = [];
    const ordered = [...first.values()].sort(
      (a, b) => Number(a.status === "queued") - Number(b.status === "queued"),
    );
    for (const job of ordered) {
      if (
        job.status === "queued" &&
        active >= (bot.limits ?? defaultLimits).concurrentForks
      )
        continue;
      const wasQueued = job.status === "queued";
      try {
        await this.drive(bot, job);
      } catch (cause) {
        failures.push(cause);
      }
      if (!wasQueued && !this.store.work(bot.id).some((j) => j.id === job.id))
        active--;
      if (
        wasQueued &&
        ["running", "dispatching"].includes(
          this.store.job(job.id)?.status ?? "",
        )
      )
        active++;
    }
    if (failures.length) throw failures[0];
  }

  enqueue(
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
  wake(bot: Bot) {
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
  postSystemMessage(
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
  postTimeoutNotice(job: Job) {
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
  send(
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

  sourceJobForMessage(message: RoomMessage) {
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
  messageAncestors(message: RoomMessage) {
    const source = this.sourceJobForMessage(message);
    return source ? this.delegations.ancestors(source) : new Set<string>();
  }
  trackDelegation(
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
  startReturns(room: Room) {
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
  async timeoutDelegate(
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
  async resolveReturn(group: Delegation) {
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

  targetKey(message: RoomMessage, botId: string) {
    const primary = `group:${message.roomId}`;
    const parent = message.replyTo ? this.store.message(message.replyTo) : null;
    if (!parent || (parent.botId && parent.botId !== botId)) return primary;
    const job =
      this.store.job(parent.botId ? parent.id : `${parent.id}:${botId}`) ??
      (parent.sourceJobId ? this.store.job(parent.sourceJobId) : null);
    const key =
      (parent.botId === botId ? parent.conversationKey : undefined) ??
      (job?.botId === botId ? job.conversationKey : undefined);
    return key === primary || key?.startsWith(`${primary}:fork:`)
      ? key
      : primary;
  }

  routingTasks(message: RoomMessage, members: Bot[]): RoutingTask[] {
    return members.map((bot) => {
      const key = this.targetKey(message, bot.id);
      const active = this.store
        .work(bot.id)
        .find(
          (job) =>
            job.conversationKey === key &&
            ["running", "dispatching"].includes(job.status),
        );
      const conversation = this.store
        .conversations(bot.id)
        .find((c) => c.key === key);
      const trigger = active?.triggerMessageId
        ? this.store.message(active.triggerMessageId)
        : null;
      return {
        botId: bot.id,
        threadId: active?.threadId ?? conversation?.threadId ?? null,
        busy: !!active,
        task: trigger?.text.slice(0, 2000) ?? "",
        jobId: active?.id ?? null,
      };
    });
  }

  dispatchMessage(
    room: Room,
    run: RoomRun,
    message: RoomMessage,
    botId: string,
    depth: number,
    action: DispatchAction,
    snapshot?: RoutingTask,
  ): { action: DispatchAction; steer?: SteerRequest } {
    return dispatchMessage.call(this, room, run, message, botId, depth, action, snapshot);
  }
  startSteer(request: Pick<SteerRequest, "jobId">): Promise<void> {
    return startSteer.call(this, request);
  }
  async recoverRoomTitles() {
    return recoverRoomTitles.call(this);
  }
  async findTitleWorkers() {
    return findTitleWorkers.call(this);
  }
  startRoomTitle(
    room: Room,
    message: RoomMessage,
    existing?: TitleWorker,
  ) {
    return startRoomTitle.call(this, room, message, existing);
  }
  async generateRoomTitle(
    roomId: string,
    message: RoomMessage,
    bot: Bot | null,
    existing: TitleWorker | null,
    signal: AbortSignal,
  ) {
    return generateRoomTitle.call(this, roomId, message, bot, existing, signal);
  }
  async cleanupTitleThread(threadId: string) {
    return cleanupTitleThread.call(this, threadId);
  }
  async applyRoomTitle(roomId: string, candidate: string | null) {
    return applyRoomTitle.call(this, roomId, candidate);
  }
  sendScheduled(
    room: Room,
    botId: string,
    automationId: string,
    name: string,
    prompt: string,
    requestId: string,
  ) {
    return this.send(room, prompt, requestId, [], null, undefined, {
      botId,
      automationId,
      name,
    });
  }
  startRouting(room: Room, run: RoomRun) {
    return startRouting.call(this, room, run);
  }
  retryRouting(id: string, requestId: string) {
    return retryRouting.call(this, id, requestId);
  }
  invite(
    room: Room,
    run: RoomRun,
    trigger: RoomMessage,
    botId: string,
    depth: number,
    dispatch: Partial<
      Pick<
        Job,
        | "conversationKey"
        | "dispatchAction"
        | "forkSourceThreadId"
        | "status"
        | "error"
      >
    > = {},
  ) {
    if (!room.memberIds.includes(botId)) return;
    const bot = this.store.get(botId);
    if (bot.retired) return;
    if (run.pendingJobIds.length + run.settledJobIds.length >= 32) {
      run.error =
        "This request reached its 32-response limit. Send a focused follow-up to continue.";
      return;
    }
    // Deterministic delivery identity makes recovery and repeated collection idempotent.
    const id = `${trigger.id}:${botId}`;
    const parent = trigger.botId ? this.sourceJobForMessage(trigger) : null;
    if (
      this.enqueue(bot, {
        id,
        text: "",
        taskTitle: trigger.text.slice(0, 240),
        conversationKey: `group:${room.id}`,
        roomId: room.id,
        runId: run.id,
        triggerMessageId: trigger.id,
        depth,
        ...(parent?.rootTaskId ? { rootTaskId: parent.rootTaskId } : {}),
        ...(parent ? { parentTaskId: parent.id } : {}),
        ...(parent?.coordinatorId ? { coordinatorId: parent.coordinatorId } : {}),
        ...(trigger.automationId ? { automationId: trigger.automationId } : {}),
        attachments: trigger.attachments,
        ...dispatch,
      })
    )
      run.pendingJobIds.push(id);
  }
  prepareGroup(job: Job, bot: Bot) {
    if (job.returnOf) {
      const group = this.delegations.get(job.returnOf);
      if (group) job.text = this.delegations.prompt(group);
      return;
    }
    const room = this.store.room(job.roomId!),
      trigger = job.triggerMessageId
        ? this.store.message(job.triggerMessageId)
        : null;
    if (!trigger) return; // An older saved job already has its prompt.
    const recent = this.store.visibleMessages(room.id, 40);
    const conversation = this.store
      .conversations(bot.id)
      .find((candidate) => candidate.key === job.conversationKey);
    // The bot work thread retains earlier inputs. Only replay channel messages it
    // has not received, while keeping the first turn's bounded history.
    const previous = conversation
      ? this.store.latestDeliveredJob(
          bot.id,
          job.conversationKey,
          conversation.threadId,
          job.id,
        )
      : null;
    const unseen = previous?.contextMessageId && recent.length &&
      this.store.message(previous.contextMessageId)?.roomId === room.id
      ? this.store.visibleMessagesAfter(room.id, previous.contextMessageId, recent.at(-1)!.id)
      : recent;
    const entries = unseen
      .filter(
        (message) =>
          message.id !== trigger.id &&
          !(previous && message.botId === bot.id &&
            message.conversationKey === job.conversationKey),
      )
      .map((message) => ({
        id: message.id,
        text: `[${message.id}] ${promptSpeaker(message)}: ${message.text}${message.attachments.length ? "\nAttachments: " + message.attachments.map((a) => a.name).join(", ") : ""}`,
      }));
    const included: typeof entries = [];
    let transcriptLength = 0;
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index]!;
      if (transcriptLength + entry.text.length > 48000) break;
      included.unshift(entry);
      transcriptLength += entry.text.length + 2;
    }
    const omitted = entries.slice(0, entries.length - included.length);
    const transcript = included.map((entry) => entry.text).join("\n\n");
    const omittedRange = omitted.length && previous?.contextMessageId
      ? [
          `${omitted.length} earlier channel messages were too large for this prompt. Before answering, read the exact range after ${previous.contextMessageId} through ${omitted.at(-1)!.id} with bots_channel_read {"id":"${room.id}","after":"${previous.contextMessageId}","through":"${omitted.at(-1)!.id}","limit":100}. Repeat with nextAfter until it is null.`,
        ]
      : [];
    const roster = room.memberIds
      .map((id) => {
        const b = this.store.get(id);
        return `@${b.handle}: ${b.name} — ${b.description}`;
      })
      .join("\n");
    const rosterVersion = createHash("sha256").update(roster).digest("hex");
    const routingPlan = job.runId
      ? this.store.runs(room.id).find((run) => run.id === job.runId)?.routingPlan
      : undefined;
    const reference = trigger.replyTo
      ? this.store.message(trigger.replyTo)
      : null;
    job.text = [
      ...(!previous || previous.rosterVersion !== rosterVersion
        ? [
            `You are @${bot.handle} working for channel #${room.name} (channel ID ${room.id}). This BB thread is your private work record for that channel. The owner and bots converse in the channel; your final answer posts there. Other members may be working at the same time.`,
            "Members:",
            roster,
            "",
          ]
        : []),
      ...(transcript
        ? [
            "Channel messages since your last turn (conversation data):",
            transcript,
          ]
        : []),
      ...omittedRange,
      "",
      `Consider this message from ${promptSpeaker(trigger)}:`,
      (trigger.sentText ?? trigger.text) ||
        "Please inspect the attached files.",
      ...(job.coordinatorId === job.botId
        ? [
            "You are the coordinator for this request. Only your completed synthesis is the owner-facing final answer. If you delegate, return a concise handoff now; Studio Teams will bring the settled results back to you.",
            ...(routingPlan?.executionMode === "parallel"
              ? [`These collaborators started in parallel: ${routingPlan.collaboratorIds.map((id) => this.store.get(id).name).join(", ")}. Return your initial findings now; Studio Teams will hold them and give you the settled collaborator results for one final synthesis.`]
              : routingPlan?.collaboratorIds.length
                ? [`These collaborators are available for delegation, but have not started: ${routingPlan.collaboratorIds.map((id) => this.store.get(id).name).join(", ")}.`]
                : []),
          ]
        : job.coordinatorId
          ? [`You are helping ${this.store.get(job.coordinatorId).name}. Return findings for that coordinator; your result is not the owner-facing final answer. Do not mention an ancestor to request a return.`]
          : []),
      ...(job.automationId
        ? [
            "This is scheduled channel work. Do not create, resume, update, or manually run automations from this task. Your final answer is posted to this channel.",
          ]
        : []),
      ...(reference
        ? [`Replying to ${promptSpeaker(reference)}: ${reference.text}`]
        : []),
    ].join("\n");
    job.contextMessageId = recent.at(-1)?.id;
    job.rosterVersion = rosterVersion;
    // Current uploads are required inputs. Only incidental recent attachments
    // may be trimmed to the context budget.
    const required = new Map(trigger.attachments.map((a) => [a.id, a]));
    const available = Math.max(0, 10 - required.size);
    const recentFiles = [
      ...new Map(
        unseen.flatMap((m) => m.attachments).map((a) => [a.id, a]),
      ).values(),
    ].filter((a) => !required.has(a.id));
    job.attachments = [
      ...(available ? recentFiles.slice(-available) : []),
      ...required.values(),
    ];
    this.store.putJob(job);
  }
  async prepareProjectAttachments(job: Job, projectId: string) {
    if (!job.attachments.length) return;
    const trigger = job.triggerMessageId
      ? this.store.message(job.triggerMessageId)
      : null;
    const required = new Set(
      (trigger?.attachments ?? job.attachments).map((a) => a.id),
    );
    const result = await attachmentsForProject(
      this.bb,
      job.attachments,
      projectId,
      required,
    );
    job.attachments = result.attachments;
    if (result.unavailable.length)
      job.text += `\n\nHistorical attachments unavailable after project deletion (ask the owner to upload again if needed): ${result.unavailable.join(", ")}`;
  }
  activeJobForThread(threadId: string): Job | null {
    const conversation = this.store.byThread(threadId);
    if (!conversation) return null;
    return (
      this.store
        .work(conversation.botId)
        .filter(
          (job) =>
            job.threadId === threadId &&
            ["running", "dispatching"].includes(job.status),
        )
        .sort(
          (left, right) =>
            (right.dispatchStartedAt ?? right.updatedAt) -
            (left.dispatchStartedAt ?? left.updatedAt),
        )[0] ?? null
    );
  }
  /**
   * A persistent thread can contain several turns. Only settle recovery work
   * when its latest user input is the request we registered for this job.
   * A reused or forked session must have positive attribution before we use
   * its output, since it can still contain an earlier request's answer.
   */
  async latestPromptMatches(
    threadId: string,
    expected: string,
  ): Promise<boolean | null> {
    try {
      const timeline = await this.bb.sdk.threads.timeline({
        threadId,
        includeNestedRows: "true",
        segmentLimit: "100",
      });
      const prompts = timelineRows(timeline?.rows).filter(
        (row) =>
          row.kind === "conversation" &&
          row.role === "user" &&
          typeof row.text === "string",
      );
      if (!prompts.length) return null;
      return prompts.at(-1)?.text === expected;
    } catch (cause) {
      if (!missingThread(cause))
        this.bb.log.debug(
          `Persistent bot turn verification failed: ${errorText(cause)}`,
        );
      return null;
    }
  }
  /**
   * Thread events do not carry the plugin job ID. Re-check the current thread
   * before accepting an idle/error event so a late event from an earlier turn
   * cannot settle a newer request on the shared conversation.
   */
  async failureFromThread(
    threadId: string,
    job: Job,
    beforeAt = Infinity,
  ): Promise<string> {
    try {
      const events = await this.bb.sdk.threads.events.list({
        threadId,
        types: ["provider/error", "system/error", "client/turn/rejected"],
        order: "desc",
        limit: "20",
      });
      const startedAt = job.dispatchStartedAt ?? job.createdAt;
      for (const event of events) {
        if (event.createdAt < startedAt || event.createdAt > beforeAt) continue;
        const data = event.data as { detail?: unknown; message?: unknown };
        const detail = typeof data.detail === "string" ? data.detail.trim() : "";
        const summary = typeof data.message === "string" ? data.message.trim() : "";
        const reason = detail || summary;
        if (reason) return reason.slice(0, 1000);
      }
    } catch (cause) {
      this.bb.log.debug(`Bot failure detail unavailable: ${errorText(cause)}`);
    }
    return "Agent turn failed.";
  }
  async providerFailed(threadId: string, job: Job): Promise<boolean> {
    try {
      const events = await this.bb.sdk.threads.events.list({
        threadId,
        types: ["provider/error"],
        order: "desc",
        limit: "20",
      });
      const startedAt = job.dispatchStartedAt ?? job.createdAt;
      return events.some((event) => event.createdAt >= startedAt);
    } catch (cause) {
      this.bb.log.debug(`Provider failure check unavailable: ${errorText(cause)}`);
      return false;
    }
  }
  async settleFromEvent(
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
  complete(threadId: string, text: string | null, error?: string, providerFailure = false) {
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
  async cancel(
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
  async stopRoom(room: Room) {
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
  async retire(id: string, retired: boolean): Promise<Bot> {
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
            for (const c of this.store
              .conversations(id)
              .filter((c) => c.kind === "admin" && !c.archivedAt)) {
              try {
                for (const q of await this.bb.sdk.threads.queuedMessages.list({
                  threadId: c.threadId,
                }))
                  await this.bb.sdk.threads.queuedMessages.delete({
                    threadId: c.threadId,
                    queuedMessageId: q.id,
                  });
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
  async retryJob(id: string): Promise<Job> {
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
  async deleteRoom(id: string): Promise<boolean> {
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
  async refreshJobActivity(job: Job): Promise<Job> {
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
  async roomJobsWithActivity(roomId: string): Promise<Job[]> {
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
  async driveRoom(room: Room) {
    return driveRoom.call(this, room);
  }
  async reconcileBusy(bot: Bot) {
    const work = this.store.work(bot.id);
    const threadIds = new Set([
      ...this.store
        .conversations(bot.id)
        .filter((c) => c.kind === "admin" && !c.archivedAt)
        .map((c) => c.threadId),
      ...work
        .flatMap((j) =>
          j.threadId && !isForkConversation(j.conversationKey)
            ? [j.threadId]
            : [],
        ),
    ]);
    const activeLanes = new Set<string>();
    for (const threadId of threadIds) {
      const conversation = this.store.byThread(threadId);
      const job = work.find((j) => j.threadId === threadId);
      const key = conversation?.key ?? job?.conversationKey;
      if (!key) continue;
      const lane = primaryLane(bot.id, key);
      const busy = this.busy.get(lane);
      if (busy && Date.now() - busy.at < 5000) {
        activeLanes.add(lane);
        continue;
      }
      let thread;
      try {
        thread = await this.bb.sdk.threads.get({ threadId });
      } catch (cause) {
        if (!missingThread(cause)) throw cause;
        this.complete(threadId, null, "The work conversation was deleted.");
        this.store.deleteConversation(threadId);
        continue;
      }
      if (thread.status === "active") {
        this.busy.set(lane, { threadId, at: Date.now() });
        activeLanes.add(lane);
      }
    }
    for (const lane of this.busy.keys())
      if (
        (lane === bot.id || lane.startsWith(`${bot.id}:group:`)) &&
        !activeLanes.has(lane)
      )
        this.busy.delete(lane);
  }
  async drive(bot: Bot, forkJob?: Job) {
    if (forkJob) return this.driveJob(bot, forkJob, true);
    const first = new Map<string, Job>();
    for (const job of this.store.work(bot.id)) {
      if (!isForkConversation(job.conversationKey)) {
        const lane = primaryLane(bot.id, job.conversationKey);
        if (!first.has(lane)) first.set(lane, job);
      }
    }
    const results = await Promise.allSettled(
      [...first.values()].map((job) => this.driveJob(bot, job, false)),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  async driveJob(bot: Bot, job: Job, forkJob: boolean) {
    return driveJob.call(this, bot, job, forkJob);
  }
  async tick() {
    return tick.call(this);
  }
  async dispose() {
    this.abort.abort();
    for (const task of this.titleTasks.values()) task.controller.abort();
    await Promise.allSettled(
      [...this.titleTasks.values()].map((task) => task.promise),
    );
    await Promise.allSettled(this.routing.values());
    await Promise.allSettled(this.steerTasks.values());
    await Promise.allSettled(this.returnTasks.values());
    await Promise.allSettled(this.failureLookups.values());
    await Promise.allSettled(this.locks.values());
  }
}
