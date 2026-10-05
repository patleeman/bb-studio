import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Store } from "./store";
import type { Command } from "./command";
import { isBroadcastHandle, matchingBroadcastMentions, matchingSpaceThreads } from "./mentions";

export function registerMentionProviders(bb: BbPluginApi, store: Store, command: Command) {
  // Threads without a bot have no handle; their title is their name.
  bb.ui.registerMentionProvider({
    id: "space-threads", label: "This Space",
    async search({ query, threadId }) {
      // The Command composer starts no thread; a thread's own composer has one.
      if (threadId) return [];
      const space = await command.mentionable();
      if (!space) return [];
      return matchingSpaceThreads(space.threads, space.leadThreadId, botId => { try { return store.get(botId).name; } catch { return null; } }, query).slice(0, 30);
    },
    async resolve(threadId) {
      const thread = await bb.sdk.threads.get({ threadId });
      return { context: `BB thread ${JSON.stringify(thread.title || thread.titleFallback || "New thread")} (${thread.id}). Read it with bb thread log ${thread.id}.` };
    },
  });
  bb.ui.registerMentionProvider({
    id: "broadcasts", label: "Everyone",
    search({ query }) {
      return matchingBroadcastMentions(query).map(({ handle }) => ({
        id: handle, title: `@${handle}`, subtitle: "Every thread in this Command view", icon: "Users",
      }));
    },
    resolve(handle) {
      if (!isBroadcastHandle(handle)) throw new Error("Unknown mention.");
      return { context: `@${handle} addresses every thread when sent from a Space's Command view.` };
    },
  });
  bb.ui.registerMentionProvider({
    id: "bots", label: "Bots",
    async search({ query }) {
      const q = query.toLowerCase();
      return store.all().filter(b => !b.retired && `${b.name} ${b.handle}`.toLowerCase().includes(q)).slice(0, 30).map(b => ({ id: b.id, title: b.name, description: `@${b.handle} · ${b.description}`, icon: b.avatar || "Bot" }));
    },
    async resolve(itemId) {
      const bot = store.get(itemId);
      return { label: bot.name, context: `Persistent bot ${JSON.stringify(bot.name)} (@${bot.handle}): ${JSON.stringify(bot.description)}. Read its profile with bb bots show ${bot.id}. Start an ordinary thread with its profile when the owner asks you to collaborate.` };
    },
  });
}
