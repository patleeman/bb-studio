import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Store } from "./store";
import { isBroadcastHandle, matchingBroadcastMentions } from "./mentions";

export function registerMentionProviders(bb: BbPluginApi, store: Store) {
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
