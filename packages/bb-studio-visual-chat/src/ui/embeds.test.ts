// @vitest-environment jsdom
import { act, createElement } from "react";
// @ts-expect-error: react-dom ships no types here (BB provides it).
import { createRoot } from "react-dom/client";
// @ts-expect-error: as above.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEmbed, EMBED_MESSAGE, EMBED_ORIGINS, EMBED_SANDBOX, keepEmbeds, MAX_KEPT, PAGE_SANDBOX, readEmbedReport, type EmbedReport, type PlacedEmbed } from "./embeds";
import { canvasKit, type CanvasKit } from "./kit";
import { EmbedLayer, type EmbedServices } from "./page-frame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const YT = "dQw4w9WgXcQ", SP = "4cOdK2wGLETKBW3PvgPWqT";

describe("embed URLs", () => {
  it("are built from fields, for the four providers", () => {
    expect(buildEmbed({ embed: "map", q: "retro game stores near 10604" })?.url).toBe("https://maps.google.com/maps?q=retro%20game%20stores%20near%2010604&output=embed");
    const point = buildEmbed({ embed: "point", lat: "41.0339", lon: "-73.7629", label: "Shop" });
    expect(point?.url).toMatch(/^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?bbox=-73\.7749,41\.0273,-73\.7509,41\.0405&layer=mapnik&marker=41\.0339,-73\.7629$/);
    expect(point?.title).toBe("Map: Shop");
    expect(buildEmbed({ embed: "youtube", id: YT, start: "42" })?.url).toBe(`https://www.youtube-nocookie.com/embed/${YT}?rel=0&start=42`);
    expect(buildEmbed({ embed: "spotify", kind: "album", id: SP })?.url).toBe(`https://open.spotify.com/embed/album/${SP}`);
    // Spotify's own dark player in dark mode.
    expect(buildEmbed({ embed: "spotify", id: SP }, "dark")?.url).toBe(`https://open.spotify.com/embed/track/${SP}?theme=0`);
  });

  it("send a referrer only where the provider needs one", () => {
    expect(buildEmbed({ embed: "map", q: "x y" })?.referrerPolicy).toBe("no-referrer");
    expect(buildEmbed({ embed: "youtube", id: YT })?.referrerPolicy).toBe("strict-origin-when-cross-origin");
  });

  it("never take a URL, an unknown kind or a bad field", () => {
    for (const fields of [
      { embed: "https://evil.example/embed" },
      { embed: "iframe", q: "x" },
      { embed: "map", q: "https://evil.example" },
      { embed: "map", q: "//evil.example" },
      { embed: "map", q: "javascript:alert(1)" },
      { embed: "map", q: "" },
      { embed: "map", q: "x".repeat(201) },
      { embed: "map", url: "https://maps.google.com/maps?q=x&output=embed" },
      { embed: "point", lat: "91", lon: "0" },
      { embed: "point", lat: "41", lon: "-181" },
      { embed: "point", lat: "41.0e2", lon: "1" },
      { embed: "point", lat: "41", lon: "1", zoom: "40" },
      { embed: "point", lat: "41" },
      { embed: "youtube", id: "short" },
      { embed: "youtube", id: `${YT}&autoplay=1` },
      { embed: "youtube", id: "../../evil!" },
      { embed: "youtube", id: YT, start: "-1" },
      { embed: "youtube", src: `https://www.youtube.com/embed/${YT}` },
      { embed: "spotify", kind: "artist", id: SP },
      { embed: "spotify", kind: "track", id: `${SP}?x` },
    ]) expect(buildEmbed(fields as Record<string, unknown>), JSON.stringify(fields)).toBeNull();
  });

  it("only ever point at the allowlist", () => {
    const urls = [
      buildEmbed({ embed: "map", q: "a/b?c#d@evil.example" }),
      buildEmbed({ embed: "point", lat: "0", lon: "0" }),
      buildEmbed({ embed: "youtube", id: YT }),
      buildEmbed({ embed: "spotify", kind: "playlist", id: SP }),
    ].map((e) => e!.url);
    for (const url of urls) expect(EMBED_ORIGINS as readonly string[]).toContain(new URL(url).origin);
    // A query's text stays in the query.
    expect(new URL(urls[0]!).searchParams.get("q")).toBe("a/b?c#d@evil.example");
  });
});

