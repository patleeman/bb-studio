import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Bot, Conversation } from "./contract";
import { missingThread, type Runtime } from "./mission-runtime";
import type { Store } from "./store";

const pendingForMs = 10 * 60_000;

/**
 * A thread with a profile is an ordinary BB thread whose agent works as a bot:
 * in the thread's own project, with the bot's home documents and memory.
 * These are conversations of kind "admin" keyed `thread:<id>`. The bot's own
 * session management (model changes, history) leaves them alone.
 */
export class ThreadProfiles {
  // A profile picked in the new-thread composer, by project, until the
  // thread's first message is dispatched.
  private readonly pending = new Map<string, { botId: string; at: number }>();

  constructor(
    private readonly bb: BbPluginApi,
    private readonly store: Store,
    private readonly runtime: Pick<Runtime, "conversation" | "changed">,
    /** False for threads this plugin runs itself, such as channels and routing. */
    private readonly eligible: (threadId: string) => boolean,
  ) {}

  /** The attached bot, or null when this thread cannot take a profile. */
  profile(threadId: string): { botId: string | null } | null {
    if (!this.eligible(threadId)) return null;
    const conversation = this.store.byThread(threadId);
    if (!conversation) return { botId: null };
    return conversation.kind === "admin" ? { botId: conversation.botId } : null;
  }

  async set(threadId: string, botId: string | null) {
    const current = this.profile(threadId);
    if (!current) throw new Error("This thread can't work as a bot.");
    if (current.botId === botId) return current;
    const bot = botId ? this.store.get(botId) : null;
    if (bot?.retired) throw new Error("Restore this bot before working as it.");
    const thread = await this.bb.sdk.threads.get({ threadId });
    if (["starting", "active", "stopping"].includes(thread.status))
      throw new Error("Wait for this thread's current response before changing which bot it works as.");
    this.store.deleteConversation(threadId);
    if (bot) {
      this.attach(bot, threadId);
      if (thread.providerId === bot.providerId)
        await this.bb.sdk.threads.update({
          threadId,
          ...(bot.model ? { model: bot.model } : {}),
          reasoningLevel: bot.reasoningLevel,
        });
    }
    // Instructions are fixed when the agent's session starts, so release it.
    if (thread.status !== "pending")
      await this.bb.sdk.threads.stop({ threadId }).catch((cause) => {
        if (!missingThread(cause)) throw cause;
      });
    this.runtime.changed();
    return { botId };
  }

  attach(bot: Bot, threadId: string) {
    const conversation: Conversation = {
      id: randomUUID(),
      botId: bot.id,
      key: `thread:${threadId}`,
      threadId,
      title: bot.name,
      kind: "admin",
      createdAt: Date.now(),
      providerId: bot.providerId,
      model: bot.model,
    };
    this.store.putConversation(conversation);
    this.runtime.changed("bots", bot.id);
    return conversation;
  }

  setPending(projectId: string, botId: string | null) {
    if (botId) this.pending.set(projectId, { botId, at: Date.now() });
    else this.pending.delete(projectId);
  }

  /** Attaches the profile picked for this project's next new thread, if any. */
  attachPending(projectId: string, threadId: string) {
    const pending = this.pending.get(projectId);
    this.pending.delete(projectId);
    if (!pending || Date.now() - pending.at > pendingForMs) return null;
    const bot = this.store.findBot(pending.botId);
    if (!bot || bot.retired || !this.eligible(threadId)) return null;
    return this.attach(bot, threadId);
  }

  /** A new empty thread with this profile, in the bot's own project. */
  async newThread(bot: Bot, projectId?: string) {
    const conversation = await this.runtime.conversation(bot, `thread:${randomUUID()}`, "admin", bot.name, undefined, [], undefined, projectId);
    this.runtime.changed("bots", bot.id);
    return conversation;
  }

  /** The bot's latest attached thread, or a new one. */
  async latestThread(bot: Bot) {
    const current = this.store.currentDirectConversation(bot.id);
    if (current) {
      try {
        await this.bb.sdk.threads.get({ threadId: current.threadId });
        return current;
      } catch (cause) {
        if (!missingThread(cause)) throw cause;
        this.store.deleteConversation(current.threadId);
      }
    }
    return this.newThread(bot);
  }

  /** Old direct messages were hidden threads; show them as ordinary ones. */
  async showMigrated() {
    for (const threadId of this.store.profileThreadsToShow()) {
      try {
        await this.bb.sdk.threads.update({ threadId, visibility: "visible" });
      } catch (cause) {
        if (!missingThread(cause)) throw cause;
      }
      this.store.shownProfileThread(threadId);
    }
  }
}
