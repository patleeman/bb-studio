import { expect, it } from "vitest";
import { element, scene } from "../test/db";
import { drawHost } from "../test/host";

const row = (id: string, extra: object = {}) => ({
  id, name: "Plan", data: scene([element("rectangle", { id: "box" })]), createdAt: 1, updatedAt: 2,
  projectId: "proj_a", updatedBy: "agent", archivedAt: null, template: false, recoveryKeys: [], ...extra,
});

it("imports the bridge's drawings with their ids and times, once, and skips scenes that aren't drawings", async () => {
  const host = drawHost();
  const call = (method: string, input: unknown): Promise<any> => host.harness.behavior.callRpc(method, input);
  try {
    const first = await call("drawings.importRows", { drawings: [row("drw_0000000000000001", { template: true, archivedAt: 3 }), row("drw_0000000000000002", { data: "not json" })] });
    expect(first).toEqual({ imported: ["drw_0000000000000001"], existing: [], skipped: [{ id: "drw_0000000000000002", reason: expect.stringContaining("isn't a drawing") }] });
    expect(host.drawings.store.get("drw_0000000000000001")).toMatchObject({ name: "Plan", created_at: 1, updated_at: 2, project_id: "proj_a", archived_at: 3, template: 1 });
    // A rerun leaves what Studio has alone, even if the old copy says otherwise.
    const again = await call("drawings.importRows", { drawings: [row("drw_0000000000000001", { name: "Renamed" })] });
    expect(again).toMatchObject({ imported: [], existing: ["drw_0000000000000001"] });
    expect(host.drawings.store.get("drw_0000000000000001")!.name).toBe("Plan");
    expect((await call("drawings.mentionContext", { id: "drw_0000000000000001" })).context).toContain("/plugins/studio/studio/drawings/drw_0000000000000001");
    expect((await call("drawings.thumbnail", { id: "drw_0000000000000001" })).svg).toContain("<svg");
  } finally { await host.harness.lifecycle.dispose(); }
});

it("keeps an imported drawing's recovery keys, so a retried draft doesn't copy it again", async () => {
  const host = drawHost();
  const call = (method: string, input: unknown): Promise<any> => host.harness.behavior.callRpc(method, input);
  try {
    const key = JSON.stringify(["drw_source", "editor", "token"]);
    await call("drawings.importRows", { drawings: [row("drw_0000000000000003", { recoveryKeys: [key] })] });
    const { drawing } = await call("drawings.recoverDrawingCopy", { sourceDrawingId: "drw_source", draftId: "editor", draftToken: "token", name: "Again", data: scene([]) });
    expect(drawing.id).toBe("drw_0000000000000003");
  } finally { await host.harness.lifecycle.dispose(); }
});

it("answers `bb studio drawings`, and lists its commands", async () => {
  const host = drawHost();
  try {
    expect((await host.drawings.cli(["create", "Roadmap"], {})).stdout).toMatch(/^drw_[0-9a-f]{16}\tRoadmap\n$/);
    expect((await host.drawings.cli(["list"], {})).stdout).toContain("Roadmap");
    expect((await host.drawings.cli([], {})).stderr).toContain("usage: bb studio drawings");
  } finally { await host.harness.lifecycle.dispose(); }
});
