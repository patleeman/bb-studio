import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { Bot, Conversation, rpcContract } from "./contract";
import type { Runtime } from "./runtime";
import { document, saveDocument, type Store } from "./store";

type BotMethod = "documentHistory" | "history" | "get" | "document" | "saveDocument" | "wake" | "conversation" | "newConversation" | "handoffSource";

export function botHandlers(
  bb: BbPluginApi,
  store: Store,
  runtime: Runtime,
  ensureDirectConversation: (bot: Bot) => Promise<Conversation>,
  newDirectConversation: (bot: Bot) => Promise<Conversation>,
): Pick<PluginRpcHandlers<typeof rpcContract>, BotMethod> {
  return {
    documentHistory: async ({ id, file, before }) => {
      const latest = await document(store.get(id).home, file);
      runtime.data.snapshot(`${id}:${file}`, latest.text, "Observed file");
      return runtime.data.revisions(`${id}:${file}`, before);
    },
    history: ({ id, before, after, through, query, limit }) =>
      after
        ? store.historyAfter(id, after, through, limit)
        : store.history(id, before, query, limit),
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
      runtime.locked(id, () => ensureDirectConversation(store.get(id))),
    newConversation: ({ id }) =>
      runtime.locked(id, () => newDirectConversation(store.get(id))),
    handoffSource: async ({ threadId }) => {
      const thread = await bb.sdk.threads.get({ threadId });
      return {
        threadId: thread.id,
        projectId: thread.projectId,
        title: thread.title?.trim() || thread.titleFallback?.trim() || `Thread ${thread.id.slice(0, 8)}`,
      };
    },
  };
}
