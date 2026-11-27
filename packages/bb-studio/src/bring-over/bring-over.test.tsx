// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const welcome = vi.hoisted(() => ({ threadId: "thr_first" as string | null }));
vi.mock("../ui/live", () => ({ useLive: () => ({ data: { threadId: welcome.threadId, opened: true, pending: false, bot: { id: "bot_1" } } }) }));
vi.mock("../kit/app/nav", () => ({ openAppPath: vi.fn() }));
const rpc = vi.hoisted(() => {
  const state = { status: null as import("../studio-data/contract").StudioDataStatusView | null, client: null as unknown };
  state.client = { call: async () => state.status };
  return state;
});
vi.mock("@get-bb/plugin-sdk/app", async (original) => ({ ...(await original<object>()), useRpc: () => rpc.client }));

import { jobLine, presentRequired, readBringOver, requiredInBb, resetUiTokenForTests, secretLine, studioDataConfirm, type BringOverJob, type BringOverState, type BringOverStudioData, type StudioImportState } from "./api";
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
    expect(jobLine({ ...job, state: "done", threadsTotal: 1, threadsDone: 1, threadsSkipped: 0 })).toBe("Done: 1 of 1 thread");
  });
  it("names the secrets in one line", () => {
    const env = { id: "env", label: "Environment variables", detail: "", secret: true, count: 1, names: ["A"], alreadyHere: ["A"] };
    expect(secretLine(env, false)).toBe("Brings over 1 environment variable: A.");
    expect(secretLine(env, true)).toBe("Brings over 1 environment variable: A. Replaces BB Studio's values for A.");
  });
  it("FM: a Bot's Main deleted in bb is left out of what the bring-over requires, and an unreadable listing keeps them all", async () => {
    const thread = (id: string, archived = false) => ({ id, title: id, updatedAt: 1, archived, attachments: 0, here: false });
    expect(presentRequired(["thr_main", "thr_gone", "thr_old"], [thread("thr_main"), thread("thr_old", true)])).toEqual({ required: ["thr_main", "thr_old"], missing: ["thr_gone"] });
    expect(presentRequired(["thr_main"], { available: true })).toEqual({ required: ["thr_main"], missing: [] });
    const urls: string[] = [];
    const listed = await requiredInBb(["thr_main", "thr_gone"], async (url) => { urls.push(String(url)); return new Response(JSON.stringify([thread("thr_main")]), { status: 200 }); });
    expect(listed).toEqual({ required: ["thr_main"], missing: ["thr_gone"] });
    expect(urls).toEqual(["/api/v1/fork/bring-over/projects/proj_personal/threads"]);
    expect(await requiredInBb(["thr_main", "thr_gone"], async () => new Response("boom", { status: 500 }))).toEqual({ required: ["thr_main", "thr_gone"], missing: [] });
    expect(await requiredInBb(["thr_main"], async () => { throw new TypeError("offline"); })).toEqual({ required: ["thr_main"], missing: [] });
    const preview = { bots: 2, pages: 0, tasks: 0, memories: 0, threads: { required: ["thr_a", "thr_b"], wanted: ["thr_a", "thr_b", "thr_c"] }, minisWithSecrets: 0, watchersWithEnv: 0, problem: null };
    expect(studioDataConfirm(preview).join(" ")).not.toContain("deleted in bb");
    expect(studioDataConfirm(preview, 2).join(" ")).toContain("2 Bots' Main conversations were deleted in bb; those Bots get a new Main here.");
    expect(studioDataConfirm(preview, 2)[0]).toContain("and 1 thread.");
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
    expect($('[data-testid="bring-over-project"]')?.textContent).toContain("2 threads");
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

  it("counts one thread as one thread", async () => {
    serve({ "GET /api/v1/fork/bring-over": () => json({ ...listing, projects: [{ ...listing.projects![0], threads: 1 }] }) });
    await render();
    expect($('[data-testid="bring-over-project"]')?.textContent).toContain("1 thread ·");
    expect($('[data-testid="bring-over-project"]')?.textContent).not.toContain("1 threads");
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

  it("offers Agent Plugins as an import into Tool Gateway, never as a plugin to add", async () => {
    let staged = 0;
    serve({
      "GET /api/v1/fork/bring-over": () => json({ ...listing, plugins: [{ id: "agent-plugins", version: "0.4.0", source: "bb-plugins", sourceKind: "git", enabled: true, hasData: true, here: false, sourceMissing: false }] }),
      "POST /api/v1/fork/bring-over/tool-gateway/stage": () => { staged += 1; return json({ staged: "x" }); },
    });
    await render();
    const row = $('[data-testid="bring-over-plugin-agent-plugins"]')!;
    expect(row.textContent).toContain("Import into Tool Gateway");
    expect(button("Add…")).toBeUndefined();
    const opened = vi.fn();
    globalThis.addEventListener("studio-tool-gateway-import", opened);
    await act(async () => { button("Import into Tool Gateway")!.click(); });
    globalThis.removeEventListener("studio-tool-gateway-import", opened);
    expect(staged).toBe(1);
    expect(calls.find((call) => call.url.endsWith("/tool-gateway/stage"))?.token).toBe("token-from-the-app");
    expect(opened).toHaveBeenCalledTimes(1);
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
    expect(row.textContent).toContain("Installs code from /src/acme");
    expect(row.textContent).not.toContain("no manifest");
    await act(async () => { [...row.querySelectorAll("button")].find((each) => each.textContent === "Add")!.click(); });
    expect($('[data-testid="bring-over-plugin-acme-tool"]')?.textContent).toContain("Added with its data");
  });
});

describe("BB Studio data row", () => {
  let root: Root;
  let host: HTMLDivElement;
  const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
  const button = (text: string) => [...host.querySelectorAll("button")].find((each) => each.textContent === text);
  const text = () => $('[data-testid="bring-over-studio-data"]')?.textContent ?? "";
  const preview = { bots: 3, pages: 14, tasks: 6, memories: 40, threads: { required: ["thr_main"], wanted: ["thr_main", "thr_conv", "thr_worker"] }, minisWithSecrets: 1, watchersWithEnv: 2, problem: null };
  const server = (journal: BringOverStudioData["journal"]): BringOverStudioData => ({ inBb: true, bots: 3, pages: 14, tasks: 6, journal });
  const journal = (state: Exclude<StudioImportState, "unreadable">, extra: object = {}) => ({ state, error: null, stagedAt: 1, ...extra });
  let calls: { url: string; method: string; body: unknown; token: string | null }[] = [];
  let gateMatches = true;
  /** read: what GET /studio-data answers; null answers 404, as BB Studio 1.0.8 and older do. */
  function serve(read: () => BringOverStudioData | null) {
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null, token: new Headers(init?.headers).get("x-bb-studio-ui-token") });
      if (url.endsWith("/gate")) return new Response(JSON.stringify({ fromApp: true, matches: gateMatches }), { status: 200 });
      if (url.endsWith("/studio-data") && method === "GET") {
        const data = read();
        return data ? new Response(JSON.stringify(data), { status: 200 }) : new Response("Not Found", { status: 404 });
      }
      if (url.endsWith("/studio-data")) return new Response(JSON.stringify({ studioData: read() }), { status: 200 });
      if (url.includes("/studio-data/")) return new Response(null, { status: 204 });
      if (url.endsWith("/jobs")) return new Response(JSON.stringify({ ...job, threadsTotal: 3, threadsDone: 0 }), { status: 202 });
      return new Response(JSON.stringify({ available: true, sourceDataDir: "/b", readAt: null, job: null }), { status: 200 });
    }));
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetUiTokenForTests();
    vi.stubGlobal("bbDesktop", { experimental_bringOverToken: async () => "token-from-the-app" });
    gateMatches = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); }); };

  it("is hidden on a BB Studio without the route, while the rest of the page shows", async () => {
    rpc.status = { ownData: { has: false }, journal: null, keptIn: null, preview: null };
    serve(() => null);
    await act(async () => { root.render(<BringOverSection />); });
    await settle();
    expect($('[data-testid="bring-over-source"]')).not.toBeNull();
    expect($('[data-testid="bring-over-studio-data"]')).toBeNull();
    expect(host.textContent).not.toContain("BB Studio data");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("is hidden when the route answers in a shape it doesn't know", async () => {
    rpc.status = { ownData: { has: false }, journal: null, keptIn: null, preview: null };
    serve(() => ({ inBb: true, bots: 3 }) as unknown as BringOverStudioData);
    await act(async () => { root.render(<BringOverSection />); });
    await settle();
    expect($('[data-testid="bring-over-studio-data"]')).toBeNull();
  });

  it("offers no action when the window's token doesn't pass the server's gate", async () => {
    gateMatches = false;
    rpc.status = { ownData: { has: false }, journal: null, keptIn: null, preview: null };
    serve(() => server(null));
    await act(async () => { root.render(<BringOverSection />); });
    await settle();
    expect(text()).toContain("3 Bots · 14 pages · 6 tasks");
    expect(button("Bring over…")).toBeUndefined();
    expect($('[data-testid="bring-over-attached"]')).not.toBeNull();
  });

  it("clears the last error when a new confirm step opens", async () => {
    let fail = true;
    rpc.status = { ownData: { has: false }, journal: journal("applied"), keptIn: "/data/plugins/studio/import-staged/before", preview: null };
    serve(() => server(journal("applied", { appliedAt: Date.now() })));
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => (url.endsWith("/studio-data/forget") && fail ? new Response(JSON.stringify({ message: "folder busy" }), { status: 409 }) : base(url, init))));
    await act(async () => { root.render(<BringOverSection />); });
    await settle();
    act(() => { button("Delete old data…")!.click(); });
    await act(async () => { button("Delete it")!.click(); });
    await settle();
    expect(text()).toContain("folder busy");
    fail = false;
    act(() => { button("Put my old Studio data back…")!.click(); });
    expect(text()).toContain("next time BB Studio starts");
    expect(text()).not.toContain("folder busy");
  });

  it("copies bb's Studio data, says plainly what it replaces, then brings the Bots' threads over as a job", async () => {
    let state = server(null);
    rpc.status = { ownData: { has: false }, journal: null, keptIn: null, preview: null };
    serve(() => state);
    await act(async () => { root.render(<BringOverSection />); });
    await settle();
    expect(text()).toContain("3 Bots · 14 pages · 6 tasks");
    state = server(journal("staged"));
    rpc.status = { ...rpc.status!, journal: journal("staged"), preview };
    await act(async () => { button("Bring over…")!.click(); });
    await settle();
    expect(calls.filter((call) => call.method === "POST").map((call) => [call.url, call.token])).toEqual([["/api/v1/fork/bring-over/studio-data", "token-from-the-app"]]);
    for (const words of ["Project leads' heartbeats are off too", "Replaces everything in BB Studio's Studio", "3 Bots, 14 pages, 6 tasks, 40 memories, and 3 threads", "kept in a folder, not deleted", "arrive stopped", "stop it in bb so it doesn't run twice", "API keys in 1 mini app and environment values in 2 watchers", "quit and reopen BB Studio"]) expect(text()).toContain(words);
    await act(async () => { button("Bring over")!.click(); });
    await settle();
    expect(calls.find((call) => call.url.endsWith("/jobs"))).toMatchObject({ method: "POST", token: "token-from-the-app", body: { picks: [{ kind: "thread", id: "thr_main" }, { kind: "thread", id: "thr_conv" }, { kind: "thread", id: "thr_worker" }], settings: [], studioData: { required: ["thr_main"] } } });
    expect($('[data-testid="bring-over-job"]')?.textContent).toContain("0 of 3 threads");
  });

  it("FM: a Bot's Main deleted in bb doesn't block bringing Studio data over; it is left out and its Bot gets a new Main here", async () => {
    const gonePreview = { ...preview, threads: { required: ["thr_main", "thr_gone"], wanted: ["thr_main", "thr_gone", "thr_conv"] } };
    rpc.status = { ownData: { has: false }, journal: journal("staged"), keptIn: null, preview: gonePreview };
    serve(() => server(journal("staged")));
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/fork/bring-over/projects/proj_personal/threads") {
        calls.push({ url, method: "GET", body: null, token: null });
        return new Response(JSON.stringify([{ id: "thr_main", title: "Main", updatedAt: 1, archived: true, attachments: 0, here: false }, { id: "thr_conv", title: "c", updatedAt: 1, archived: false, attachments: 0, here: false }]), { status: 200 });
      }
      return base(url, init);
    }));
    await act(async () => { root.render(<BringOverSection />); });
    await settle();
    expect(text()).toContain("1 Bot's Main conversation was deleted in bb; that Bot gets a new Main here.");
    expect(text()).toContain("and 2 threads");
    await act(async () => { button("Bring over")!.click(); });
    await settle();
    expect(calls.find((call) => call.url.endsWith("/jobs"))).toMatchObject({ method: "POST", body: { picks: [{ kind: "thread", id: "thr_main" }, { kind: "thread", id: "thr_conv" }], studioData: { required: ["thr_main"] } } });
  });

  it("FM: when bb's threads can't be listed, the confirm step says nothing about deleted Mains and asks for every Bot's thread, as before", async () => {
    rpc.status = { ownData: { has: false }, journal: journal("staged"), keptIn: null, preview };
    serve(() => server(journal("staged")));
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => (url.includes("/projects/") ? new Response("boom", { status: 500 }) : base(url, init))));
    await act(async () => { root.render(<BringOverSection />); });
    await settle();
    expect(text()).not.toContain("deleted in bb");
    await act(async () => { button("Bring over")!.click(); });
    await settle();
    expect(calls.find((call) => call.url.endsWith("/jobs"))).toMatchObject({ body: { picks: [{ kind: "thread", id: "thr_main" }, { kind: "thread", id: "thr_conv" }, { kind: "thread", id: "thr_worker" }], studioData: { required: ["thr_main"] } } });
  });

  it("is not offered while this install's Studio has data of its own, and says why", async () => {
    rpc.status = { ownData: { has: true, reason: "it has 2 pages" }, journal: null, keptIn: null, preview: null };
    serve(() => server(null));
    await act(async () => { root.render(<BringOverSection />); });
    await settle();
    expect(text()).toContain("already has data of its own (it has 2 pages)");
    expect(text()).toContain("bb's projects and threads can still come over below");
    expect(button("Bring over…")).toBeUndefined();
  });

  it("asks for a restart once ready, then offers to put the old data back or delete it, asking first", async () => {
    let state = server(journal("ready"));
    rpc.status = { ownData: { has: false }, journal: journal("ready"), keptIn: null, preview: null };
    serve(() => state);
    await act(async () => { root.render(<BringOverSection />); });
    await settle();
    expect(text()).toContain("Quit and reopen BB Studio to finish");
    act(() => root.unmount());
    root = createRoot(host);
    state = server(journal("applied", { appliedAt: Date.now() }));
    rpc.status = { ownData: { has: false }, journal: journal("applied"), keptIn: "/data/plugins/studio/import-staged/before", preview: null };
    await act(async () => { root.render(<BringOverSection />); });
    await settle();
    expect(text()).toContain("bb's Bots are stopped here");
    expect(text()).toContain("kept in /data/plugins/studio/import-staged/before");
    act(() => { button("Put my old Studio data back…")!.click(); });
    expect(calls.some((call) => call.url.includes("put-back"))).toBe(false);
    expect(text()).toContain("next time BB Studio starts");
    await act(async () => { button("Put it back")!.click(); });
    expect(calls.find((call) => call.url.endsWith("/studio-data/put-back"))).toMatchObject({ method: "POST", token: "token-from-the-app" });
  });

  it("says what deleting bb's copy takes with it after a put-back", async () => {
    rpc.status = { ownData: { has: false }, journal: journal("restored"), keptIn: "/data/plugins/studio/import-staged/replaced", preview: null };
    serve(() => server(journal("restored")));
    await act(async () => { root.render(<BringOverSection />); });
    await settle();
    expect(text()).toContain("Your old Studio data is back");
    act(() => { button("Delete bb's copy…")!.click(); });
    expect(text()).toContain("anything you made in Studio while it was in use");
    await act(async () => { button("Delete it")!.click(); });
    expect(calls.find((call) => call.url.endsWith("/studio-data/forget"))).toMatchObject({ method: "POST" });
  });

  it("shows a failure and offers to discard the copy", async () => {
    rpc.status = { ownData: { has: false }, journal: journal("refused"), keptIn: null, preview: null };
    serve(() => server(journal("refused", { error: "bb runs a newer BB Studio than this one" })));
    await act(async () => { root.render(<BringOverSection />); });
    await settle();
    expect(text()).toContain("newer BB Studio");
    await act(async () => { button("Discard")!.click(); });
    expect(calls.find((call) => call.url.endsWith("/studio-data/discard"))).toMatchObject({ method: "POST" });
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
