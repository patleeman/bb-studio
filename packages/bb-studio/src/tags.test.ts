import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { TagStore, tagName } from "./tags";

function store() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return new TagStore(db);
}

const page = { pluginId: "pages", id: "pg_1" };
const drawing = { pluginId: "excalidraw", id: "d1" };

describe("tags", () => {
  it("cleans names", () => {
    expect(tagName("  #Launch   plan ")).toBe("Launch plan");
    expect(() => tagName(" # ")).toThrow();
    expect(() => tagName("x".repeat(41))).toThrow();
  });

  it("reuses a tag with the same name, ignoring case", () => {
    const tags = store();
    const launch = tags.ensure("Launch");
    expect(tags.ensure("launch").id).toBe(launch.id);
    expect(tags.ensure("Research").color).not.toBe(launch.color);
    expect(tags.list().map((tag) => tag.name)).toEqual(["Launch", "Research"]);
  });

  it("tags items across add-ons", () => {
    const tags = store();
    const launch = tags.ensure("Launch");
    const research = tags.ensure("Research");
    tags.apply([page, drawing], [launch.id, research.id, "tag_unknown"], []);
    tags.apply([drawing], [], [research.id]);
    const assigned = tags.assignments();
    expect(assigned.get("pages:pg_1")).toEqual([launch.id, research.id]);
    expect(assigned.get("excalidraw:d1")).toEqual([launch.id]);
  });

  it("renames without clashing", () => {
    const tags = store();
    const launch = tags.ensure("Launch");
    tags.ensure("Research");
    expect(tags.rename(launch.id, "Q4 launch").name).toBe("Q4 launch");
    expect(() => tags.rename(launch.id, "research")).toThrow(/already/);
  });

  it("forgets deleted tags and items", () => {
    const tags = store();
    const launch = tags.ensure("Launch");
    const research = tags.ensure("Research");
    tags.apply([page, drawing], [launch.id, research.id], []);
    tags.remove(research.id);
    tags.forget("pages", ["pg_1"]);
    tags.prune("excalidraw", new Set(["d2"]));
    expect(tags.assignments().size).toBe(0);
    expect(tags.list().map((tag) => tag.name)).toEqual(["Launch"]);
  });
});
