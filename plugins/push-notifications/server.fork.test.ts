import type { PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createPushNotificationsPlugin } from "./server.js";
import type { ExpoPushMessage, PushSenderFetch } from "./sender.js";

type ThreadResponse = PluginThreadEventPayloads["thread.idle"]["thread"];

const EXPO_URL = "http://expo.test/push";

function createFakeExpo() {
  const requests: ExpoPushMessage[][] = [];
  const fetch: PushSenderFetch = async (_url, init) => {
    const messages = JSON.parse(init.body) as ExpoPushMessage[];
    requests.push(messages);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: messages.map((message) => ({
            status: "ok",
            id: `ticket-${message.to}`,
          })),
        }),
    };
  };
  return { fetch, requests };
}

async function setup() {
  const expo = createFakeExpo();
  const threads = new Map<string, ThreadResponse>();
  const fake = createFakePluginHost({
    pluginId: "push-notifications",
    settings: { expoPushUrl: EXPO_URL },
    sdk: {
      threads: {
        get: async ({ threadId }) => {
          const thread = threads.get(threadId);
          if (!thread) throw new Error("Thread not found");
          return thread;
        },
        experimental_listAncestors: async ({ threadIds }) => ({
          threads: threadIds.map((threadId) => ({ threadId, ancestorIds: [] })),
        }),
        experimental_listPluginMetadata: async () => ({ threads: [] }),
        interactions: { list: async () => [] },
      },
    },
  });
  let nextId = 1;
  await createPushNotificationsPlugin({
    coalesceMs: 10,
    createId: () => `subscription-${nextId++}`,
    fetch: expo.fetch,
  })(fake.bb);
  const service = fake.harness.behavior.runService("push-sender");

  return {
    ...fake,
    expo,
    async addSubscription() {
      await fake.harness.behavior.callRpc("pushSubscriptions.add", {
        expoPushToken: "ExponentPushToken[phone]",
        platform: "ios",
        deviceLabel: "Phone",
      });
    },
    setThread() {
      const thread = makeThreadResponse({
        id: `thread-${threads.size + 1}`,
        projectId: "project-1",
        status: "idle",
        title: "Fix the flaky test",
        latestAttentionAt: 100,
      });
      threads.set(thread.id, thread);
      return thread;
    },
    async cleanup() {
      service.controller.abort();
      await service.done;
      await fake.harness.lifecycle.dispose();
    },
  };
}

describe("push sender (fork)", () => {
  it("sends nothing for a quiet turn", async () => {
    const host = await setup();
    try {
      await host.addSubscription();
      const thread = host.setThread();
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread,
        lastAssistantText: "[PASS]",
        experimental_quiet: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(host.expo.requests).toEqual([]);
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread,
        lastAssistantText: "Done.",
      });
      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(1));
      expect(JSON.stringify(host.expo.requests)).toContain("Done.");
      expect(JSON.stringify(host.expo.requests)).not.toContain("[PASS]");
    } finally {
      await host.cleanup();
    }
  });
});
