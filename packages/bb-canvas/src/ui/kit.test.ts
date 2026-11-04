import { describe, expect, it } from "vitest";
import { ORGANIC_LOOKS } from "../looks";
import { frameSrcDoc } from "./frame";
import { canvasKit, type CanvasKit } from "./kit";

const kit = canvasKit();
const EVIL = `<img src=x onerror="alert(1)">`;

describe("the canvas kit", () => {
  it("runs from its own source, as a custom frame gets it", () => {
    // The frame injects `(${canvasKit})(window)`: nothing from outside its body.
    const fake = { document: { readyState: "complete", querySelectorAll: () => [], getElementById: () => null, documentElement: { clientWidth: 300 } }, addEventListener() {} } as unknown as { cv?: CanvasKit };
    new Function("window", `(${canvasKit.toString()})(window);`)(fake);
    expect(fake.cv!.spark([1, 3, 2])).toContain("<svg");
    expect(fake.cv!.width!()).toBe(300);
    expect(typeof fake.cv!.render).toBe("function");
  });

  it("escapes every label and refuses unsafe colors", () => {
    const outputs = [
      kit.hbars([{ label: EVIL, value: 3, note: EVIL, color: "red;background:url(x)" }]),
      kit.line([{ day: EVIL, a: 1 }, { day: "b", a: 2 }], { marks: [{ x: EVIL, label: EVIL }], unit: EVIL }),
      kit.columns([{ k: EVIL, v: 2 }]),
      kit.split([{ label: EVIL, value: 2 }], { mark: 1, markLabel: EVIL }),
      kit.donut([{ label: EVIL, value: 2 }], { center: EVIL, sub: EVIL }),
      kit.meter(3, { label: EVIL, marks: [{ at: 1, label: EVIL }] }),
      kit.tilemap({ PA: { value: 1, label: EVIL, color: "javascript:alert(1)" } }, { legend: [EVIL, EVIL], show: "label" }),
      kit.timeline([{ date: EVIL, label: EVIL, note: EVIL, color: EVIL }]),
      kit.waffle([{ label: EVIL, n: 3 }]),
      kit.multiples([{ label: EVIL, values: [1, 2], value: EVIL, note: EVIL }]),
      kit.legend([{ label: EVIL, color: EVIL }]),
      kit.delta(EVIL),
      kit.fmt(EVIL),
    ];
    for (const html of outputs) {
      expect(html).not.toContain("<img");
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("url(x)");
    }
  });

  it("draws the built-in shapes", () => {
    expect(kit.tilemap({ Pennsylvania: 2, GA: -1 })).toContain(">PA<");
    expect(kit.tilemap({ PA: 2, GA: -1 })).toContain("color-mix(in oklab, var(--cv-red)");
    expect(kit.split([{ label: "D", value: 220 }, { label: "R", value: 215 }], { total: 435, mark: 218 })).toContain("218 to win");
    expect(kit.line([{ m: "Jan", a: 1, b: 2 }, { m: "Feb", a: 3, b: 1 }], { w: 400 })).toMatch(/cv-end-label[^>]*>a 3</);
    expect(kit.delta(-2, { invert: true })).toContain("cv-up");
    expect(kit.paint("dem")).toBe("var(--cv-blue)");
    expect(kit.paint("c3")).toBe("var(--cv-c3)");
    expect(kit.fmt(1234.5, { prefix: "$" })).toBe("$1,235");
    expect(kit.fmt(-2.25, { unit: " pts", signed: true })).toBe("−2.25 pts");
  });

  it("gives every frame the look's tokens and kit, and the agent's HTML after them", () => {
    for (const look of ORGANIC_LOOKS) {
      const doc = frameSrcDoc("<p class=\"cv-body\">hi</p>", look, "dark");
      expect(doc).toContain(`data-cv-look="${look}"`);
      expect(doc).toContain("--cv-paper:");
      expect(doc).toContain(".cv-kicker{");
      expect(doc).toContain("connect-src 'none'");
      expect(doc.indexOf("window.cv.render")).toBeLessThan(doc.indexOf("<p class=\"cv-body\">"));
    }
  });
});
