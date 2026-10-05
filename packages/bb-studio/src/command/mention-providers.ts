import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Command } from "./command";
import { isBroadcastHandle, matchingBroadcastMentions, matchingSpaceThreads } from "./mentions";

export function registerMentionProviders(bb: BbPluginApi, command: Command) {
  // Threads without a bot have no handle; their title is their name.
  bb.ui.registerMentionProvider({
    id: "space-threads", label: "This Space",
    async search({ query, threadId }) {
      // The Command composer starts no thread; a thread's own composer has one.
      if (threadId) return [];
      const space = await command.mentionable();
      if (!space) return [];
      return matchingSpaceThreads(space.threads, space.leadThreadId, query).slice(0, 30);
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
        id: handle, title: `@${handle}`, subtitle: "Every thread in this Command view", icon: "MessageSquare",
      }));
    },
    resolve(handle) {
      if (!isBroadcastHandle(handle)) throw new Error("Unknown mention.");
      return { context: `@${handle} addresses every thread when sent from a Space's Command view.` };
    },
  });
}
