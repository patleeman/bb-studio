import { settleFromEvent, complete, cancel, stopRoom, retire, retryJob, deleteRoom, refreshJobActivity, roomJobsWithActivity } from "./runtime-lifecycle";
import { enqueue, wake, postSystemMessage, postTimeoutNotice, send } from "./runtime-messages";
import { sourceJobForMessage, messageAncestors, trackDelegation, startReturns, timeoutDelegate, resolveReturn } from "./runtime-delegation";
import { forkConversation, driveForks } from "./runtime-forks";
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

export function timelineRows(rows: unknown): TimelineRowLike[] {
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
    return forkConversation.call(this, bot, job, permissionMode);
  }
  async driveForks(bot: Bot) {
    return driveForks.call(this, bot);
  }
  enqueue(
    bot: Bot,
    args: Partial<Job> & Pick<Job, "id" | "text" | "conversationKey">,
  ) {
    return enqueue.call(this, bot, args);
  }
  wake(bot: Bot) {
    return wake.call(this, bot);
  }
  postSystemMessage(
    room: Room,
    text: string,
    system: "bot_joined",
  ): RoomMessage {
    return postSystemMessage.call(this, room, text, system);
  }
  postTimeoutNotice(job: Job) {
    return postTimeoutNotice.call(this, job);
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
    return send.call(this, room, text, requestId, attachments, replyTo, author, scheduled, requestedMode, directMessages);
  }
  sourceJobForMessage(message: RoomMessage) {
    return sourceJobForMessage.call(this, message);
  }
  messageAncestors(message: RoomMessage) {
    return messageAncestors.call(this, message);
  }
  trackDelegation(
    message: RoomMessage,
    run: RoomRun,
    sourceThreadId = message.sourceThreadId,
    sourceJob: Job | null = null,
  ) {
    return trackDelegation.call(this, message, run, sourceThreadId, sourceJob);
  }
  startReturns(room: Room) {
    return startReturns.call(this, room);
  }
  async timeoutDelegate(
    job: Job,
    deadlineGroupId: string,
    seen = new Set<string>(),
  ) {
    return timeoutDelegate.call(this, job, deadlineGroupId, seen);
  }
  async resolveReturn(group: Delegation) {
    return resolveReturn.call(this, group);
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
    return settleFromEvent.call(this, threadId, text, error, acceptJoinedDirectMessage);
  }
  complete(threadId: string, text: string | null, error?: string, providerFailure = false) {
    return complete.call(this, threadId, text, error, providerFailure);
  }
  async cancel(
    job: Job,
    reason: string,
    requireStopped = false,
    timedOut = false,
  ) {
    return cancel.call(this, job, reason, requireStopped, timedOut);
  }
  async stopRoom(room: Room) {
    return stopRoom.call(this, room);
  }
  async retire(id: string, retired: boolean): Promise<Bot> {
    return retire.call(this, id, retired);
  }
  async retryJob(id: string): Promise<Job> {
    return retryJob.call(this, id);
  }
  async deleteRoom(id: string): Promise<boolean> {
    return deleteRoom.call(this, id);
  }
  async refreshJobActivity(job: Job): Promise<Job> {
    return refreshJobActivity.call(this, job);
  }
  async roomJobsWithActivity(roomId: string): Promise<Job[]> {
    return roomJobsWithActivity.call(this, roomId);
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
