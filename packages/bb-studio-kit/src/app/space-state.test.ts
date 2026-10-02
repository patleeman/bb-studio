import { describe, expect, it } from "vitest";
import { spaceMembership } from "./space-state";

const space = { id: "sp_dev", projectIds: ["p_bb"] };

describe("spaceMembership", () => {
  it("is checked when every item is in the space, mixed when some are", () => {
    expect(spaceMembership(space, [{ projectId: null, spaces: ["sp_dev"] }])).toEqual({ has: true, through: [] });
    expect(spaceMembership(space, [{ projectId: null, spaces: ["sp_dev"] }, { projectId: null }])).toEqual({ has: "mixed", through: [] });
    expect(spaceMembership(space, [{ projectId: "p_other", spaces: [] }])).toEqual({ has: false, through: [] });
  });

  it("locks the space when every item is in it through a project", () => {
    expect(spaceMembership(space, [{ projectId: "p_bb", spaces: ["sp_dev"] }])).toEqual({ has: true, through: ["p_bb"] });
    // One item that isn't can still be added directly.
    expect(spaceMembership(space, [{ projectId: "p_bb", spaces: ["sp_dev"] }, { projectId: null }]).through).toEqual([]);
  });
});