const report = (embeds: unknown[], moving = false) => ({ type: EMBED_MESSAGE, moving, embeds });
const map = (id: string, rect = { x: 10, y: 20, w: 300, h: 200 }, q = "retro games near 10604") => ({ id, fields: { embed: "map", q }, rect });

describe("embed reports from the page frame", () => {
  it("are validated: bad ids, rects and fields are dropped", () => {
    const read = readEmbedReport(report([
      map("map"),
      map("bad id with spaces"),
      { id: "r", fields: { embed: "map", q: "x" }, rect: { x: 0, y: 0, w: 0, h: 10 } },
      { id: "n", fields: { embed: "map", q: "x" }, rect: { x: "1", y: 0, w: 10, h: 10 } },
      { id: "u", fields: { embed: "https://evil.example" }, rect: { x: 0, y: 0, w: 10, h: 10 } },
      map("map"), // the same part again
    ]), "light")!;
    expect(read.embeds.map((e) => e.key)).toEqual(["map https://maps.google.com/maps?q=retro%20games%20near%2010604&output=embed"]);
    expect(read.embeds[0]!.rect).toEqual({ x: 10, y: 20, w: 300, h: 200 });
    expect(readEmbedReport({ type: "other" }, "light")).toBeNull();
    expect(readEmbedReport(report(Array.from({ length: 30 }, (_, i) => map(`m${i}`))), "light")!.embeds).toHaveLength(8);
  });
});

describe("keeping embeds alive", () => {
  const placed = (id: string, q = "q"): PlacedEmbed => readEmbedReport(report([map(id, undefined, q)]), "light")!.embeds[0]!;
  it("keeps a part's frame in place across versions, and hides a gone one", () => {
    const a = placed("a"), b = placed("b");
    let kept = keepEmbeds([], { moving: false, embeds: [a, b] }).map((e) => e.embed);
    const next = keepEmbeds(kept, { moving: false, embeds: [{ ...b, rect: { x: 1, y: 2, w: 3, h: 4 } }] });
    expect(next.map((e) => [e.embed.key, e.shown])).toEqual([[a.key, false], [b.key, true]]);
    expect(next[1]!.embed.rect).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    kept = next.map((e) => e.embed);
    // A new query for the same part is a new frame; the old one stays hidden.
    const changed = keepEmbeds(kept, { moving: false, embeds: [placed("b", "other")] });
    expect(changed.map((e) => e.shown)).toEqual([false, false, true]);
  });
  it("drops the oldest hidden frames past the limit", () => {
    let kept: PlacedEmbed[] = [];
    for (let i = 0; i < MAX_KEPT + 5; i++) kept = keepEmbeds(kept, { moving: false, embeds: [placed(`p${i}`)] }).map((e) => e.embed);
    expect(kept).toHaveLength(MAX_KEPT);
    expect(kept.at(-1)!.key.startsWith(`p${MAX_KEPT + 4} `)).toBe(true);
    expect(kept[0]!.key.startsWith("p5 ")).toBe(true);
  });
});

