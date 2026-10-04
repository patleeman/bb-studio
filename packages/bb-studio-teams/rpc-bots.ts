import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { rpcContract } from "./contract";
import type { Runtime } from "./mission-runtime";
import { document, saveDocument, type Store } from "./store";
import type { ThreadProfiles } from "./thread-profiles";

type BotMethod = "documentHistory" | "get" | "document" | "saveDocument" | "wake" | "conversation" | "newConversation";

export function botHandlers(
  store: Store,
  runtime: Pick<Runtime, "locked" | "data" | "changed" | "wake">,
  profiles: ThreadProfiles,
): Pick<PluginRpcHandlers<typeof rpcContract>, BotMethod> {
  return {
    documentHistory: async ({ id, file, before }) => {
      const latest = await document(store.get(id).home, file);
      runtime.data.snapshot(`${id}:${file}`, latest.text, "Observed file");
      return runtime.data.revisions(`${id}:${file}`, before);
    },
    get: ({ id }) => ({
      bot: store.get(id),
      conversations: store.conversations(id),
      jobs: store.jobs(id, 50),
    }),
    document: async ({ id, file }) => {
      const value = await document(store.get(id).home, file);
      runtime.data.snapshot(`${id}:${file}`, value.text, "Observed file");
      return value;
    },
    saveDocument: ({ id, file, text, version }) =>
      runtime.locked(id, async () => {
        const previous = await document(store.get(id).home, file);
        runtime.data.snapshot(`${id}:${file}`, previous.text, "Previous version");
        const result = await saveDocument(store.get(id).home, file, text, version);
        runtime.data.snapshot(`${id}:${file}`, result.text, "You");
        runtime.changed("bots", id);
        return result;
      }),
    wake: ({ id }) =>
      runtime.locked(id, async () => ({ queued: runtime.wake(store.get(id)) })),
    conversation: ({ id }) =>
      runtime.locked(id, () => profiles.latestThread(store.get(id))),
    newConversation: ({ id }) =>
      runtime.locked(id, () => profiles.newThread(store.get(id))),
  };
}
