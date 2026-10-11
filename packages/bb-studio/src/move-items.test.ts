import { describe, expect, it } from "vitest";
import { planMove } from "./move-items";

const item = (id: string, projectId: string | null, pluginId = "pages") => ({ pluginId, id, title: id, projectId });

describe("planMove", () => {
  it("moves to a project by exact project, grouped by plugin, and refuses kinds that can't move", () => {
    const plan = planMove([item("a", "proj_app"), item("b", null), item("c", null, "talk"), item("d", "proj_x", "draw")], { projectId: "proj_app" }, (each) => each.pluginId !== "talk");
    expect(plan.unchanged.map((each) => each.id)).toEqual(["a"]);
    expect(plan.refused.map((each) => each.id)).toEqual(["c"]);
    expect([...plan.byPlugin]).toEqual([["pages", ["b"]], ["draw", ["d"]]]);
  });
});
