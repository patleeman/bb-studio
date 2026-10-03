import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { expect, it } from "vitest";
import { officeInboxPoller } from "./office-inbox.js";

it("notifies requests and urgent reports, retrying only devices without acknowledgement", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "mobile", sdk: { plugins: {
    list: async () => ({ plugins: [{ id: "studio", enabled: true, status: "running" }] }) as never,
    callRpc: async ({ method }) => method === "inbox_counts" ? { bySpace: { s: { requests: 1, unreadReports: 2 } } } as never : {
      events: [
        { key: "request", type: "request", source: "task-review" },
        { key: "urgent", type: "report", source: "feed", urgent: true },
        { key: "quiet", type: "report", source: "feed" },
        { key: "interaction", type: "request", source: "bb-interaction" },
      ].map(e => ({ ...e, spaceId: "s", title: "Title", body: "Body", threadId: null, createdAt: 1 })), cursor: null,
    } as never,
  } } });
  const sent: string[][] = [];
  const deliver = async (messages: { to: string; data?: Record<string,unknown> }[]) => {
    sent.push(messages.map(m => `${m.data?.inboxKey}:${m.to}`));
    return messages.map(m => ({ status: sent.length <= 2 && m.to === "b" ? "error" as const : "ok" as const }));
  };
  await officeInboxPoller(bb, async () => ["a","b"], deliver)();
  // New poller simulates restart; successful device acknowledgements persisted.
  await officeInboxPoller(bb, async () => ["a","b"], deliver)();
  expect(sent).toEqual([["request:a","request:b"],["urgent:a","urgent:b"],["request:b"],["urgent:b"]]);
  await harness.lifecycle.dispose();
});
