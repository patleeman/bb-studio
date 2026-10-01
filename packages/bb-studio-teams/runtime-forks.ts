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
export async function forkConversation(this: Runtime, 
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


export async function driveForks(this: Runtime, bot: Bot) {
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

