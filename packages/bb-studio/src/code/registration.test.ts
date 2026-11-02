import { afterEach, expect, test } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { registerCode } from "./server";
import { registerCodeApp } from "./register";
import { MIGRATIONS } from "./server/store";
import { codeContract } from "../kit/code-contract";
import { rpcContract } from "./contract";
import { builtinItemAt, canonicalPath } from "../builtins";
import { parseStudioMentionReference, parseStudioItemHref, studioTextReferences } from "../kit/contract";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((dispose) => dispose())); });

test("Studio owns all six code tools and every prefixed RPC", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
  cleanup.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database(); bb.storage.migrate(db, MIGRATIONS);
  const code = registerCode(bb, db);
  const workspace = code.store.create({ title: "Repo", folders: ["/repo"], projectId: null });
  expect(await code.provider.studio_get({ ids: [workspace.id] })).toMatchObject({ items: [{ id: workspace.id, href: `/plugins/studio/studio/workspaces/${workspace.id}` }] });
  expect(harness.registrations.agentTools.map((tool) => tool.name).sort()).toEqual(["code_comment_reply", "code_comments", "code_edit", "code_editor_state", "code_show", "code_workspace_open"]);
  expect(Object.keys(rpcContract)).toEqual(Object.keys(codeContract).map((method) => `code.${method}`));
  expect(await harness.behavior.callRpc("code.get", { id: "missing" })).toMatchObject({ workspace: null });
});

test("keeps the + menu action and file opener ids, and registers no header button", async () => {
  const app = await loadPluginApp(async () => ({ default: definePluginApp(registerCodeApp) }));
  expect(app.threadPanelActions.map((action) => action.id)).toEqual(["code"]);
  expect(app.fileOpeners.map((opener) => opener.id)).toEqual(["vscode"]);
  expect(app.threadHeaderActions).toEqual([]);
});

test("old addresses, item ids and mentions resolve to the same workspace in Studio", () => {
  const path = "/plugins/studio-code/workspaces/cws_123";
  const canonical = "/plugins/studio/studio/workspaces/cws_123";
  const ref = { pluginId: "studio-code", id: "cws_123" };
  expect(canonicalPath(path + "?x=1#y")).toBe(canonical + "?x=1#y");
  expect(builtinItemAt(path)).toMatchObject({ ...ref, href: canonical });
  expect(parseStudioItemHref(path)).toEqual(ref);
  expect(parseStudioItemHref(canonical)).toEqual(ref);
  expect(studioTextReferences("item:studio-code:cws_123")).toEqual([{ ref, kind: "mention" }]);
  expect(parseStudioMentionReference("studio-code", "workspace:cws_123")).toEqual(ref);
  expect(parseStudioMentionReference("studio", "workspace:cws_123")).toEqual(ref);
});
