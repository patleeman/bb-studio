import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "../testing/fixtures.js";
import { currentSpaceIdOf } from "./MoveToSpace.js";
import type { StudioSpace } from "./space-groups.js";

const spaces: StudioSpace[] = [
  { id: "sp_work", name: "Work", color: "#00f", icon: null, defaultProjectId: null, isDefault: false, projectIds: ["proj_work"] },
  { id: "sp_home", name: "Home", color: "#f00", icon: null, defaultProjectId: null, isDefault: true, projectIds: [] },
];

describe("currentSpaceIdOf", () => {
  it("checks the Space By space shows the thread in, not only its own membership", () => {
    const member = makeSidebarThread({ id: "thr_member", projectId: "proj_work" });
    const viaProject = makeSidebarThread({ id: "thr_project", projectId: "proj_work" });
    const loose = makeSidebarThread({ id: "thr_loose", projectId: "proj_other" });
    const spaceOf = { thr_member: "sp_home" };
    expect(currentSpaceIdOf(member, spaces, spaceOf)).toBe("sp_home");
    expect(currentSpaceIdOf(viaProject, spaces, spaceOf)).toBe("sp_work");
    expect(currentSpaceIdOf(loose, spaces, spaceOf)).toBe("sp_home");
  });
});
