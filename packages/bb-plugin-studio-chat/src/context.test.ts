import { describe, expect, it } from "vitest";
import type { StudioItem, StudioKind } from "@bb-studio/kit/contract";
import type { NewThreadRequest } from "@get-bb/plugin-sdk";
import { itemKey, missingNote, parseItemKey, pointerNote, toViewed, withItemPill } from "./context";

const item: StudioItem & { pluginId: string } = {
  pluginId: "excalidraw",
  id: "drw_1",
  kind: "drawing",
  title: "Launch flow",
  icon: null,
  projectId: "proj_a",
  parentId: null,
  createdAt: 1,
  updatedAt: 2,
  updatedBy: null,
  preview: null,
  facts: [],
  badge: null,
  thumbnailUrl: null,
  href: "/plugins/excalidraw/drawings/drw_1",
  archived: false,
};

const kind: StudioKind = {
  id: "drawing",
  label: "Drawing",
  plural: "Drawings",
  icon: "PenTool",
  columns: [],
  actions: [],
  create: null,
  canArchive: false,
  blurb: "",
  agentHint: "Read it with excalidraw_get_drawing.",
};

describe("pointerNote", () => {
  it("points at the item and says how to read it", () => {
    const note = pointerNote(item, kind);
    expect(note).toContain('Studio drawing open while they talk to you: "Launch flow"');
    expect(note).toContain("drawing id drw_1");
    expect(note).toContain("/plugins/excalidraw/drawings/drw_1");
    expect(note).toContain("excalidraw_get_drawing");
  });

  it("falls back to studio_list_items without a hint or kind", () => {
    expect(pointerNote({ ...item, title: " " }, { ...kind, agentHint: undefined })).toContain("studio_list_items");
    expect(pointerNote(item, null)).toMatch(/Studio drawing open.*"Launch flow"[\s\S]*studio_list_items/);
    expect(missingNote("excalidraw:drw_1")).toContain("studio_list_items");
  });
});

describe("item keys", () => {
  it("round-trips ids that hold colons", () => {
    expect(parseItemKey(itemKey({ pluginId: "pages", id: "a:b" }))).toEqual({ pluginId: "pages", id: "a:b" });
    expect(parseItemKey("pages")).toBeNull();
    expect(parseItemKey(":x")).toBeNull();
    expect(parseItemKey("pages:")).toBeNull();
  });

  it("describes the item for the chat", () => {
    expect(toViewed(item, kind)).toEqual({
      pluginId: "excalidraw",
      id: "drw_1",
      kind: "drawing",
      kindLabel: "Drawing",
      title: "Launch flow",
      icon: null,
      kindIcon: "PenTool",
      projectId: "proj_a",
      href: "/plugins/excalidraw/drawings/drw_1",
    });
    expect(toViewed(item, null).kindLabel).toBe("drawing");
  });
});

describe("withItemPill", () => {
  const pill = { pluginId: "studio-chat", wireId: "item:excalidraw:drw_1", label: "Launch flow", icon: "PenTool" };
  const text = (value: string, mentions: unknown[] = [], extra = {}) =>
    ({ type: "text", text: value, mentions, ...extra }) as NewThreadRequest["input"][number];

  it("puts the pill before the first visible text and shifts its mentions", () => {
    const existing = { start: 4, end: 10, resource: { kind: "project", projectId: "proj_a", label: "Acme" } };
    const [hidden, first, second] = withItemPill(
      [text("secret", [], { visibility: "agent-only" }), text("Fix @Acme's arrows", [existing]), text("more")],
      pill,
    ) as any[];
    expect(hidden.text).toBe("secret");
    expect(first.text).toBe("@Launch flow Fix @Acme's arrows");
    expect(first.mentions[0]).toEqual({
      start: 0,
      end: 12,
      resource: { kind: "plugin", pluginId: "studio-chat", itemId: "item:excalidraw:drw_1", label: "Launch flow", icon: "PenTool" },
    });
    expect(first.text.slice(first.mentions[1].start, first.mentions[1].end)).toBe("@Acme'");
    expect(second.text).toBe("more");
  });

  it("adds its own text when the message is only an image", () => {
    const image = { type: "image", url: "https://example.com/a.png" } as NewThreadRequest["input"][number];
    const [first, second] = withItemPill([image], { ...pill, label: "" }) as any[];
    expect(first.text).toBe("@Untitled");
    expect(second).toBe(image);
  });
});
