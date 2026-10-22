import { afterEach, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { registerCode } from "./server";
import { MIGRATIONS } from "./server/store";

const bridge = vi.hoisted(() => ({ call: null as null | ((id: string, input: unknown) => Promise<unknown>) }));
vi.mock("./server/runtime", () => ({ CodeServers: class { dispose() {} } }));
vi.mock("./server/bridge", async (original) => ({ ...(await original<typeof import("./server/bridge")>()), Bridges: class {
  constructor(_log: unknown, _connect: unknown, _key: unknown, call: typeof bridge.call) { bridge.call = call; }
  broadcast() {}
  closeAll() {}
} }));
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((fn) => fn())); });

it("keeps drafts added or edited during delivery pending and prevents duplicate submission", async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const delivering = new Promise<void>((resolve) => { entered = resolve; });
  const send = vi.fn(async () => { entered(); await gate; });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: { threads: { get: async () => ({ title: "Review" }), send } } });
  cleanup.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database(); bb.storage.migrate(db, MIGRATIONS);
  const { store } = registerCode(bb, db);
  const workspace = store.create({ title: "Repo", folders: ["/repo"], projectId: null, threadId: "thr_a" });
  store.setReviewThread(workspace.id, "thr_a");
  const call = (input: unknown) => bridge.call!(workspace.id, input);
  const add = (body: string) => call({ method: "add", path: "/repo/a.ts", startLine: 1, endLine: 1, lineText: "a", body });
  await add("first");
  const second = await add("before") as { threads: { comments: { id: string }[] }[] };
  const sending = call({ method: "submit" });
  await delivering;
  await add("new draft");
  await call({ method: "edit", commentId: second.threads[1]!.comments[0]!.id, body: "after" });
  const duplicate = expect(call({ method: "submit" })).rejects.toThrow("already being submitted");
  release();
  await duplicate;
  expect(await sending).toMatchObject({ sent: 2 });
  expect(send).toHaveBeenCalledTimes(1);
  expect(await call({ method: "list" })).toMatchObject({ threads: [
    { comments: [{ body: "first", pending: false }] },
    { comments: [{ body: "after", pending: true }] },
    { comments: [{ body: "new draft", pending: true }] },
  ] });
  expect(await call({ method: "submit" })).toMatchObject({ sent: 2 });
  expect(send).toHaveBeenCalledTimes(2);
});
