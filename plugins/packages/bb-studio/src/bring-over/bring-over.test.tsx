// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const welcome = vi.hoisted(() => ({ threadId: "thr_first" as string | null }));
vi.mock("../ui/live", () => ({ useLive: () => ({ data: { threadId: welcome.threadId, opened: true, pending: false, bot: { id: "bot_1" } } }) }));
vi.mock("../kit/app/nav", () => ({ openAppPath: vi.fn() }));

import { jobLine, readBringOver, resetUiTokenForTests, secretLine, type BringOverJob, type BringOverState } from "./api";
import { BringOverSection, requestFrom } from "./ui/BringOverSection";
import { BringOverLink, resetBringOverOfferForTests } from "./ui/FirstChatLink";

const listing: BringOverState = {
  available: true,
  sourceDataDir: "/Users/x/.bb",
  readAt: 1,
  projects: [{ id: "proj_a", name: "orbital", threads: 2, threadsHere: 0, lastActivityAt: 1, joins: null }],
  settings: [
    { id: "preferences", label: "Display preferences", detail: "d", secret: false, count: 3 },
    { id: "env", label: "Environment variables", detail: "May hold API keys and tokens.", secret: true, count: 2, names: ["GITHUB_TOKEN", "OPENAI_API_KEY"], alreadyHere: ["OPENAI_API_KEY"] },
    { id: "skills", label: "Skills", detail: "bb's skills folder is a link to another folder and is not copied.", secret: false, count: 0 },
  ],
  plugins: [
    { id: "acme-tool", version: "1.0.0", source: "/src/acme", sourceKind: "path", enabled: true, hasData: true, here: false, sourceMissing: false },
    { id: "gone-tool", version: null, source: "/nowhere", sourceKind: "path", enabled: true, hasData: false, here: false, sourceMissing: true },
    { id: "future-tool", version: null, source: "/src/future", sourceKind: "path", enabled: true, hasData: false, here: false, sourceMissing: false, needsNewer: ">=99.0.0" },
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
  it("names the secrets in one line", () => {
    const env = { id: "env", label: "Environment variables", detail: "", secret: true, count: 1, names: ["A"], alreadyHere: ["A"] };
    expect(secretLine(env, false)).toBe("Brings over 1 environment variable: A.");
    expect(secretLine(env, true)).toBe("Brings over 1 environment variable: A. Replaces BB Studio's values for A.");
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
  const calls: { url: string; method: string; body: unknown; token: string | null }[] = [];
  const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
  const button = (text: string) => [...host.querySelectorAll("button")].find((each) => each.textContent === text);
  let fromApp = true;
  const serve = (routes: Record<string, (body: unknown) => Response>) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) as unknown : undefined;
      const token = new Headers(init?.headers).get("x-bb-studio-ui-token");
      calls.push({ url, method, body, token });
      if (`${method} ${url}` === "GET /api/v1/fork/bring-over/gate") return json({ fromApp, matches: fromApp && token === "token-from-the-app" });
      const route = routes[`${method} ${url}`];
      return route ? route(body) : new Response("Not Found", { status: 404 });
    }));
  };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const render = async () => {
    await act(async () => { root.render(<BringOverSection />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetUiTokenForTests();
    vi.stubGlobal("bbDesktop", { experimental_bringOverToken: async () => "token-from-the-app" });
    calls.length = 0;
    fromApp = true;
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
    expect(calls.find((call) => call.method === "POST")?.token).toBe("token-from-the-app");
    expect($('[data-testid="bring-over-job"]')?.textContent).toContain("12 of 40 threads");
    expect(button("Cancel")).toBeDefined();
  });

  it("asks before bringing secrets over, naming them and what they replace", async () => {
    serve({
      "GET /api/v1/fork/bring-over": () => json(listing),
      "POST /api/v1/fork/bring-over/jobs": () => json(job, 202),
      "GET /api/v1/fork/bring-over/jobs/current": () => json({ job }),
    });
    await render();
    const env = $('[data-testid="bring-over-setting-env"]')!;
    expect(env.textContent).toContain("Holds secrets");
    expect(host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Skills"]')!.disabled).toBe(true);
    act(() => { env.querySelector<HTMLButtonElement>('[role="switch"]')!.click(); });
    act(() => { env.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
    act(() => { button("Bring over")!.click(); });
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    expect($('[data-testid="bring-over-confirm-secrets"]')?.textContent).toContain("Brings over 2 environment variables: GITHUB_TOKEN, OPENAI_API_KEY. Replaces BB Studio's values for OPENAI_API_KEY.");
    await act(async () => { button("Bring over with secrets")!.click(); });
    expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({ settings: [{ id: "env", replace: true }] });
  });

  it("says it works only in the app when there is no app token", async () => {
    vi.stubGlobal("bbDesktop", undefined);
    serve({ "GET /api/v1/fork/bring-over": () => json(listing) });
    await render();
    await act(async () => { await Promise.resolve(); });
    expect($('[data-testid="bring-over-app-only"]')?.textContent).toBe("Bringing things over works only in the BB Studio app on this Mac.");
    expect(button("Bring over")?.disabled).toBe(true);
    expect(button("Add…")).toBeUndefined();
  });

  it("says why it can't bring things over when the window is attached to a server the app did not start", async () => {
    fromApp = false;
    serve({ "GET /api/v1/fork/bring-over": () => json(listing) });
    await render();
    expect($('[data-testid="bring-over-attached"]')?.textContent).toContain("connected to a BB Studio server it did not start");
    expect($('[data-testid="bring-over-app-only"]')).toBeNull();
    expect(button("Read again")?.disabled).toBe(true);
    expect(button("Bring over")?.disabled).toBe(true);
    expect(button("Add…")).toBeUndefined();
  });

  it("sends the app's token to read bb and to cancel", async () => {
    let current: BringOverJob = job;
    serve({
      "GET /api/v1/fork/bring-over": () => json({ ...listing, job: current }),
      "POST /api/v1/fork/bring-over/jobs/current/cancel": () => { current = { ...job, state: "cancelled" }; return json({ job: current }); },
      "POST /api/v1/fork/bring-over/snapshot": () => json(listing),
    });
    await render();
    await act(async () => { button("Cancel")!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(calls.find((call) => call.url.endsWith("/cancel"))?.token).toBe("token-from-the-app");
    await act(async () => { button("Read again")!.click(); });
    expect(calls.find((call) => call.url.endsWith("/snapshot"))?.token).toBe("token-from-the-app");
  });

  it("after a bring-over, says the list is gone and how to get it back", async () => {
    serve({ "GET /api/v1/fork/bring-over": () => json({ available: true, sourceDataDir: "/Users/x/.bb", readAt: null, job: { ...job, state: "done", threadsDone: 40 } }) });
    await render();
    expect($('[data-testid="bring-over-read-again"]')?.textContent).toBe("The list of what bb has is cleared after each bring-over. Read bb again to see what's left and to add plugins.");
    expect(button("Read bb")?.disabled).toBe(false);
  });

  it("adds a plugin, and says when its source is gone or adding fails", async () => {
    let fail = true;
    serve({
      "GET /api/v1/fork/bring-over": () => json(listing),
      "POST /api/v1/fork/bring-over/plugins/acme-tool/add": () => (fail ? json({ message: "acme-tool could not be installed from /src/acme: no manifest" }, 422) : json({ id: "acme-tool", data: true })),
    });
    await render();
    expect($('[data-testid="bring-over-plugin-gone-tool"]')?.textContent).toContain("Not found here");
    expect($('[data-testid="bring-over-plugin-future-tool"]')?.textContent).toContain("Needs a newer BB Studio");
    const row = $('[data-testid="bring-over-plugin-acme-tool"]')!;
    act(() => { [...row.querySelectorAll("button")].find((each) => each.textContent === "Add…")!.click(); });
    expect(row.textContent).toContain("Installs code from /src/acme and copies its saved data, which may include sign-ins.");
    await act(async () => { [...row.querySelectorAll("button")].find((each) => each.textContent === "Add")!.click(); });
    expect(calls.find((call) => call.url.endsWith("/add"))).toBeDefined();
    expect($('[data-testid="bring-over-plugin-acme-tool"]')?.textContent).toContain("no manifest");
    fail = false;
    act(() => { [...row.querySelectorAll("button")].find((each) => each.textContent === "Add…")!.click(); });
    await act(async () => { [...row.querySelectorAll("button")].find((each) => each.textContent === "Add")!.click(); });
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
    resetUiTokenForTests();
    vi.stubGlobal("bbDesktop", { experimental_bringOverToken: async () => "token-from-the-app" });
    resetBringOverOfferForTests();
    localStorage.clear();
    welcome.threadId = "thr_first";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it("asks only for the light summary", async () => {
    const load = vi.fn(async () => new Response(JSON.stringify({ available: true, job: null }), { status: 200 }));
    vi.stubGlobal("fetch", load);
    await render("thr_first");
    expect(load).toHaveBeenCalledWith("/api/v1/fork/bring-over?summary=1");
  });

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
