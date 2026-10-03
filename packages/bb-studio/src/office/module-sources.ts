import { z } from "zod";
import type { ModuleServices } from "../modules/services";
import type { InboxSource, SourceEvent } from "./inbox";

const feedPage = z.object({ posts: z.array(z.object({
  id: z.string(), story: z.string().nullable(), projectId: z.string().nullable(), title: z.string(), body: z.string(),
  botId: z.string().nullable(), threadId: z.string().nullable(), updatedAt: z.number(), resolvedAt: z.number().nullable(),
  priority: z.string(),
})), nextCursor: z.string().nullable() });
export const taskList = z.object({ tasks: z.array(z.object({
  id: z.string(), title: z.string(), description: z.string(), status: z.string(), statusLabel: z.string(), projectId: z.string().nullable(),
  assignee: z.string().nullable(), archived: z.boolean(), updatedAt: z.number(), recurrence: z.string().nullable(),
  handoff: z.object({ threadId: z.string(), state: z.string(), note: z.string().nullable() }).nullable(),
})) });
const roster = z.object({ bots: z.array(z.object({ id: z.string(), projectId: z.string().nullable() })), botCreateRequests: z.array(z.object({
  id: z.string(), requesterBotId: z.string(), name: z.string(), description: z.string(), mission: z.string(), createdAt: z.number(), expiresAt: z.number(),
})) });
const base = (key: string, projectId: string | null, source: string): SourceEvent => ({
  key, projectId, source, type: "report", title: "", body: "", botId: null, threadId: null, item: null, href: null, actions: null, createdAt: 0,
});

/** Modules register later in startup; check the registry on every read. */
export function moduleInboxSources(services: ModuleServices): InboxSource[] {
  return [{
    id: "feed", keyPrefix: "feed:",
    async list() {
      if (!services.has("feed")) return [];
      const events = new Map<string, SourceEvent>();
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = feedPage.parse(await services.call("feed", "list", { limit: 100, ...(cursor ? { cursor } : {}) }));
        for (const post of page.posts) {
          if (post.resolvedAt !== null) continue;
          const key = post.story ? `feed:story:${encodeURIComponent(post.story)}` : `feed:post:${post.id}`;
          const event: SourceEvent = { ...base(key, post.projectId, "feed"), title: post.title, body: post.body,
            botId: post.botId, threadId: post.threadId, href: `/plugins/studio/feed/${post.id}`, createdAt: post.updatedAt,
            urgent: post.priority === "urgent" };
          if (!events.has(key) || events.get(key)!.createdAt < event.createdAt) events.set(key, event);
        }
        cursor = page.nextCursor ?? undefined;
        if (cursor && seen.has(cursor)) throw new Error("Feed returned a repeated cursor.");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return [...events.values()];
    },
    async act() { throw new Error("Reports have no source action. Mark the report done instead."); },
  }, {
    id: "task-review", keyPrefix: "task-review:",
    async list() {
      if (!services.has("studio-tasks")) return [];
      const { tasks } = taskList.parse(await services.call("studio-tasks", "board", {}));
      return tasks.filter(t => !t.archived && (t.status === "review" || /\breview\b/i.test(t.statusLabel))).map(t => ({
        ...base(`task-review:${t.id}`, t.projectId, "task-review"), type: "request" as const, title: t.title,
        body: t.handoff?.note ?? t.description, botId: t.assignee?.startsWith("bot:") ? t.assignee.slice(4) : null,
        threadId: t.handoff?.threadId ?? null, href: `/plugins/studio/tasks/${t.id}`,
        item: { ref: `studio:${t.id}`, title: t.title, href: `/plugins/studio/tasks/${t.id}` },
        createdAt: t.updatedAt, actions: [{ id: "accept", label: "Accept", primary: true }],
      }));
    },
    async act(event, actionId) {
      if (actionId !== "accept") throw new Error("Unsupported review action.");
      await services.call("studio-tasks", "update", { id: event.key.slice("task-review:".length), status: "done" });
    },
  }, {
    id: "bot-create", keyPrefix: "bot-create:",
    async list() {
      if (!services.has("bot-teams")) return [];
      const { bots, botCreateRequests } = roster.parse(await services.call("bot-teams", "list", null));
      return botCreateRequests.filter(r => r.expiresAt > Date.now()).map(r => ({
        ...base(`bot-create:${r.id}`, bots.find(b => b.id === r.requesterBotId)?.projectId ?? null, "bot-create"),
        type: "request" as const, title: `Create ${r.name}`, body: r.description || r.mission, botId: r.requesterBotId,
        createdAt: r.createdAt, actions: [{ id: "approve", label: "Approve", primary: true }, { id: "deny", label: "Deny" }],
      }));
    },
    async act(event, actionId) {
      if (!["approve", "deny"].includes(actionId)) throw new Error("Unsupported bot creation action.");
      await services.call("bot-teams", "resolveBotCreateRequest", { id: event.key.slice("bot-create:".length), approved: actionId === "approve" });
    },
  }];
}
