import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

// Reads bots from the Studio Teams plugin over its published RPC. Pages works
// without Studio Teams; bot features then report that it isn't installed.

export const BOT_TEAMS_ID = "bot-teams";
const CACHE_MS = 15_000;

const botListSchema = z.object({
  bots: z.array(
    z
      .object({
        id: z.string(),
        name: z.string(),
        handle: z.string().default(""),
        avatar: z.string().default("🤖"),
        description: z.string().default(""),
        projectId: z.string().default(""),
        retired: z.boolean().optional(),
        working: z.boolean().default(false),
        model: z.string().default(""),
        reasoningLevel: z.string().default(""),
      })
      .passthrough(),
  ),
  directThreads: z.record(z.string(), z.object({ threadId: z.string() }).passthrough()).default({}),
  directConversations: z
    .record(z.string(), z.array(z.object({ threadId: z.string(), kind: z.string() }).passthrough()))
    .default({}),
});

const conversationSchema = z.object({ threadId: z.string(), botId: z.string() }).passthrough();

export interface BotInfo {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  description: string;
  working: boolean;
  /** The bot's configured model, passed on sends to a DM that never ran. */
  model: string;
  reasoningLevel: string;
}

interface Directory {
  bots: BotInfo[];
  byThread: Map<string, string>;
  at: number;
}

export type BotDirectoryResult = { available: true; bots: BotInfo[] } | { available: false; bots: []; reason: string };

/** Deterministic, readable cursor color per actor key. */
export function actorColor(key: string): string {
  const palette = ["#7c3aed", "#0891b2", "#db2777", "#16a34a", "#ea580c", "#2563eb", "#9333ea", "#0d9488"];
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length]!;
}

export class BotDirectory {
  private cache: Directory | null = null;
  private inflight: Promise<Directory> | null = null;
  private failure: { reason: string; at: number } | null = null;

  constructor(private readonly bb: BbPluginApi) {}

  async list(): Promise<BotDirectoryResult> {
    try {
      const directory = await this.load();
      return { available: true, bots: directory.bots };
    } catch (error) {
      return { available: false, bots: [], reason: message(error) };
    }
  }

  async get(botId: string): Promise<BotInfo | null> {
    const result = await this.list();
    return result.bots.find((bot) => bot.id === botId) ?? null;
  }

  /** The bot whose conversation thread this is, if any. */
  async botForThread(threadId: string): Promise<BotInfo | null> {
    try {
      let directory = await this.load();
      if (!directory.byThread.has(threadId) && Date.now() - directory.at > 2000) {
        directory = await this.load(true);
      }
      const botId = directory.byThread.get(threadId);
      return botId ? (directory.bots.find((bot) => bot.id === botId) ?? null) : null;
    } catch {
      return null;
    }
  }

  /** Finds bots named in free text as `@Name` or `@handle`. */
  async mentionedIn(text: string): Promise<BotInfo[]> {
    if (!text.includes("@")) return [];
    const { bots } = await this.list();
    const lower = text.toLowerCase();
    return bots.filter((bot) =>
      [bot.name, bot.handle]
        .filter(Boolean)
        .some((name) => new RegExp(`(^|[^\\w])@${escapeRegExp(name.toLowerCase())}(?![\\w-])`).test(lower)),
    );
  }

  /** The bot's owner conversation thread, created by Studio Teams on first use. */
  async conversationThread(botId: string): Promise<string> {
    const conversation = await this.bb.sdk.plugins.callRpc({
      pluginId: BOT_TEAMS_ID,
      method: "conversation",
      input: { id: botId },
      outputSchema: conversationSchema,
    });
    this.cache?.byThread.set(conversation.threadId, botId);
    return conversation.threadId;
  }

  private async load(force = false): Promise<Directory> {
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    if (!force && this.failure && Date.now() - this.failure.at < CACHE_MS) throw new Error(this.failure.reason);
    this.inflight ??= this.fetch().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetch(): Promise<Directory> {
    try {
      const result = await this.bb.sdk.plugins.callRpc({
        pluginId: BOT_TEAMS_ID,
        method: "list",
        input: null,
        outputSchema: botListSchema,
      });
      const byThread = new Map<string, string>();
      for (const [botId, view] of Object.entries(result.directThreads)) byThread.set(view.threadId, botId);
      for (const [botId, conversations] of Object.entries(result.directConversations)) {
        for (const conversation of conversations) byThread.set(conversation.threadId, botId);
      }
      this.cache = {
        bots: result.bots
          .filter((bot) => !bot.retired)
          .map((bot) => ({
            id: bot.id,
            name: bot.name,
            handle: bot.handle,
            avatar: bot.avatar,
            description: bot.description,
            working: bot.working,
            model: bot.model,
            reasoningLevel: bot.reasoningLevel,
          })),
        byThread,
        at: Date.now(),
      };
      this.failure = null;
      return this.cache;
    } catch (error) {
      const reason = /not found|not installed|disabled|404/i.test(message(error))
        ? "Studio Teams isn't installed or enabled."
        : `Studio Teams is unavailable: ${message(error)}`;
      this.failure = { reason, at: Date.now() };
      throw new Error(reason);
    }
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
