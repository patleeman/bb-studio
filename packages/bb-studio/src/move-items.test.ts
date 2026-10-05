import { describe, expect, it } from "vitest";
import { planMove } from "./move-items";
import type { Space } from "./spaces";

const space = (fields: Partial<Space>): Space => ({
  id: "spc_work",
  isDefault: false,
  name: "Work",
  color: "blue",
  icon: null,
  description: "",
  defaultProjectId: "proj_work_general",
  projectIds: ["proj_work_general", "proj_app"],
  threadIds: [],
  itemKeys: [],
  createdAt: 0,
  updatedAt: 0,
  ...fields,
});
const item = (id: string, projectId: string | null, pluginId = "pages") => ({ pluginId, id, title: id, projectId });

describe("planMove", () => {
  it("moves into a space only what isn't in it yet, grouped by plugin", () => {
    const plan = planMove(
      [item("a", "proj_app"), item("b", "proj_other"), item("c", null), item("d", "proj_other", "draw")],
      { projectId: "proj_work_general", space: space({}) },
      () => true,
    );
    expect(plan.unchanged.map((each) => each.id)).toEqual(["a"]);
    expect([...plan.byPlugin]).toEqual([["pages", ["b", "c"]], ["draw", ["d"]]]);
  });

  it("counts Global items as in the default space", () => {
    const plan = planMove([item("a", null)], { projectId: "proj_personal", space: space({ isDefault: true, projectIds: ["proj_personal"] }) }, () => true);
    expect(plan.unchanged).toHaveLength(1);
    expect(plan.byPlugin.size).toBe(0);
  });

  it("moves to a project by exact project, and refuses kinds that can't move", () => {
    const plan = planMove([item("a", "proj_app"), item("b", null), item("c", null, "talk")], { projectId: "proj_app" }, (each) => each.pluginId !== "talk");
    expect(plan.unchanged.map((each) => each.id)).toEqual(["a"]);
    expect(plan.refused.map((each) => each.id)).toEqual(["c"]);
    expect([...plan.byPlugin]).toEqual([["pages", ["b"]]]);
  });
});
