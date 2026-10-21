import { afterEach, expect, test, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { codeContract } from "@bb-studio/kit/code-contract";
import { bbThemeSchema, BB_THEME_VARIABLES } from "@bb-studio/kit/code-theme";
vi.mock("@bb-studio/kit/code-handover", () => ({ quiesceCode: vi.fn(async () => {}) }));
import { quiesceCode } from "@bb-studio/kit/code-handover";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((dispose) => dispose())); vi.mocked(quiesceCode).mockReset().mockResolvedValue(); });
function setup() {
  const order: string[] = [];
  let fail = false;
  const host = createFakePluginHost({ pluginId: "studio-code", sdk: { plugins: { callRpc: async (input) => {
    order.push(input.method);
    if (fail) { fail = false; throw new Error("Studio offline"); }
    if (input.method === "code.importRows") {
      const rows = input.input as { workspaces: { id: string }[]; comments: { id: string }[] };
      return { workspaces: rows.workspaces.map((row) => row.id), comments: rows.comments.map((row) => row.id) } as never;
    }
    if (input.method === "code.importFiles" || input.method === "code.finishImport") return { complete: true } as never;
    return responses[input.method.slice(5)] as never;
  } } } });
  plugin(host.bb); cleanup.push(() => host.harness.lifecycle.dispose());
  vi.mocked(quiesceCode).mockImplementation(async () => { order.push("quiesce"); });
  return { ...host, order, failNext: () => { fail = true; } };
}
const stopped = { state: "stopped", url: null, password: null, error: null };
const workspace = { id: "cws_test", title: "Repo", projectId: null, threadId: "thr_1", trusted: true, share: true, folders: ["/repo"], archived: false, createdAt: 1, updatedAt: 2 };
const theme = bbThemeSchema.parse({ mode: "dark", colors: Object.fromEntries(BB_THEME_VARIABLES.map((name) => [name, "#000000"])) });
const inputs: Record<string, unknown> = {
  get: { id: workspace.id }, update: { id: workspace.id, share: false }, open: { id: workspace.id }, stop: { id: workspace.id },
  threadWorkspace: { threadId: "thr_1" }, forThread: { threadId: "thr_1" }, listDir: { id: workspace.id, path: "/repo" },
  readFile: { id: workspace.id, path: "/repo/a.ts" }, reveal: { id: workspace.id, path: "a.ts", startLine: 2, endLine: 3 },
  threadChip: { threadId: "thr_1" }, viewedFrom: { id: workspace.id, threadId: "thr_1" }, editorState: { id: workspace.id }, syncTheme: theme,
};
const responses: Record<string, unknown> = {
  get: { workspace, status: stopped }, update: { workspace }, open: { status: stopped }, stop: { status: stopped },
  threadWorkspace: { workspace }, forThread: { workspace }, listDir: { entries: [] }, readFile: { text: "source", reason: null }, reveal: { shown: true },
  threadChip: { chip: null }, viewedFrom: { ok: true }, editorState: { state: null }, syncTheme: { changed: true },
};
test("forwards every old method and registers no tools or agent configuration", async () => {
  const { harness, order } = setup();
  for (const method of Object.keys(codeContract)) expect(await harness.behavior.callRpc(method, inputs[method])).toEqual(responses[method]);
  expect(order.slice(0, 3)).toEqual(["quiesce", "code.importFiles", "code.finishImport"]);
  expect(order.slice(3)).toEqual(Object.keys(codeContract).map((method) => `code.${method}`));
  expect(harness.registrations.agentTools).toEqual([]);
});
test("copies rows only after server exit and file acknowledgment, and retries without replaying acknowledged rows", async () => {
  const { bb, harness, order, failNext } = setup();
  const db = bb.storage.database();
  db.prepare("INSERT INTO code_workspaces (id,title,folders,created_at,updated_at) VALUES (?,?,?,?,?)").run("cws_keep", "Repo", '["/repo"]', 1, 2);
  db.prepare("INSERT INTO code_comments (id,workspace_id,path,start_line,end_line,line_text,author,body,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run("comment_keep", "cws_keep", "/repo/a.ts", 1, 2, "draft", "user", "Review", 3);
  await bb.storage.kv.set("theme", theme);
  failNext();
  expect(await harness.behavior.callRpc("migrationStatus", null)).toEqual({ complete: false });
  expect(order).toEqual(["quiesce", "code.importFiles"]);
  expect(await harness.behavior.runCli(["migrate"])).toMatchObject({ exitCode: 0, stdout: "Migration complete" });
  expect(order.slice(2)).toEqual(["quiesce", "code.importFiles", "code.importRows", "code.importRows", "code.finishImport"]);
  expect(await bb.storage.kv.get("migrated:code_comments:comment_keep")).toBe(true);
  expect(await bb.storage.kv.get("migrated:code_workspaces:cws_keep")).toBe(true);
  await harness.behavior.runCli(["migrate"]);
  expect(order).toHaveLength(7);
});
test("never copies or forwards while an old server remains alive", async () => {
  const { harness, order } = setup();
  vi.mocked(quiesceCode).mockRejectedValue(new Error("server still running"));
  await expect(harness.behavior.callRpc("open", { id: workspace.id })).rejects.toThrow("server still running");
  expect(order).toEqual([]);
});
test("does not acknowledge an invalid source row", async () => {
  const { bb, harness, order } = setup();
  bb.storage.database().prepare("INSERT INTO code_workspaces (id,title,folders,created_at,updated_at) VALUES (?,?,?,?,?)").run("bad", "Bad", 'null', 1, 2);
  expect(await harness.behavior.callRpc("migrationStatus", null)).toEqual({ complete: false });
  expect(await bb.storage.kv.get("studio:migrated")).toBeUndefined();
  expect(order).not.toContain("code.finishImport");
});

test("keeps the saved studio-code/code tab identity without reclaiming the file opener or header button", async () => {
  const { loadPluginApp } = await import("@get-bb/plugin-sdk/testing/app");
  const app = await loadPluginApp(() => import("../app"));
  expect(app.threadPanelActions.map((action) => action.id)).toEqual(["code"]);
  expect(app.fileOpeners).toEqual([]);
  expect(app.threadHeaderActions).toEqual([]);
});
