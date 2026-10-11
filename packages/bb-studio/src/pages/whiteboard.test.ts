import { describe, expect, it } from "vitest";
import { changesData, nextIndex, parseScene, renderWhiteboard, whiteboardChanges } from "./whiteboard";

const scene = parseScene(JSON.stringify({
  type: "excalidraw",
  elements: [
    { id: "box", type: "rectangle", x: 0, y: 0, width: 100, height: 50, index: "a0", version: 3, strokeColor: "#1e1e1e" },
    { id: "gone", type: "ellipse", x: 500, y: 500, width: 10, height: 10, index: "a1", version: 2, isDeleted: true },
    { id: "evil", type: "text", x: 10, y: 10, width: 50, text: "<script>x</script>", index: "a2", version: 1, strokeColor: "red\" onload=\"x" },
  ],
  appState: { viewBackgroundColor: "#fff" },
  files: {},
}));

describe("whiteboard", () => {
  it("renders live elements as sanitized SVG groups in scene coordinates", () => {
    const { viewBox, markup } = renderWhiteboard(scene);
    expect(markup).toContain('<g data-id="box">');
    expect(markup).not.toContain("gone");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("onload");
    expect(viewBox?.[0]).toBeLessThan(0);
    expect(renderWhiteboard(parseScene("{}"))).toEqual({ viewBox: null, markup: "" });
  });

  it("adds strokes on top as freedraw elements and erases with a bumped version", () => {
    const changes = whiteboardChanges(scene, [{ points: [[10, 20], [15, 30], [5, 25]], color: "#e03131", width: 2 }], ["box", "gone", "missing"], 42);
    expect(changes).toHaveLength(2);
    const [erased, stroke] = changes;
    expect(erased).toMatchObject({ id: "box", isDeleted: true, version: 4, updated: 42 });
    expect(stroke).toMatchObject({ type: "freedraw", x: 10, y: 20, width: 10, height: 10, strokeColor: "#e03131", index: "a3", version: 1, isDeleted: false });
    expect(stroke!.points).toEqual([[0, 0], [5, 10], [-5, 5]]);
    expect(JSON.parse(changesData(changes)).elements).toHaveLength(2);
  });

  it("orders new elements after existing fractional indices", () => {
    expect(nextIndex(null)).toBe("a0");
    expect(nextIndex("a0")).toBe("a1");
    expect(nextIndex("az")).toBe("b00");
    expect(nextIndex("a0V") > "a0V").toBe(true);
  });
});
