// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetView } from "../shared";

const rpc = vi.hoisted(() => ({ call: async () => ({ item: { title: "Launch plan", preview: "Goals and dates", href: "/plugins/studio/studio/pages/pg_1" }, kind: null }) }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => rpc,
  useRealtime: () => {},
  useSdk: () => ({}),
  experimental_Icon: ({ name }: { name: string }) => React.createElement("i", { "data-icon": name }),
  ThreadTitle: ({ threadId }: { threadId: string }) => React.createElement("span", null, `thread ${threadId}`),
}));

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }

const { WidgetBody, readStat, tableOf, listItems, embedSandbox, imageSrc, countdown, formatValue } = await import("./widgets");
const { customSrcDoc, CSP, SANDBOX } = await import("./custom-frame");

const theme = { mode: "light" as const, colors: { foreground: "#111" } };
const widget = (type: WidgetView["type"], extra: Partial<WidgetView> = {}): WidgetView => ({ id: "w1", type, title: null, options: {}, source: { kind: "static", data: null }, customType: null, html: null, script: null, ...extra });

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function show(w: WidgetView, value: unknown) {
  await act(async () => root.render(<WidgetBody widget={w} value={value} width={400} height={200} theme={theme} types={[{ id: "wt_1", name: "Lib", description: "", html: "<p>lib</p>", defaultOptions: { color: "red" }, sampleData: null, createdAt: 0, updatedAt: 0 }]} />));
  return container;
}

