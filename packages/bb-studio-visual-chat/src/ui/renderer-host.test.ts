// @vitest-environment jsdom
// The board renderer's DOM host (renderer-host.ts, the iOS app's board) and the built bundle: the same frame,
// messages and embed overlay as the desktop's page-frame.tsx, from the same shared code (renderer.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultBbTheme } from "../theme";
import { EMBED_MESSAGE, EMBED_SANDBOX } from "./embeds";
import { createPagePoster, PAGE_CSP, PAGE_MESSAGE, PAGE_READY_MESSAGE, pageSrcDoc, RENDERER_PROTOCOL, STREAM_MESSAGE, STYLE_MESSAGE, type WebpageAnswer } from "./renderer";
import { hostTokenCss, mountBoard, type BoardState } from "./renderer-host";

const light = defaultBbTheme("light");
const state = (extra: Partial<BoardState> = {}): BoardState => ({ html: null, stream: null, streamN: 0, rev: 0, look: "editorial", theme: light, ...extra });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function board(services = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const rendered: unknown[] = [];
  const host = mountBoard(container, { title: "Board", services, onRendered: (s) => rendered.push(s) });
  const frame = container.querySelector<HTMLIFrameElement>("iframe[data-canvas-page-frame]")!;
  const posted: { type: string; [key: string]: unknown }[] = [];
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(((message: never) => { posted.push(message); }) as never);
  const fromFrame = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow }));
  return { container, host, frame, posted, rendered, fromFrame, ready: () => fromFrame({ type: PAGE_READY_MESSAGE }) };
}

describe("the page poster", () => {
  it("posts as the desktop frame did: the first page at once, then versions animated, a stream until it lands", () => {
    const poster = createPagePoster();
    expect(poster.next({ html: "<p>1</p>", stream: null, streamN: 0, rev: 1 })).toEqual([{ type: PAGE_MESSAGE, html: "<p>1</p>", animate: false, rev: 1 }]);
    expect(poster.next({ html: "<p>1</p>", stream: null, streamN: 0, rev: 1 })).toEqual([]);
    expect(poster.next({ html: "<p>1</p>", stream: "<p>2", streamN: 1, rev: 1 })).toEqual([{ type: STREAM_MESSAGE, html: "<p>2", n: 1 }]);
    expect(poster.next({ html: "<p>1</p>", stream: "<p>2", streamN: 1, rev: 1 })).toEqual([]);
    // The stream ended on the page that was there before: it still lands, so the streamed parts commit.
    expect(poster.next({ html: "<p>1</p>", stream: null, streamN: 0, rev: 2 })).toEqual([{ type: PAGE_MESSAGE, html: "<p>1</p>", animate: true, rev: 2 }]);
    expect(poster.next({ html: "<p>3</p>", stream: null, streamN: 0, rev: 3 })).toEqual([{ type: PAGE_MESSAGE, html: "<p>3</p>", animate: true, rev: 3 }]);
  });
});

