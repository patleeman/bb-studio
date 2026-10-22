import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackup, runRestore } from "../kit/server/index";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { expect, it, vi } from "vitest";
import { pageCheckboxes } from "../kit/page-checkbox";
import { MIGRATIONS } from "../migrations";
import { StudioServices } from "../services";
import { registerPages } from "./server";

it("links pages and checklist handoffs directly, and reports activity failures without losing edits", async () => {
  vi.useFakeTimers();
  const callRpc = vi.fn(async (_args: { method: string }) => { throw new Error("bridge unavailable"); });
  const host = createFakePluginHost({ pluginId: "studio", sdk: { plugins: { callRpc },
    threads: { spawn: async () => ({ id: "thr_checklist" }) }, system: { config: async () => ({ primaryHostId: "host_1" }) },
  } });
  const db = host.bb.storage.database();
  for (const sql of MIGRATIONS) db.exec(sql);
  const services = new StudioServices(db);
  const pages = registerPages(host.bb, db, { snapshotsPerPage: () => 10 }, services, async () => {}, {
    items: async () => [], create: async () => { throw new Error("not in this test"); },
    drawing: () => null, saveDrawing: () => { throw new Error("not in this test"); },
    artifact: () => null, artifactText: () => ({ text: null, truncated: false }), recording: () => null,
  });
  try {
    const notesId = await pages.notes.create({ projectId: null, title: "Meeting notes", markdown: "First version" });
    expect(await pages.notes.exists(notesId)).toBe(true);
    expect(await pages.notes.exists("pg_missing")).toBe(false);
    await pages.notes.replace(notesId, "New notes with token-notes");
    expect(await pages.notes.markdown(notesId)).toContain("New notes with token-notes");
    await expect(pages.notes.replace("pg_missing", "x")).rejects.toThrow("Page not found");
    const linkedId = pages.createPage({ projectId: null, title: "Created link", markdown: "@[Other](item:artifacts:art_other)" });
    expect(services.links({ pluginId: "pages", id: linkedId }).outgoing).toMatchObject([{ to: { id: "art_other" } }]);
    const dir = mkdtempSync(join(tmpdir(), "pages-links-"));
    try {
      await runBackup(join(dir, "section"), pages.backup);
      await pages.provider.studio_delete({ ids: [linkedId] });
      expect(services.links({ pluginId: "pages", id: linkedId }).outgoing).toEqual([]);
      await runRestore(join(dir, "section"), pages.backup, { dryRun: false, version: 1, projects: {} });
      expect(services.links({ pluginId: "pages", id: linkedId }).outgoing).toMatchObject([{ to: { id: "art_other" } }]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const parent = pages.createPage({ projectId: "proj_a", title: "Parent", markdown: "" });
    const childResult = await host.harness.behavior.callRpc("pages.create", { projectId: "proj_a", parentId: parent, title: "Child" }) as { page: { id: string } };
    const child = childResult.page.id;
    await host.harness.behavior.callRpc("pages.update", { id: child, projectId: "proj_b" });
    expect(pages.store.meta(child)).toMatchObject({ project_id: "proj_b", parent_id: null });
    await pages.provider.studio_move({ ids: [child], projectId: "proj_a" });
    expect(pages.store.meta(child)?.project_id).toBe("proj_a");
    const id = pages.createPage({ projectId: "proj_1", title: "Plan", markdown: "- [ ] Ship it" });
    await host.harness.behavior.callAgentTool("pages_edit", { page: id, ops: [{ op: "append", markdown: "@[Other](item:artifacts:art_other)" }] }, { threadId: "thr_editor" });
    expect(services.threadsForThread("thr_editor")).toMatchObject([{ ref: { pluginId: "pages", id }, role: "edited" }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(services.links({ pluginId: "pages", id }).outgoing).toMatchObject([{ to: { pluginId: "artifacts", id: "art_other" } }]);
    vi.spyOn(services, "recordActivity").mockImplementation(() => { throw new Error("activity unavailable"); });
    await host.harness.behavior.callAgentTool("pages_edit", { page: id, ops: [{ op: "append", markdown: "Kept edit" }] }, { threadId: "thr_editor" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(pages.markdown(id)).toContain("Kept edit");
    expect(host.harness.logEntries.some((entry) => entry.message.includes("activity unavailable"))).toBe(true);
    const { markdown } = await host.harness.behavior.callRpc("pages.editableMarkdown", { id }) as { markdown: string };
    const [item] = pageCheckboxes(markdown);
    await host.harness.behavior.callRpc("pages.checklistHandOff", { id, blockId: item!.blockId });
    expect(services.threadsForThread("thr_checklist")).toMatchObject([{ role: "checklist", ref: { id } }]);
    vi.spyOn(services, "replaceLinks").mockImplementationOnce(() => { throw new Error("links unavailable"); });
    await host.harness.behavior.callAgentTool("pages_edit", { page: id, ops: [{ op: "append", markdown: "@[Talk](item:talk:rec_other)" }] }, { threadId: "thr_editor" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(services.links({ pluginId: "pages", id }).outgoing.some((link) => link.to.id === "rec_other")).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(services.links({ pluginId: "pages", id }).outgoing.some((link) => link.to.id === "rec_other")).toBe(true);
    expect(callRpc).not.toHaveBeenCalled();
  } finally { pages.dispose(); await host.harness.lifecycle.dispose(); vi.useRealTimers(); }
});
