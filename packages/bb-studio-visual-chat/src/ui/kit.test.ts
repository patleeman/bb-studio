import { describe, expect, it } from "vitest";
import { accentOf, ORGANIC_LOOKS } from "../looks";
import { defaultBbTheme } from "../theme";
import { frameSrcDoc } from "./frame";
import { canvasKit, type CanvasKit } from "./kit";

const kit = canvasKit();
const EVIL = `<img src=x onerror="alert(1)">`;

describe("accents", () => {
  it("give quotes the style's own or a pull or bar, and nothing else an accent", () => {
    expect(accentOf("quote", {}, "editorial")).toBe("pull");
    expect(accentOf("quote", {}, "field")).toBe("pull");
    expect(accentOf("quote", {}, "instrument")).toBe("bar");
    expect(accentOf("quote", { accent: "bar" }, "field")).toBe("bar");
    // A retired sticky (or any unknown accent) falls back to the style's own.
    expect(accentOf("quote", { accent: "sticky" }, "instrument")).toBe("bar");
    expect(accentOf("quote", { accent: "callout" }, "field")).toBe("pull");
    expect(accentOf("note", { accent: "sticky" }, "field")).toBeNull();
    expect(accentOf("stat", { accent: "pull" }, "field")).toBeNull();
  });
});

