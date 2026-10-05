import { describe, expect, it } from "vitest";
import { spaceOfProject, type MoveSpace } from "./move-to";

const space = (id: string, projectIds: string[], isDefault = false): MoveSpace => ({ id, name: id, color: "red", icon: null, isDefault, projectIds });

describe("spaceOfProject", () => {
  const spaces = [space("work", ["proj_app"]), space("personal", ["proj_personal"], true)];

  it("finds the Space that lists the project", () => {
    expect(spaceOfProject(spaces, "proj_app")?.id).toBe("work");
  });

  it("puts Global and unlisted projects in the default Space", () => {
    expect(spaceOfProject(spaces, null)?.id).toBe("personal");
    expect(spaceOfProject(spaces, "proj_new")?.id).toBe("personal");
  });

  it("falls back to the first Space when none is marked default", () => {
    expect(spaceOfProject([space("a", []), space("b", [])], null)?.id).toBe("a");
  });
});
