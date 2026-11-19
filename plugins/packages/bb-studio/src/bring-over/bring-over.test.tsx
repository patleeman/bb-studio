// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const welcome = vi.hoisted(() => ({ threadId: "thr_first" as string | null }));
vi.mock("../ui/live", () => ({ useLive: () => ({ data: { threadId: welcome.threadId, opened: true, pending: false, bot: { id: "bot_1" } } }) }));
vi.mock("../kit/app/nav", () => ({ openAppPath: vi.fn() }));

import { jobLine, readBringOver, type BringOverJob, type BringOverState } from "./api";
import { BringOverSection, requestFrom } from "./ui/BringOverSection";
import { BringOverLink, resetBringOverOfferForTests } from "./ui/FirstChatLink";

const listing: BringOverState = {
  available: true,
  sourceDataDir: "/Users/x/.bb",
  readAt: 1,
  projects: [{ id: "proj_a", name: "orbital", threads: 2, threadsHere: 0, lastActivityAt: 1, joins: null }],
  settings: [
    { id: "preferences", label: "Display preferences", detail: "d", secret: false, count: 3 },
    { id: "env", label: "Environment variables", detail: "May hold API keys and tokens.", secret: true, count: 1 },
  ],
  plugins: [
    { id: "acme-tool", version: "1.0.0", source: "/src/acme", sourceKind: "path", enabled: true, hasData: true, here: false, sourceMissing: false },
    { id: "gone-tool", version: null, source: "/nowhere", sourceKind: "path", enabled: true, hasData: false, here: false, sourceMissing: true },
  ],
  job: null,
};

const job: BringOverJob = { id: "j", state: "running", threadsTotal: 40, threadsDone: 12, threadsImported: 9, threadsSkipped: 3, files: 0, settingsApplied: [], failures: [] };

describe("api", () => {
  it("is unavailable on a BB without the routes, or when the request fails", async () => {
    expect(await readBringOver(async () => new Response("Not Found", { status: 404 }))).toEqual({ available: false });
    expect(await readBringOver(async () => { throw new TypeError("offline"); })).toEqual({ available: false });
  });
  it("says where a job is in one line", () => {
    expect(jobLine(job)).toBe("Bringing over: 12 of 40 threads · 3 already here");
    expect(jobLine({ ...job, state: "failed", failures: [{ item: "t", detail: "d" }] })).toBe("Finished with errors: 12 of 40 threads · 3 already here · 1 failed");
  });
  it("turns picks into a request", () => {
    expect(requestFrom({ projects: new Set(["proj_a"]), threads: new Set(["thr_b"]), settings: new Map([["env", false]]), attachments: true })).toEqual({
      picks: [{ kind: "project", id: "proj_a" }, { kind: "thread", id: "thr_b" }],
      attachments: true,
      settings: [{ id: "env", replace: false }],
    });
  });
});

describe("BringOverSection", () => {
  let root: Root;
  let host: HTMLDivElement;
  const calls: { url: string; method: string; body: unknown }[] = [];
  const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
  const button = (text: string) => [...host.querySelectorAll("button")].find((each) => each.textContent === text);
  const serve = (routes: Record<string, (body: unknown) => Response>) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) as unknown : undefined;
      calls.push({ url, method, body });
      const route = routes[`${method} ${url}`];
      return route ? route(body) : new Response("Not Found", { status: 404 });
    }));
  };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const render = async () => {
    await act(async () => { root.render(<BringOverSection />); });
    await act(async () => { await Promise.resolve(); });
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    calls.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it("shows nothing without bb or without the routes", async () => {
    serve({});
    await render();
    expect(host.innerHTML).toBe("");
  });

  it("lists bb, leaves every setting off, and brings over what is picked", async () => {
    serve({
      "GET /api/v1/fork/bring-over": () => json(listing),
      "POST /api/v1/fork/bring-over/jobs": () => json(job, 202),
      "GET /api/v1/fork/bring-over/jobs/current": () => json({ job }),
    });
    await render();
    expect($('[data-testid="bring-over-project"]')?.textContent).toContain("orbital");
    expect(host.querySelector('[role="switch"][aria-label="Environment variables"]')?.getAttribute("aria-checked")).toBe("false");
    expect(button("Bring over")?.disabled).toBe(true);
    act(() => { host.querySelector<HTMLInputElement>('input[aria-label="Bring over orbital"]')!.click(); });
    act(() => { host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Display preferences"]')!.click(); });
    await act(async () => { button("Bring over")!.click(); });
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      picks: [{ kind: "project", id: "proj_a" }],
      attachments: true,
      settings: [{ id: "preferences", replace: false }],
    });
    expect($('[data-testid="bring-over-job"]')?.textContent).toContain("12 of 40 threads");
    expect(button("Cancel")).toBeDefined();
  });

  it("adds a plugin, and says when its source is gone or adding fails", async () => {
    let fail = true;
    serve({
      "GET /api/v1/fork/bring-over": () => json(listing),
      "POST /api/v1/fork/bring-over/plugins/acme-tool/add": () => (fail ? json({ message: "acme-tool could not be installed from /src/acme: no manifest" }, 422) : json({ id: "acme-tool", data: true })),
    });
    await render();
    expect($('[data-testid="bring-over-plugin-gone-tool"]')?.textContent).toContain("Source gone");
    await act(async () => { button("Add")!.click(); });
    expect($('[data-testid="bring-over-plugin-acme-tool"]')?.textContent).toContain("no manifest");
    fail = false;
    await act(async () => { button("Add")!.click(); });
    expect($('[data-testid="bring-over-plugin-acme-tool"]')?.textContent).toContain("Added with its data");
  });
});

describe("BringOverLink", () => {
  let root: Root;
  let host: HTMLDivElement;
  const render = async (threadId: string) => {
    await act(async () => { root.render(<BringOverLink threadId={threadId} />); });
    await act(async () => { await Promise.resolve(); });
  };
  const answer = (state: BringOverState) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(state), { status: 200 })));

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetBringOverOfferForTests();
    localStorage.clear();
    welcome.threadId = "thr_first";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it("offers bb on the first chat until dismissed", async () => {
    answer({ available: true, sourceDataDir: "/Users/x/.bb", readAt: null, job: null });
    await render("thr_first");
    expect(host.querySelector('[data-testid="bring-over-link"]')?.textContent).toContain("Bring things over from bb");
    act(() => { [...host.querySelectorAll("button")].find((each) => each.textContent === "Dismiss")!.click(); });
    expect(host.querySelector('[data-testid="bring-over-link"]')).toBeNull();
  });

  it("stays off other threads, once something came over, and without bb", async () => {
    answer({ available: true, job: null });
    await render("thr_other");
    expect(host.innerHTML).toBe("");
    const remount = () => { act(() => root.unmount()); root = createRoot(host); resetBringOverOfferForTests(); };
    remount();
    answer({ available: true, job });
    await render("thr_first");
    expect(host.innerHTML).toBe("");
    remount();
    answer({ available: false });
    await render("thr_first");
    expect(host.innerHTML).toBe("");
  });
});