describe("the embed layer", () => {
  it("frames each embed with its own sandbox: no top navigation, lazy, the built URL only", () => {
    const html: string = renderToStaticMarkup(createElement(EmbedLayer, { report: readEmbedReport(report([map("map"), { id: "v", fields: { embed: "youtube", id: YT }, rect: { x: 0, y: 300, w: 480, h: 270 } }]), "light")! }));
    const frames = html.match(/<iframe[^>]*>/g)!;
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(/sandbox="([^"]*)"/.exec(frame)![1]).toBe(EMBED_SANDBOX);
      expect(frame).toContain('loading="lazy"');
      expect(frame).not.toMatch(/allow-top-navigation|allow-modals|allow-forms/);
    }
    expect(EMBED_SANDBOX.split(" ").sort()).toEqual(["allow-popups", "allow-presentation", "allow-same-origin", "allow-scripts"]);
    expect(frames[0]).toMatch(/referrerpolicy="no-referrer"/i);
    expect(frames[1]).toContain(`src="https://www.youtube-nocookie.com/embed/${YT}?rel=0"`);
    expect(frames[1]).toMatch(/referrerpolicy="strict-origin-when-cross-origin"/i);
  });

  it("keeps the same iframe element across versions, so it doesn't reload, and hides it while a version glides", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const render = (r: EmbedReport) => act(() => root.render(createElement(EmbedLayer, { report: r })));
    render(readEmbedReport(report([map("map")]), "light")!);
    const first = host.querySelector("iframe")!;
    render(readEmbedReport(report([map("map", { x: 40, y: 60, w: 300, h: 200 })], true), "light")!);
    expect(host.querySelector("iframe")).toBe(first);
    expect(host.querySelector<HTMLElement>("[data-canvas-embeds]")!.style.opacity).toBe("0");
    expect(first.style.pointerEvents).toBe("none");
    render(readEmbedReport(report([map("map", { x: 40, y: 60, w: 300, h: 200 }), map("other", undefined, "elsewhere")]), "light")!);
    expect(host.querySelector("iframe")).toBe(first);
    expect(first.style.left).toBe("40px");
    expect(first.style.visibility).toBe("visible");
    render(readEmbedReport(report([map("other", undefined, "elsewhere")]), "light")!);
    expect(host.querySelector("iframe")).toBe(first);
    expect(first.style.visibility).toBe("hidden");
    act(() => root.unmount());
  });
});

describe("the page's embed reports", () => {
  let messages: { moving: boolean; embeds: { id: string; fields: Record<string, string>; rect: Record<string, number> }[] }[];
  let cv: CanvasKit;
  let page: HTMLElement;
  let rect = { left: 10, top: 20, width: 300, height: 200 };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
  beforeEach(() => {
    messages = [];
    rect = { left: 10, top: 20, width: 300, height: 200 };
    const parent = { postMessage: (m: unknown) => { if ((m as { type?: string }).type === EMBED_MESSAGE) messages.push(m as never); } };
    Object.defineProperty(window, "parent", { configurable: true, get: () => parent });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return (this.dataset.embed ? { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top } : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }) as DOMRect;
    });
    document.body.innerHTML = `<div id="cv-page"></div>`;
    page = document.getElementById("cv-page")!;
    // One kit for the file, as a frame has one.
    if (!cv) { canvasKit(window); cv = (window as unknown as { cv: CanvasKit }).cv; }
  });
  afterEach(() => { vi.restoreAllMocks(); });
  const html = `<h1 data-cv-id="t">Stores</h1><div data-embed="map" data-q="retro games near 10604" data-cv-id="map"></div>`;

  it("report nothing while the page streams, then each committed placeholder's fields and place", async () => {
    cv.stream!(page, html, false);
    await settle();
    expect(messages.flatMap((m) => m.embeds)).toEqual([]);
    cv.stream!(page, html, true);
    await settle();
    expect(messages.at(-1)).toEqual({ type: EMBED_MESSAGE, moving: false, embeds: [{ id: "map", fields: { embed: "map", q: "retro games near 10604" }, rect: { x: 10, y: 20, w: 300, h: 200 } }] });
  });

  it("report again when the page scrolls, and not when nothing moved", async () => {
    cv.morph!(page, html, false);
    await settle();
    const count = messages.length;
    window.dispatchEvent(new Event("scroll"));
    await settle();
    expect(messages.length).toBe(count);
    rect = { ...rect, top: -80 };
    window.dispatchEvent(new Event("scroll"));
    await settle();
    expect(messages.at(-1)!.embeds[0]!.rect.y).toBe(-80);
  });

  it("say a version is gliding, then report where it settled", async () => {
    let finish!: () => void;
    const glide = { effect: { getComputedTiming: () => ({ endTime: 620 }) }, playState: "running", finished: new Promise<void>((resolve) => { finish = resolve; }) };
    const pulse = { effect: { getComputedTiming: () => ({ endTime: Infinity }) }, playState: "running", finished: new Promise<void>(() => {}) };
    (document as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [glide, pulse];
    cv.morph!(page, html, true);
    await settle();
    expect(messages.at(-1)!.moving).toBe(true);
    rect = { ...rect, left: 50 };
    finish();
    await settle();
    expect(messages.at(-1)).toMatchObject({ moving: false, embeds: [{ id: "map", rect: { x: 50 } }] });
    delete (document as unknown as { getAnimations?: unknown }).getAnimations;
  });

  it("leave a placeholder that's no longer on the page out", async () => {
    cv.morph!(page, html, false);
    await settle();
    cv.morph!(page, `<h1 data-cv-id="t">Gone</h1>`, false);
    await settle();
    expect(messages.at(-1)!.embeds).toEqual([]);
  });
});

