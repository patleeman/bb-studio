import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Store } from "./store";
import type { Conversations } from "./conversations";
import { isBroadcastHandle, matchingBroadcastMentions } from "./mentions";

export function registerViewMentions(bb: BbPluginApi, store: Store, views: Conversations) {
  bb.ui.registerMentionProvider({
    id: "broadcasts", label: "Channel mentions",
    search({ query }) {
      return matchingBroadcastMentions(query).map(({ handle }) => ({
        id: handle, title: `@${handle}`, subtitle: "Everyone in this channel", icon: "Users",
      }));
    },
    resolve(handle) {
      if (!isBroadcastHandle(handle)) throw new Error("Unknown channel mention.");
      return { context: `@${handle} addresses every member when sent from a Studio Teams channel.` };
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
      return { label: bot.name, context: `Persistent bot ${JSON.stringify(bot.name)} (@${bot.handle}): ${JSON.stringify(bot.description)}. Read its profile with bb studio bot-teams show ${bot.id}. Start an ordinary thread with its profile when the owner asks you to collaborate.` };
    },
  });
  bb.ui.registerMentionProvider({
    id: "views", label: "Channels",
    async search({ query }) { return views.all().filter(v => !v.archived && v.name.toLowerCase().includes(query.toLowerCase())).slice(0, 30).map(v => ({ id: v.id, title: v.name, icon: "MessageSquare" })); },
    async resolve(itemId) {
      const view = views.get(itemId);
      return { label: view.name, context: `Channel ${JSON.stringify(view.name)}: /plugins/studio/channels/${view.id}. Read it with bb studio bot-teams channel-read ${view.id}. This is a view of ordinary threads, not a shared agent session.` };
    },
  });
}