describe("the DOM host", () => {
  it("frames the page as the desktop does: scripts only, no referrer, the shared frame document", () => {
    const { frame, host } = board();
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.srcdoc).toBe(pageSrcDoc());
    host.destroy();
  });

  it("posts nothing until the frame is ready, then the style and the page; a stream shows until it lands", () => {
    const { host, posted, ready, rendered, frame } = board();
    host.update(state({ html: "<h1 data-cv-id='t'>One</h1>", rev: 1 }));
    expect(posted).toEqual([]);
    ready();
    expect(posted.map((m) => m.type)).toEqual([STYLE_MESSAGE, PAGE_MESSAGE]);
    expect(posted[0]).toMatchObject({ look: "editorial", mode: "light" });
    expect(posted[1]).toMatchObject({ animate: false, rev: 1 });
    host.update(state({ html: "<h1 data-cv-id='t'>One</h1>", stream: "<h1 data-cv-id='t'>Tw", streamN: 3, rev: 1 }));
    expect(posted.at(-1)).toEqual({ type: STREAM_MESSAGE, html: "<h1 data-cv-id='t'>Tw", n: 3 });
    expect(frame.getAttribute("data-page-streaming")).toBe("true");
    host.update(state({ html: "<h1 data-cv-id='t'>Two</h1>", rev: 2 }));
    expect(posted.at(-1)).toMatchObject({ type: PAGE_MESSAGE, html: "<h1 data-cv-id='t'>Two</h1>", animate: true, rev: 2 });
    expect(frame.hasAttribute("data-page-streaming")).toBe(false);
    expect(rendered.at(-1)).toMatchObject({ ready: true, rev: 2, streaming: false });
    // A new theme restyles in place; the same one posts nothing.
    const count = posted.length;
    host.update(state({ html: "<h1 data-cv-id='t'>Two</h1>", rev: 2 }));
    expect(posted.length).toBe(count);
    host.update(state({ html: "<h1 data-cv-id='t'>Two</h1>", rev: 2, theme: defaultBbTheme("dark") }));
    expect(posted.at(-1)).toMatchObject({ type: STYLE_MESSAGE, mode: "dark" });
    host.destroy();
  });

  it("ignores messages from anything but its own frame", () => {
    const { host, posted } = board();
    host.update(state({ html: "<p>x</p>", rev: 1 }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: PAGE_READY_MESSAGE }, source: window }));
    expect(posted).toEqual([]);
    host.destroy();
  });

  const map = (id: string, rect = { x: 10, y: 20, w: 300, h: 200 }, q = "retro games near 10604") => ({ id, fields: { embed: "map", q }, rect });

  it("frames embeds over the page from the frame's reports, and keeps each frame across versions", () => {
    const { host, container, fromFrame, ready } = board();
    host.update(state({ html: "<p>x</p>", rev: 1 }));
    ready();
    fromFrame({ type: EMBED_MESSAGE, moving: false, embeds: [map("map"), { id: "bad", fields: { embed: "iframe", url: "https://evil.example" }, rect: { x: 0, y: 0, w: 10, h: 10 } }] });
    const frames = () => [...container.querySelectorAll<HTMLIFrameElement>("[data-canvas-embed]")];
    expect(frames()).toHaveLength(1);
    const first = frames()[0]!;
    expect(first.getAttribute("src")).toBe("https://maps.google.com/maps?q=retro%20games%20near%2010604&output=embed");
    expect(first.getAttribute("sandbox")).toBe(EMBED_SANDBOX);
    expect(first.getAttribute("loading")).toBe("lazy");
    expect(first.style.left).toBe("10px");
    expect(first.style.visibility).toBe("visible");
    // A version gliding: hidden, not clickable; then where it settled, the same element.
    fromFrame({ type: EMBED_MESSAGE, moving: true, embeds: [map("map", { x: 40, y: 60, w: 300, h: 200 })] });
    expect(container.querySelector<HTMLElement>("[data-canvas-embeds]")!.style.opacity).toBe("0");
    expect(first.style.pointerEvents).toBe("none");
    fromFrame({ type: EMBED_MESSAGE, moving: false, embeds: [map("map", { x: 40, y: 60, w: 300, h: 200 }), map("other", undefined, "elsewhere")] });
    expect(frames()[0]).toBe(first);
    expect(first.style.left).toBe("40px");
    expect(frames()).toHaveLength(2);
    // Gone from the page: kept alive, hidden.
    fromFrame({ type: EMBED_MESSAGE, moving: false, embeds: [map("other", undefined, "elsewhere")] });
    expect(frames()[0]).toBe(first);
    expect(first.style.visibility).toBe("hidden");
    host.destroy();
    expect(container.children).toHaveLength(0);
  });

  const page = (url: string) => ({ type: EMBED_MESSAGE, moving: false, embeds: [{ id: "wiki", fields: { embed: "page", url }, rect: { x: 0, y: 0, w: 600, h: 400 } }] });

  it("shows a webpage part only once the check answers: a link card with Open, or only a note", async () => {
    const opened: string[] = [];
    const answers: Record<string, WebpageAnswer> = {
      "https://github.com/microsoft/vscode": { status: "card", url: "https://github.com/microsoft/vscode", source: "fetched", card: { title: "microsoft/vscode", site: "GitHub", summary: "Visual Studio Code", image: "https://opengraph.githubassets.com/x.png" } },
      "https://evil.example/login": { status: "unverified", url: "https://evil.example/login", source: null, card: null },
    };
    const { host, container, fromFrame, ready } = board({ webpage: async (url: string) => answers[url]!, openUrl: (url: string) => opened.push(url) });
    host.update(state({ html: "<p>x</p>", rev: 1 }));
    ready();
    fromFrame(page("https://github.com/microsoft/vscode"));
    expect(container.querySelector('[data-webpage-state="checking"]')).not.toBeNull();
    await settle();
    const card = container.querySelector('[data-webpage-state="card"]')!;
    expect(card.textContent).toContain("microsoft/vscode");
    expect(card.textContent).toContain("Visual Studio Code");
    expect(card.querySelector("img")!.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(opened).toEqual([]);
    container.querySelector<HTMLButtonElement>("[data-webpage-open]")!.click();
    expect(opened).toEqual(["https://github.com/microsoft/vscode"]);
    fromFrame(page("https://evil.example/login"));
    await settle();
    const note = container.querySelector('[data-embed-shown] [data-webpage-state="unverified"]')!;
    expect(note.textContent).toMatch(/not verified/);
    expect(note.parentElement!.querySelector("iframe, img, [data-webpage-open]")).toBeNull();
    host.destroy();
  });

  it("gives a host page BB's theme variables for the overlay", () => {
    const css = hostTokenCss(light);
    for (const name of ["--background:", "--card:", "--border:", "--muted-foreground:", "--radius:8px"]) expect(css).toContain(name);
  });
});

describe("the built renderer (bundle/canvas-renderer.js)", () => {
  const js = readFileSync(join(__dirname, "..", "..", "bundle", "canvas-renderer.js"), "utf8");
  it("is one classic script that sets BBCanvasRenderer, with no imports and no zod", () => {
    expect(js).not.toMatch(/^\s*import\s|\bimport\(/m);
    expect(js).not.toContain("ZodError");
    const scope: { BBCanvasRenderer?: Record<string, unknown> } = {};
    new Function("globalThis", js)(scope);
    expect(scope.BBCanvasRenderer).toMatchObject({ protocol: RENDERER_PROTOCOL, defaultLook: "editorial" });
  });

  it("draws a board as the source does", () => {
    const scope: { BBCanvasRenderer?: { mountBoard: typeof mountBoard; themeFrom: (mode: string, raw?: unknown) => typeof light } } = {};
    new Function("globalThis", js)(scope);
    const renderer = scope.BBCanvasRenderer!;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const host = renderer.mountBoard(container, { title: "Board" });
    const frame = container.querySelector<HTMLIFrameElement>("iframe[data-canvas-page-frame]")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.srcdoc).toContain(PAGE_CSP);
    expect(frame.srcdoc).toContain('<div id="cv-page"></div>');
    const theme = renderer.themeFrom("dark", { colors: { background: "#000000" } });
    expect(theme).toMatchObject({ mode: "dark", colors: { background: "#000000" } });
    host.destroy();
  });
});