describe("the canvas kit", () => {
  it("draws shaped pieces and annotations with every value escaped", () => {
    for (const html of [
      kit.bignum(EVIL, { label: EVIL, unit: EVIL, sub: EVIL }),
      kit.quote(EVIL, { by: EVIL, role: EVIL }),
      kit.callout(EVIL, { x: 0.5, y: 0.5 }),
      kit.stars(4.5, { max: EVIL }),
      kit.line([{ m: "a", v: 1 }, { m: "b", v: 3 }], { callouts: [{ x: "b", text: EVIL }] }),
      kit.columns([{ m: "a", v: 1 }, { m: "b", v: 3 }], { callouts: [{ x: "a", text: EVIL }] }),
      kit.tilemap({ PA: 2 }, { callouts: [{ state: "PA", text: EVIL }] }),
    ]) {
      expect(html).not.toContain("<img");
      expect(html.length).toBeGreaterThan(20);
    }
    // A callout lands on its point: the chart draws its dot and label.
    expect(kit.line([{ m: "a", v: 1 }, { m: "b", v: 3 }], { callouts: [{ x: "b", text: "peak" }] })).toContain("peak");
    expect(kit.tilemap({ PA: 2 }, { callouts: [{ state: "Pennsylvania", text: "flipped" }] })).toContain("flipped");
    // Stars fill to the share of the score.
    expect(kit.stars(86, { max: 100 })).toContain("86 out of 100");
    expect(kit.stars("n/a")).toBe("");
    // A score nobody published says so; a sourced one names its source.
    expect(kit.stars(4, { max: 5 })).toContain(">my pick<");
    expect(kit.stars(9, { max: 10, source: "IGN" })).toContain(">IGN<");
    expect(kit.stars(9, { max: 10, source: "IGN" })).not.toContain("my pick");
    expect(kit.stars(9, { max: 10, note: "editor's pick, not a review score" })).toContain("editor&#39;s pick, not a review score");
  });

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

  it("keeps column charts honest: zero on the axis, and options.max sets the top", () => {
    const tiny = kit.columns([{ race: "A", m: 0.1 }, { race: "B", m: 0 }], { w: 400, h: 200, max: 5 });
    expect(tiny).toContain("cv-zero-line");
    expect(tiny).toMatch(/>6</);
    // The 0.1 bar is a sliver of a 0–5 axis, not the whole height.
    const heights = [...tiny.matchAll(/<rect [^>]*height="([0-9.]+)"/g)].map((match) => Number(match[1]));
    expect(Math.max(...heights)).toBeLessThan(10);
  });

  it("puts every value on the axis: the top tick is at or above the largest bar", () => {
    const svg = kit.columns([{ k: "a", v: 4.5 }, { k: "b", v: 1 }], { w: 400, h: 200 });
    const ys = [...svg.matchAll(/<rect [^>]*y="([0-9.-]+)"/g)].map((match) => Number(match[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(15);
  });

  it("gives every frame the look's tokens and kit, and the agent's HTML after them", () => {
    for (const look of ORGANIC_LOOKS) {
      const doc = frameSrcDoc("<p class=\"cv-body\">hi</p>", look, defaultBbTheme("dark"));
      expect(doc).toContain(`data-cv-look="${look}"`);
      expect(doc).toContain("--cv-paper:");
      expect(doc).toContain(".cv-kicker{");
      expect(doc).toContain("connect-src 'none'");
      expect(doc.indexOf("window.cv.render")).toBeLessThan(doc.indexOf("<p class=\"cv-body\">"));
    }
  });
});

describe("rich text", () => {
  it("renders Markdown links as links (http only), not raw brackets", async () => {
    // @ts-expect-error react-dom ships no types here; the test only needs renderToStaticMarkup.
    const { renderToStaticMarkup } = (await import("react-dom/server")) as { renderToStaticMarkup(element: unknown): string };
    const { createElement } = await import("react");
    const { RichText } = await import("./organic-items");
    const html = renderToStaticMarkup(createElement(RichText, { text: "See [AP](https://apnews.com/x) and [bad](javascript:alert(1))." }));
    expect(html).toContain('<a href="https://apnews.com/x"');
    expect(html).not.toContain("[AP]");
    expect(html).not.toContain('href="javascript');
  });
});

describe("the kit's building blocks", () => {
  it("expand a card from its attributes, escaped, with an https picture and a sourced or 'my pick' rating", () => {
    const card = kit.block("card", { img: "https://upload.wikimedia.org/tetris.jpg", title: EVIL, rating: "9", source: "IGN", line: EVIL, alt: EVIL });
    expect(card).toContain('<img src="https://upload.wikimedia.org/tetris.jpg"');
    expect(card).toContain("IGN");
    expect(card).not.toContain("<img src=x");
    expect(kit.block("card", { title: "Tetris", rating: "8" })).toContain("my pick");
    // No picture (a draft) or one that isn't https: a placeholder.
    for (const attrs of [{ title: "Tetris" }, { title: "Tetris", img: "javascript:alert(1)" }]) {
      const html = kit.block("card", attrs);
      expect(html).toContain("cv-card-ph");
      expect(html).not.toContain("<img");
    }
  });

  it("expand stats, steps, sides, quotes and placeholders, keeping what the element holds", () => {
    const stat = kit.block("stat", { value: "88", unit: " min", label: "Median reply", line: "Double W32", source: "Sample data" }, '<div data-chart="spark"></div>');
    expect(stat).toContain("cv-bignum");
    expect(stat).toContain("Double W32");
    expect(stat.indexOf("data-chart")).toBeGreaterThan(stat.indexOf("Double W32"));
    expect(kit.block("step", { when: "Thu 12", title: "Launch", line: "Nothing else" })).toContain("cv-step-title");
    const side = kit.block("side", { label: "Chat", verdict: "First", value: "1010", points: `Largest queue | ${EVIL}` });
    expect(side.match(/<li>/g)).toHaveLength(2);
    expect(side).not.toContain("<img src=x");
    expect(kit.block("side", { points: '["a","b","c"]' }).match(/<li>/g)).toHaveLength(3);
    expect(kit.block("quote", { text: EVIL, by: "Ada" })).toContain("&lt;img");
    expect(kit.block("placeholder", { label: "Ratings" })).toContain("cv-ph-box");
    expect(kit.block("nope", {}, "<b>kept</b>")).toBe("<b>kept</b>");
  });
});

describe("big numbers", () => {
  it("print a year as a year when there's no unit or currency, and group everything else", () => {
    expect(kit.bignum(1998)).toContain(">1998<");
    expect(kit.bignum("2001")).toContain(">2001<");
    expect(kit.block("stat", { value: "1998", label: "Released" })).toContain(">1998<");
    // A unit or a currency makes it an amount; outside 1900–2100, or with a fraction, it's a number.
    expect(kit.bignum(1998, { unit: " users" })).toContain(">1,998<");
    expect(kit.bignum(1998, { prefix: "$" })).toContain(">1,998<");
    expect(kit.bignum(2500)).toContain(">2,500<");
    expect(kit.bignum(1899)).toContain(">1,899<");
    expect(kit.bignum(1998.4, { decimals: 1 })).toContain(">1,998.4<");
    // Elsewhere numbers keep their commas.
    expect(kit.fmt(1998)).toBe("1,998");
  });

  it("put a currency symbol given as the unit in front of the number", () => {
    expect(kit.fmt(30, { unit: "$" })).toBe("$30");
    expect(kit.fmt(30, { unit: " $" })).toBe("$30");
    expect(kit.fmt(58.2, { unit: "€" })).toBe("€58.2");
    expect(kit.fmt(30, { unit: "%" })).toBe("30%");
    expect(kit.fmt(30, { prefix: "$", unit: " each" })).toBe("$30 each");
    expect(kit.bignum(150, { unit: "$" })).toMatch(/cv-bignum-unit">\$<\/span>150</);
  });
});
