import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { Store } from "../modules/teams/store";
import type { ThreadProfiles } from "../modules/teams/thread-profiles";
import type { ThreadViews } from "../modules/teams/thread-views";
import { missingThread } from "../modules/teams/mission-runtime";
import { OfficeConversations, type ConversationRecord } from "./conversations";
import { officeTeamServiceContract } from "./team-service-contract";

export function officeTeamHandlers(bb: BbPluginApi, store: Store, profiles: ThreadProfiles, views: ThreadViews): PluginRpcHandlers<typeof officeTeamServiceContract> {
  const conversations = new OfficeConversations(store.db);
  const find = (botId: string, projectId: string) => conversations.list().filter(c => !c.archived && c.projectId === projectId && c.members.filter(m => m.kind === "bot").length === 1 && c.members.some(m => m.kind === "bot" && m.id === botId)).sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
  const directThread = async (conversation: ConversationRecord, botId: string) => {
    const rows = store.db.prepare("SELECT thread_id FROM conversation_threads WHERE conversation_id=? AND bot_id=? ORDER BY rowid").all(conversation.id, botId) as { thread_id: string }[];
    for (const row of rows) {
      if (store.byThread(row.thread_id)?.botId !== botId) continue;
      try {
        const thread = await bb.sdk.threads.get({ threadId: row.thread_id });
        if (thread.archivedAt === null && thread.deletedAt === null && thread.projectId === conversation.projectId) return thread.id;
      } catch (error) { if (!missingThread(error)) throw error; }
    }
    return null;
  };
  return {
    office_dm: ({ botId }) => views.locked(`office-dm:${botId}`, async () => {
      const bot = store.get(botId);
      if (bot.retired) throw new Error("Restore this bot before messaging it.");
      const conversation = conversations.dm(bot.id, bot.projectId, bot.name);
      let threadId = await directThread(conversation, bot.id);
      if (!threadId) {
        const thread = await profiles.newThread(bot);
        threadId = thread.threadId;
        conversations.attachThread(conversation.id, threadId, bot.id);
      }
      views.changed();
      return { conversationId: conversation.id, threadId };
    }),
    office_direct: async ({ botId }) => {
      const bot = store.get(botId), conversation = find(bot.id, bot.projectId);
      return { conversationId: conversation?.id ?? null, threadId: conversation ? await directThread(conversation, bot.id) : null };
    },
    office_talk: async () => {
      const rows = [];
      for (const conversation of conversations.list().filter(c => !c.archived)) {
        const threads = await views.threads(conversation);
        const ids = new Set(threads.map(t => t.id));
        let unread = false;
        for (let offset = 0; ; offset += 200) {
          const listed = await bb.sdk.threads.list({ projectId: conversation.projectId, includeHidden: true, archived: false, limit: 200, offset });
          unread ||= listed.some(t => ids.has(t.id) && t.latestAttentionAt > (t.lastReadAt ?? 0));
          if (listed.length < 200) break;
        }
        const memberBotIds = conversation.members.filter(m => m.kind === "bot").map(m => m.id);
        rows.push({ id: conversation.id, title: conversation.name, projectId: conversation.projectId, memberBotIds,
          isDirect: memberBotIds.length === 1, needsYou: threads.some(t => t.hasPendingInteraction), unread,
          href: `/plugins/studio/office/talk/${conversation.id}` });
      }
      return { conversations: rows };
    },
  };
}
