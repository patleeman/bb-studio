import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { registerCode } from "./server";
import { MIGRATIONS } from "./server/store";
import { CommentStore } from "./server/comments";

const bridge = vi.hoisted(() => ({ connected: true, send: vi.fn(() => true), request: vi.fn(async () => ({ ok: true, detail: "Edited" })) }));
vi.mock("./server/runtime", () => ({ CodeServers: class { dispose() {} } }));
vi.mock("./server/migration", () => ({ registerCodeImport: () => ({ requireReady: async () => {} }) }));
vi.mock("./server/bridge", async (original) => ({ ...(await original<typeof import("./server/bridge")>()), Bridges: class {
  connected() { return bridge.connected; }
  state() { return { focused: true, activeFile: null, openFiles: [], unsavedFiles: [] }; }
  send = bridge.send;
  request = bridge.request;
  unsaved() { return []; }
  broadcast() {}
  closeAll() {}
} }));
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((fn) => fn())); vi.clearAllMocks(); bridge.connected = true; });

async function setup(owner: string, share: boolean, related = false) {
  const dir = await mkdtemp(join(tmpdir(), "code-scope-"));
  const mine = join(dir, "mine"), other = related ? dir : join(dir, "other");
  await mkdir(mine); if (!related) await mkdir(other);
  const file = join(owner === "caller" ? mine : other, "a.ts");
  await writeFile(file, "before");
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: { get: async () => ({ title: "Caller", environment: { path: mine, hostId: "local" } }) },
    system: { config: async () => ({ primaryHostId: "local" }) },
  } });
  cleanup.push(async () => { await harness.lifecycle.dispose(); await rm(dir, { recursive: true, force: true }); });
  const db = bb.storage.database(); bb.storage.migrate(db, MIGRATIONS);
  const { store } = registerCode(bb, db);
  const workspace = store.create({ title: "Target editor", threadId: owner, projectId: null, folders: [owner === "caller" ? mine : other] });
  store.update(workspace.id, { share });
  const comments = new CommentStore(db);
  const commentId = comments.add(workspace.id, { path: file, startLine: 1, endLine: 1, lineText: "before", body: "Target comment" });
  comments.markSent(workspace.id, "caller", comments.pending(workspace.id));
  const tool = (name: string, input: unknown = {}) => harness.behavior.callAgentTool(name, input, { threadId: "caller" });
  return { tool, workspace, file, comments, commentId, store };
}

it.each([
  { owner: "caller", share: false, allowed: true },
  { owner: "other", share: false, allowed: false },
  { owner: "other", share: true, allowed: true },
  { owner: "other", share: false, allowed: true, related: true },
])("scopes all editor and comment tools: %j", async ({ owner, share, allowed, related }) => {
  const { tool, workspace, file, comments, commentId } = await setup(owner, share, related);
  const state = await tool("code_editor_state");
  expect(String(state).includes("Target editor")).toBe(allowed);
  await tool("code_show", { path: file });
  await tool("code_edit", { path: file, edits: [{ oldText: "before", newText: "after" }] });
  expect(bridge.send.mock.calls.length).toBe(allowed ? 1 : 0);
  expect(bridge.request.mock.calls.length).toBe(allowed ? 1 : 0);
  if (allowed) {
    expect(bridge.send).toHaveBeenCalledWith(workspace.id, expect.anything());
    expect(bridge.request).toHaveBeenCalledWith(workspace.id, expect.anything(), expect.any(Number));
  }
  expect(String(await tool("code_comments")).includes("Target comment")).toBe(allowed);
  const reply = tool("code_comment_reply", { id: commentId, body: "Response", resolve: true });
  if (allowed) await reply;
  else await expect(reply).rejects.toThrow(/workspace|sharing/i);
  expect(comments.thread(commentId)!.comments).toHaveLength(allowed ? 2 : 1);
});

it("workspace_open always targets the caller's own thread", async () => {
  const { tool, store, workspace } = await setup("other", false);
  await tool("code_workspace_open");
  expect(store.forThread("caller")?.threadId).toBe("caller");
  expect(store.get(workspace.id)?.threadId).toBe("other");
});


it("does not fall back to an unrelated private workspace on disk", async () => {
  const { tool, file } = await setup("other", false);
  bridge.connected = false;
  await tool("code_edit", { path: file, edits: [{ oldText: "before", newText: "after" }] });
  expect(await readFile(file, "utf8")).toBe("before");
  expect(bridge.request).not.toHaveBeenCalled();
});

it("prefers the caller's own workspace over a shared editor holding the same file", async () => {
  const { tool, workspace, store, file } = await setup("caller", false);
  store.create({ title: "Shared", folders: workspace.folders, threadId: "other", projectId: null });
  await tool("code_show", { path: file });
  expect(bridge.send).toHaveBeenCalledWith(workspace.id, expect.anything());
});
