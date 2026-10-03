import { permissionForTrust } from "../../office/trust";
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Attachment, Bot, Conversation, Job, PermissionMode } from "./contract";
import { Store } from "./store";
import { ChannelData } from "./channel-data";
import { defaultLimits } from "./workspace-contract";
import { publishChange } from "./realtime-server";
import { isExecuting } from "./job-state";
import { activitySnippetFromTimeline, isPassReply } from "./activity";
import { advanceTurnClock } from "./turn-clock";
import { jobHasProgress, retryStalled, stalledAfterRetry } from "./mission-stall";
export const errorText = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
export const missingThread = (cause: unknown) => /(?:^|\b)(?:thread not found|thread does not exist|HTTP 404)(?:\b|$)/i.test(errorText(cause));
export const primaryLane = (botId: string, _conversationKey: string) => botId;
export const jobPrompt = (job: Job) => ["Read MISSION.md and MEMORY.md before acting.", job.stallRetriedAt ? "Retry: the previous attempt at this request made no progress (the provider kept failing or the host disconnected) and was stopped. Start the request now." : "", job.wrapUpRequestedAt ? "Time check: stop new work, save progress in MEMORY.md, report completed work, checks and blockers, then finish." : "", job.text, `Request: ${job.id}`].filter(Boolean).join("\n\n");
export const jobInput = (job: Job) => [{ type: "text" as const, text: jobPrompt(job), mentions: [] }];
type TimelineRowLike = {kind?: unknown; role?: unknown; text?: unknown; children?: unknown};
export function timelineRows(rows: unknown): TimelineRowLike[] { return Array.isArray(rows) ? rows.flatMap(row => row && typeof row === "object" ? [row, ...timelineRows(row.children)] : []) : []; }
/** Only legacy mission scheduling is managed here. Views use BB's ordinary threads. */
export class Runtime {
readonly locks = new Map<string, Promise<unknown>>();
readonly busy = new Map<string, {threadId:string;at:number}>();
readonly progressChecks = new Map<string, {at:number;progress:boolean}>();
readonly onChanged = new Set<() => void>();
readonly data: ChannelData;
onMissionThread?: (bot: Bot, threadId: string) => Promise<void>;
constructor(readonly bb: BbPluginApi, readonly store: Store) { this.data = new ChannelData(store); }
changed(scope: "all"|"bots"|"channel"="all", id?:string) { publishChange(this.bb,scope,id); for(const fn of this.onChanged) fn(); }
permissionMode(bot: Bot, _roomId?: string | null): Promise<PermissionMode> { return Promise.resolve(permissionForTrust(bot.trust ?? "ask")); }
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
    projectId?: string,
  ): Promise<Conversation> {
    if (bot.retired) throw new Error("Restore this bot before starting work.");
    const existing = this.store
      .conversations(bot.id)
      .find((c) => c.key === key);
    if (existing) return existing;
    const emptyDirectMessage = kind === "admin" && !prompt && !attachments.length;
    const targetProject = projectId ?? bot.projectId;
    const project = targetProject !== "proj_personal" ? await this.bb.sdk.projects.get({ projectId: targetProject }) : null;
    const source = project?.sources.find(source => source.isDefault) ?? project?.sources[0];
    const thread = await this.bb.sdk.threads.spawn({
      projectId: projectId ?? bot.projectId,
      environment: {
        type: "host",
        hostId: source?.hostId ?? bot.hostId,
        workspace: source?.path ? { type: "unmanaged", path: source.path } : { type: "personal" },
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
      // A thread with a profile is an ordinary thread; bot work stays hidden.
      visibility: projectId || kind !== "admin" ? "hidden" : "visible",
      providerId: bot.providerId,
      ...(bot.model ? { model: bot.model } : {}),
      reasoningLevel: bot.reasoningLevel,
      executionInputSources: {
        providerId: "explicit",
        ...(bot.model ? { model: "explicit" as const } : {}),
        reasoningLevel: "explicit",
      },
      permissionMode: permissionForTrust(bot.trust ?? "ask"),
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
    if (kind === "mission") await this.onMissionThread?.(bot, c.threadId);
    if (bot.error) this.store.put({ ...this.store.get(bot.id), error: null });
    this.changed("bots", bot.id);
    return c;
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
wake( bot: Bot) {
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
complete( threadId: string, text: string | null, error?: string, providerFailure = false) {
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
    if (error) {
      if (providerFailure && job.fallbackAttempted && c.key === job.conversationKey)
        this.store.archiveConversation(c);
      job.status = "error";
      job.error = error;
    } else {
      job.reply = isPassReply(text) ? null : text?.trim() || null;
      job.error = null;
      job.status = "done";
    }
    this.store.putJob(job);
    this.changed();
  }
async refreshJobActivity( job: Job): Promise<Job> {
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
        this.store.clearTimeoutNoticePending(current.id);
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
async driveJob( bot: Bot, job: Job, forkJob: boolean) {
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
        if (output?.trim() && matches !== false && (!current.requiresPromptMatch || matches === true)) this.complete(job.threadId, output);
        else if (matches === false || !current.requiresPromptMatch || matches === true) this.complete(job.threadId, null, "Dispatch outcome is unknown. Inspect the conversation before sending again.");
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
              title: "Mission",
              kind: "mission",
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
    for (const [window, maximum, label] of [[3600000, (bot.limits ?? defaultLimits).turnsPerHour, "hour"], [86400000, (bot.limits ?? defaultLimits).turnsPerDay, "day"]] as const) {
      const count = this.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE bot_id=? AND COALESCE(json_extract(json,'$.startedAt'),json_extract(json,'$.dispatchStartedAt'))>?").get(bot.id, Date.now()-window) as {n:number};
      if(count.n>=maximum) throw new Error(`Bot limit reached (${maximum} turns per ${label}). Queued work resumes when capacity is available.`);
    }
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
        }
      }
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
      if (!c) c = await this.conversation(executionBot, job.conversationKey, "mission", "Mission", jobPrompt(job), [], permissionMode);
      else {
        // The dispatch hook runs during send and must already see this job.
        const pending = this.store.job(job.id)!;
        if (pending.status === "cancelled") return;
        pending.threadId = c.threadId;
        this.store.putJob(pending);
        await this.onMissionThread?.(bot, c.threadId);
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
async startSteer({jobId}:{jobId:string}) {
 const job=this.store.job(jobId); if(!job?.pendingSteer || !job.threadId) return;
 await this.bb.sdk.threads.send({threadId:job.threadId, input:jobInput(job), mode:"steer-if-active"});
 const current=this.store.job(jobId); if(current?.pendingSteer) { current.pendingSteer=undefined; this.store.putJob(current); }
}
async retire(id:string, retired:boolean):Promise<Bot> { return this.locked(id, async()=> {
 const bot=this.store.get(id); if(!!bot.retired===retired) return bot;
 if(retired) {
   for(const job of this.store.work(id)) await this.cancel(job,"Bot archived by the owner.",true);
   // Release idle sessions so their next turn no longer carries this profile.
   for(const conversation of this.store.conversations(id).filter(c=>c.kind==="admin")) {
     try {
       const thread=await this.bb.sdk.threads.get({threadId:conversation.threadId});
       if(thread.status==="idle") await this.bb.sdk.threads.stop({threadId:conversation.threadId});
     } catch(cause) { if(!missingThread(cause)) throw cause; }
   }
 }
 const next={...bot,retired,intervalMinutes:0,updatedAt:Math.max(Date.now(),bot.updatedAt+1)};this.store.put(next);this.changed();return next;
}); }
async retryJob(id:string):Promise<Job> { const job=this.store.job(id); if(!job || job.roomId) throw new Error("Open the ordinary thread to retry this work."); return this.locked(job.botId,async()=>{ if(!["error","cancelled"].includes(job.status)||job.cancellationPending) throw new Error("Wait for this mission to stop before retrying."); const retryId=`retry:${id}`; if(!this.store.job(retryId)) this.enqueue(this.store.get(job.botId),{id:retryId,retryOf:id,text:job.text,conversationKey:"mission"}); return this.store.job(retryId)!; }); }
async tickMissions() { for(const bot of this.store.all()) await this.locked(bot.id,async()=>{
 try { const cleanup=this.store.work(bot.id).filter(j=>j.cancellationPending); for(const job of cleanup) await this.driveJob(bot,job,false);
 if(bot.retired)return; if(bot.intervalMinutes && Date.now()-bot.lastWakeAt>=bot.intervalMinutes*60000)this.wake(bot);
 const job=this.store.work(bot.id).find(j=>j.conversationKey==="mission");if(job)await this.driveJob(bot,job,false);
 if(bot.error){this.store.put({...this.store.get(bot.id),error:null});this.changed();}
 }catch(cause){const error=errorText(cause);if(bot.error!==error){this.store.put({...this.store.get(bot.id),error});this.changed();}}
 }); }
async drive(bot:Bot){ for(const job of this.store.work(bot.id)) if(!job.roomId)await this.driveJob(bot,job,false); }
async tick(){
 for(const bot of this.store.all()) for(const c of this.store.conversations(bot.id).filter(c=>c.kind==="admin")) {
  try{await this.bb.sdk.threads.get({threadId:c.threadId});}catch(cause){if(missingThread(cause))this.store.deleteConversation(c.threadId);else throw cause;}
 }
 return this.tickMissions();
}
async dispose(){await Promise.allSettled(this.locks.values());}
}
