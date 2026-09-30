import { describe, expect, it } from "vitest";
import { element } from "../test/db";
import { sceneThumbnail } from "./thumbnail";

const thumb = (elements: Record<string, unknown>[], files: Record<string, unknown> = {}) =>
  sceneThumbnail({ elements, appState: {}, files } as never);

describe("drawing thumbnails", () => {
  it("is empty for a scene with nothing visible", () => {
    expect(thumb([])).toBeNull();
    expect(thumb([element("rectangle", { isDeleted: true })])).toBeNull();
  });

  it("frames the elements with padding, on a transparent background", () => {
    const svg = thumb([element("rectangle", { x: 10, y: 20, width: 100, height: 50 })])!;
    expect(svg).toMatch(/^<svg[^>]+viewBox="-6 4 132 82"/);
    expect(svg).toContain("<rect");
    expect(svg).not.toContain('fill="#fff');
  });

  it("escapes text and drops colors that aren't colors", () => {
    const svg = thumb([
      element("text", { text: "<script>alert(1)</script> & co", fontSize: 20, strokeColor: "red;}</style><script>" }),
    ])!;
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&#60;script&#62;alert(1)&#60;/script&#62; &#38; co");
    expect(svg).not.toContain("</style>");
  });

  it("only embeds raster images as data URLs", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const withPng = thumb([element("image", { fileId: "f1" })], { f1: { mimeType: "image/png", dataURL: png } })!;
    expect(withPng).toContain(png);
    const withSvg = thumb([element("image", { fileId: "f2" })], {
      f2: { mimeType: "image/svg+xml", dataURL: "data:image/svg+xml;base64,PHN2Zz4=" },
    })!;
    expect(withSvg).not.toContain("data:image/svg");
    const remote = thumb([element("image", { fileId: "f3" })], { f3: { mimeType: "image/png", dataURL: "https://example.com/x.png" } })!;
    expect(remote).not.toContain("example.com");
  });
});
