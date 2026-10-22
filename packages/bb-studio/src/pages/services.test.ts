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
  const pages = registerPages(host.bb, db, { snapshotsPerPage: () => 10 }, services);
  try {
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
    expect(callRpc.mock.calls.every(([args]) => args.method === "studio_changed")).toBe(true);
  } finally { pages.dispose(); await host.harness.lifecycle.dispose(); vi.useRealTimers(); }
});
