import { describe, expect, it } from "vitest";
import { fillPictures, findPart, outline, pageTitle, replacePart, textOf } from "./page";

const PAGE = `<style>.a > div { color: red } /* <div data-cv-id="fake"> */</style>
<div data-cv-id="outer" class="a"><div><div data-cv-id='inner'>Inner <b>bold</b></div></div><img data-cv-id=pic src="x.png"><br></div>
<script>const s = "<div data-cv-id=\\"nope\\">";</script>
<section data-cv-id="last"><h2>Second &amp; last</h2></section>`;

describe("pages", () => {
  it("finds a part by id across nesting, void tags, and ids that only look like parts inside styles and scripts", () => {
    expect(PAGE.slice(findPart(PAGE, "inner")!.start, findPart(PAGE, "inner")!.end)).toBe("<div data-cv-id='inner'>Inner <b>bold</b></div>");
    const outer = PAGE.slice(findPart(PAGE, "outer")!.start, findPart(PAGE, "outer")!.end);
    expect(outer.startsWith('<div data-cv-id="outer"')).toBe(true);
    expect(outer.endsWith("<br></div>")).toBe(true);
    expect(PAGE.slice(findPart(PAGE, "pic")!.start, findPart(PAGE, "pic")!.end)).toBe('<img data-cv-id=pic src="x.png">');
    expect(findPart(PAGE, "fake")).toBeNull();
    expect(findPart(PAGE, "nope")).toBeNull();
  });

  it("replaces or removes a part, and lists the parts with their text", () => {
    expect(replacePart(PAGE, "inner", '<div data-cv-id="inner">New</div>')).toContain('<div><div data-cv-id="inner">New</div></div>');
    expect(replacePart(PAGE, "last", "")).not.toContain("Second");
    expect(replacePart(PAGE, "missing", "x")).toBeNull();
    expect(outline(PAGE).map((part) => [part.id, part.tag])).toEqual([["outer", "div"], ["inner", "div"], ["pic", "img"], ["last", "section"]]);
    expect(outline(PAGE)[1]!.text).toBe("Inner bold");
  });

  it("reads a title from the first heading, and visible text without scripts or styles", () => {
    expect(pageTitle(PAGE)).toBe("Second & last");
    expect(pageTitle("<h1>Big <em>news</em></h1><h2>x</h2>")).toBe("Big news");
    expect(pageTitle("<p>none</p>")).toBeNull();
    expect(textOf(PAGE)).not.toContain("color");
  });
});

describe("fillPictures", () => {
  it("fills cards by id with escaped attributes, keeping their own and skipping the rest", () => {
    const pictures = new Map([["a", { url: 'https://upload.wikimedia.org/a".jpg', alt: "A <b>" }], ["b", { url: "javascript:alert(1)" }], ["c", { url: "https://x.org/c.jpg" }]]);
    const html = `<div data-block='card' data-cv-id="a"></div><div data-block="card" data-cv-id="b"></div><div data-block="card" data-cv-id="c" data-alt="mine"/><script>var s = '<div data-block="card" data-cv-id="a">';</script>`;
    const { html: out, filled } = fillPictures(html, pictures);
    expect(filled).toEqual(["a", "c"]);
    expect(out).toContain(`data-cv-id="a" data-img="https://upload.wikimedia.org/a&quot;.jpg" data-alt="A &lt;b&gt;">`);
    expect(out).toContain(`data-cv-id="c" data-alt="mine" data-img="https://x.org/c.jpg"/>`);
    expect(out).not.toContain("javascript:");
    expect(out).toContain(`<script>var s = '<div data-block="card" data-cv-id="a">';</script>`);
  });
});
