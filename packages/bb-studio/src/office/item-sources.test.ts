import { expect, it } from "vitest";
import { commentSource, pageRequestSource } from "./item-sources";

it("includes only comments addressed to the user", async () => {
  const item = { pluginId: "studio", id: "art_a", projectId: "work", title: "Draft", href: "/draft", archived: false };
  const source = commentSource({ overview: async () => ({ items: [item] }) } as never,
    { comments: () => [
      { id: "mine", actor: { kind: "user" }, parentId: null, resolvedAt: null, body: "Question", createdAt: 1 },
      { id: "reply", actor: { kind: "bot", id: "bot_a" }, parentId: "mine", resolvedAt: null, body: "Answer", createdAt: 2 },
      { id: "other", actor: { kind: "bot", id: "bot_a" }, parentId: null, resolvedAt: null, body: "Internal note", createdAt: 3 },
    ] } as never, { list: async () => null } as never);
  expect(await source.list()).toMatchObject([{ key: "comment:studio:art_a:reply", projectId: "work", type: "comment", body: "Answer" }]);
});

it("exposes failed page jobs as requests and completed jobs as reports", async () => {
  const source = pageRequestSource({ plugins: { callRpc: async () => ({ requests: [
    { id: "a", status: "working" },
    { id: "b", status: "failed", summary: "Refresh", error: "Offline", result: null, botId: "bot", threadId: "thread", updatedAt: 2 },
    { id: "c", status: "done", summary: "Refresh", error: null, result: "Updated", botId: "bot", threadId: "thread", updatedAt: 3 },
  ] }) } } as never, { overview: async () => ({ items: [{ pluginId: "pages", id: "page", projectId: null, title: "Page", href: "/page", archived: false }] }) } as never);
  const rows = await source.list();
  expect(rows.map(e => [e.key,e.type,e.body])).toEqual([["page-request:b","request","Offline"],["page-request:c","report","Updated"]]);
  expect(rows.every(e => e.actions === null)).toBe(true);
});