describe("webpage parts", () => {
  const pageReport = (url: string) => readEmbedReport(report([{ id: "wiki", fields: { embed: "page", url }, rect: { x: 0, y: 0, w: 600, h: 400 } }]), "light")!;
  it("take an https URL on a public-looking host, with the page sandbox (no popups, forms or downloads)", () => {
    const built = buildEmbed({ embed: "page", url: "https://en.wikipedia.org/wiki/Game_Boy" })!;
    expect(built).toMatchObject({ kind: "page", url: "https://en.wikipedia.org/wiki/Game_Boy", sandbox: PAGE_SANDBOX, referrerPolicy: "no-referrer" });
    expect(PAGE_SANDBOX).toBe("allow-scripts allow-same-origin");
    for (const url of ["http://en.wikipedia.org/", "https://localhost/", "https://192.168.1.2/", "javascript:alert(1)", "https://intranet/x"]) expect(buildEmbed({ embed: "page", url }), url).toBeNull();
  });

  const mount = async (services: EmbedServices, url = "https://en.wikipedia.org/wiki/Game_Boy") => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(EmbedLayer, { report: pageReport(url), services })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    return { host, unmount: () => act(() => root.unmount()) };
  };

  it("frame a verified page that allows it, and Open hands its URL to openUrl", async () => {
    const opened: string[] = [];
    const asked: string[] = [];
    const services: EmbedServices = { webpage: async (url) => { asked.push(url); return { status: "frame", url, source: "searched", card: { title: "Game Boy", site: "Wikipedia", summary: null, image: null } }; }, openUrl: (url) => opened.push(url) };
    const { host, unmount } = await mount(services);
    expect(asked).toEqual(["https://en.wikipedia.org/wiki/Game_Boy"]);
    const frame = host.querySelector<HTMLIFrameElement>('[data-webpage-state="frame"]')!;
    expect(frame.getAttribute("sandbox")).toBe(PAGE_SANDBOX);
    expect(frame.getAttribute("src")).toBe("https://en.wikipedia.org/wiki/Game_Boy");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(opened).toEqual([]); // never opened by itself
    act(() => { host.querySelector<HTMLButtonElement>("[data-webpage-open]")!.click(); });
    expect(opened).toEqual(["https://en.wikipedia.org/wiki/Game_Boy"]);
    unmount();
  });

  it("show a link card for a page that refuses framing, with Open", async () => {
    const opened: string[] = [];
    const { host, unmount } = await mount({ webpage: async (url) => ({ status: "card", url, source: "fetched", card: { title: "microsoft/vscode", site: "GitHub", summary: "Visual Studio Code", image: "https://opengraph.githubassets.com/x.png" } }), openUrl: (url) => opened.push(url) }, "https://github.com/microsoft/vscode");
    const card = host.querySelector('[data-webpage-state="card"]')!;
    expect(card.textContent).toContain("microsoft/vscode");
    expect(card.textContent).toContain("Visual Studio Code");
    expect(host.querySelector("iframe")).toBeNull();
    act(() => { host.querySelector<HTMLButtonElement>("[data-webpage-open]")!.click(); });
    expect(opened).toEqual(["https://github.com/microsoft/vscode"]);
    unmount();
  });

  it("show only a note for an unverified URL: no frame, no card, no Open", async () => {
    const { host, unmount } = await mount({ webpage: async (url) => ({ status: "unverified", url, source: null, card: null }), openUrl: () => { throw new Error("never"); } }, "https://evil.example/login");
    expect(host.querySelector('[data-webpage-state="unverified"]')!.textContent).toMatch(/not verified/);
    expect(host.querySelector("iframe, img, [data-webpage-open]")).toBeNull();
    unmount();
  });
});