describe("built-in widgets render", () => {
  it("stat: value, delta and sparkline", async () => {
    const el = await show(widget("stat", { options: { prefix: "$" } }), { value: 1280, delta: "+4%", series: [1, 3, 2, 5] });
    expect(el.textContent).toContain("$1,280");
    expect(el.textContent).toContain("+4%");
    expect(el.querySelector("svg[role=img]")?.getAttribute("aria-label")).toBe("Trend: 1, 3, 2, 5");
  });

  it.each(["line", "bar", "area", "pie"] as const)("%s chart: a labelled figure", async (type) => {
    const el = await show(widget(type), [{ day: "Mon", visits: 3 }, { day: "Tue", visits: 5 }]);
    expect(el.querySelector("figure")?.getAttribute("aria-label")).toBe(`${type} chart of visits by day, 2 rows`);
  });

  it("table: header and cells", async () => {
    const el = await show(widget("table"), [{ name: "Alpha", count: 1200 }, { name: "Beta", count: 7 }]);
    expect([...el.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["name", "count"]);
    expect(el.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(el.textContent).toContain("1,200");
  });

  it("list: feed items with safe links", async () => {
    const el = await show(widget("list"), { items: [{ title: "One", link: "https://a.example/1", date: "2026-10-01T00:00:00Z" }, { title: "Two", link: "javascript:alert(1)" }] });
    const links = [...el.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://a.example/1"]);
    expect(links[0]!.getAttribute("rel")).toContain("noopener");
    expect(el.textContent).toContain("Two");
  });

  it("ticker: two copies, the second hidden from screen readers", async () => {
    const el = await show(widget("ticker"), [{ label: "AAPL", value: "231", delta: "+1%" }, "BTC"]);
    const strips = el.querySelectorAll(".dashboard-ticker-strip");
    expect(strips).toHaveLength(2);
    expect(strips[1]!.getAttribute("aria-hidden")).toBe("true");
    expect(strips[0]!.textContent).toContain("AAPL231+1%");
  });

  it("note: Markdown without raw HTML", async () => {
    const el = await show(widget("note", { options: { markdown: "**Bold** and <b>raw</b> [x](javascript:alert(1))" } }), null);
    expect(el.querySelector("strong")?.textContent).toBe("Bold");
    expect(el.querySelector("b")).toBeNull();
    expect(el.querySelector("a")).toBeNull();
  });

  it("embed: a web page in a sandboxed frame, a Studio item as a card", async () => {
    let el = await show(widget("embed", { options: { url: "https://example.com/" } }), null);
    expect(el.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-forms allow-popups");
    el = await show(widget("embed", { options: { href: "/plugins/studio/studio/pages/pg_1" } }), null);
    expect(el.textContent).toContain("Launch plan");
    el = await show(widget("embed", { options: { threadId: "thr_1" } }), null);
    expect(el.textContent).toContain("thread thr_1");
  });

  it("clock and countdown", async () => {
    let el = await show(widget("clock", { options: { timeZone: "UTC", label: "London" } }), null);
    expect(el.querySelector("time")?.textContent).toMatch(/\d/);
    expect(el.textContent).toContain("London");
    el = await show(widget("clock", { options: { mode: "countdown", target: new Date(Date.now() + 3 * 3600_000).toISOString() } }), null);
    expect(el.querySelector("[role=timer]")?.textContent).toMatch(/^[23]h \d+m \d+s$/);
  });

  it("image: only safe sources", async () => {
    let el = await show(widget("image", { options: { url: "https://img.example/a.png", alt: "Chart" } }), null);
    expect(el.querySelector("img")?.getAttribute("src")).toBe("https://img.example/a.png");
    expect(el.querySelector("img")?.getAttribute("alt")).toBe("Chart");
    el = await show(widget("image", { options: { url: "javascript:alert(1)" } }), null);
    expect(el.querySelector("img")).toBeNull();
  });

  it("progress: bar and gauge expose their value", async () => {
    let el = await show(widget("progress", { options: { unit: "%" } }), 64);
    expect(el.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("64");
    el = await show(widget("progress", { options: { style: "gauge", max: 200 } }), { value: 50, label: "Q4" });
    const gauge = el.querySelector("[role=progressbar]")!;
    expect(gauge.getAttribute("aria-valuemax")).toBe("200");
    expect(gauge.textContent).toContain("Q4");
  });

  it("custom: sandboxed with scripts only, never same-origin, no network", async () => {
    const el = await show(widget("custom", { html: "<p id=x>hi</p>" }), { n: 1 });
    const frame = el.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    const doc = frame.getAttribute("srcdoc")!;
    expect(doc).toContain("connect-src 'none'");
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<p id=x>"));
    const library = await show(widget("custom", { customType: "wt_1" }), null);
    expect(library.querySelector("iframe")?.getAttribute("srcdoc")).toContain("<p>lib</p>");
  });
});

describe("reading data", () => {
  it("reads stats from many shapes", () => {
    expect(readStat(5, {})).toMatchObject({ value: 5 });
    expect(readStat([10, 12], {})).toMatchObject({ value: 12, delta: "+20%", trend: "up", series: [10, 12] });
    expect(readStat([{ v: 4 }, { v: 2 }], { field: "v" })).toMatchObject({ value: 2, trend: "down" });
    expect(readStat({ value: 3, delta: "-2" }, {})).toMatchObject({ value: 3, trend: "down" });
    expect(formatValue(1234.5, { decimals: 1, unit: " ms" })).toBe("1,234.5 ms");
  });

  it("reads tables, lists and sources", () => {
    expect(tableOf({ columns: ["a", "b"], rows: [[1, 2], { a: 3, b: 4 }] }, {})).toEqual({ columns: ["a", "b"], rows: [[1, 2], [3, 4]] });
    expect(tableOf([{ a: 1, b: 2 }], { columns: ["b"] })).toEqual({ columns: ["b"], rows: [[2]] });
    expect(listItems(["x", { name: "y", url: "https://y.example" }])).toEqual([{ title: "x", link: null, summary: null, date: null }, { title: "y", link: "https://y.example", summary: null, date: null }]);
    expect(embedSandbox("http://localhost:3000/x", "http://localhost:3000")).toBe("allow-scripts allow-forms allow-popups");
    expect(imageSrc("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
    expect(imageSrc("file:///etc/passwd")).toBeNull();
    expect(countdown(Date.now() - 1, Date.now())).toBe("Now");
    expect(SANDBOX).toBe("allow-scripts");
    expect(CSP).toContain("connect-src 'none'");
    expect(customSrcDoc("<b>x</b>")).toContain("window.bbWidget");
  });
});
