import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { expect, it } from "vitest";
import plugin from "../../server";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, TaskStore } from "./store";

it("tracks a finding once across concurrent calls and retries, with Studio optional", async () => {
  const inherited: unknown[] = [];
  let studioAvailable = true;
  const host = createFakePluginHost({ pluginId: "studio-tasks", sdk: {
    threads: { get: async ({ threadId }) => makeThreadResponse({ id: threadId, projectId: "proj_source", title: "Retry design" }) },
    plugins: { callRpc: async ({ method, input }) => { if (!studioAvailable) throw new Error("Studio unavailable"); if (method === "linkItemThread") inherited.push(input); return { ok: true } as never; } },
  } });
  await plugin(host.bb);
  const input = { key: "explore:one", threadId: "thr_source", messageId: "msg_source", title: "Retry delay is wrong", pageId: "pg_explainer" };
  const track = (create: boolean) => host.harness.behavior.callRpc("trackFinding", { ...input, create }) as Promise<{ task: { id: string; projectId: string; description: string; status: string } | null }>;
  try {
    expect(await track(false)).toEqual({ task: null });
    const results = await Promise.all(Array.from({ length: 12 }, () => track(true)));
    const task = results[0]!.task!;
    expect(new Set(results.map(result => result.task?.id)).size).toBe(1);
    expect(task).toMatchObject({ projectId: "proj_source", status: "todo" });
    expect(task.description).toContain("/threads/thr_source");
    expect(task.description).toContain("msg_source");
    expect(inherited).toContainEqual(expect.objectContaining({ thread: expect.objectContaining({ threadId: "thr_source", ref: { pluginId: "studio-tasks", id: task.id }, role: "created" }) }));
    const full = await host.harness.behavior.callRpc("get", { id: task.id }) as { links: { itemId: string }[]; handoffs: unknown[] };
    expect(full.links.map(link => link.itemId).sort()).toEqual(["pg_explainer", "thr_source"]);
    expect(full.handoffs).toEqual([]);
    studioAvailable = false;
    expect((await track(true)).task?.id).toBe(task.id);
    await host.harness.behavior.callRpc("delete", { id: task.id });
    expect((await track(true)).task?.id).not.toBe(task.id);
  } finally { await host.harness.lifecycle.dispose(); }
});

it("retains the source key and inheritance source after reopening the database", () => {
  const directory = mkdtempSync(join(tmpdir(), "studio-task-source-"));
  let db = new Database(join(directory, "tasks.sqlite"));
  try {
    for (const migration of MIGRATIONS) db.exec(migration);
    const first = new TaskStore(db).createFromSource("explore:restart", "thr_source", { title: "Finding", projectId: "proj_source", by: "user" });
    db.close();
    db = new Database(join(directory, "tasks.sqlite"));
    const reopened = new TaskStore(db);
    expect(reopened.createFromSource("explore:restart", "thr_source", { title: "Do not replace", by: "user" }).id).toBe(first.id);
    expect(reopened.sourceThreads()).toEqual([{ task_id: first.id, thread_id: "thr_source" }]);
    expect(reopened.list()).toHaveLength(1);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
