// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const welcome = vi.hoisted(() => ({ threadId: "thr_first" as string | null }));
vi.mock("./live", () => ({ useLive: () => ({ data: { threadId: welcome.threadId, opened: true, pending: false, bot: { id: "bot_1" } } }) }));

import { ImportNoticeBanner, importFailureFrom, readImportFailure, resetImportFailureForTests } from "./import-notice";

const MESSAGE = "BB Studio could not copy your bb data from /tmp/src/.bb in time, so it started without it. Your bb data there is unchanged.";
const failed = { imported: false, failure: { sourceDataDir: "/tmp/src/.bb", failedAt: 42, reason: "timed-out", message: MESSAGE } };

describe("importFailureFrom", () => {
  it("reads the failure", () => {
    expect(importFailureFrom(failed)).toEqual({ message: MESSAGE, failedAt: 42 });
  });
  it("is null when nothing failed or the answer is not one", () => {
    expect(importFailureFrom({ imported: false })).toBeNull();
    expect(importFailureFrom({ imported: true, failure: failed.failure })).toBeNull();
    expect(importFailureFrom({ imported: false, failure: { message: " " } })).toBeNull();
    expect(importFailureFrom(null)).toBeNull();
    expect(importFailureFrom("Not Found")).toBeNull();
  });
});

describe("readImportFailure", () => {
  beforeEach(() => resetImportFailureForTests());

  it("is null on a BB without the import routes", async () => {
    expect(await readImportFailure(async () => new Response("Not Found", { status: 404 }))).toBeNull();
  });
  it("is null when the request fails", async () => {
    expect(await readImportFailure(async () => { throw new TypeError("offline"); })).toBeNull();
  });
  it("asks once", async () => {
    const load = vi.fn(async () => new Response(JSON.stringify(failed), { status: 200 }));
    expect(await readImportFailure(load)).toEqual({ message: MESSAGE, failedAt: 42 });
    expect(await readImportFailure(load)).toEqual({ message: MESSAGE, failedAt: 42 });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("ImportNoticeBanner", () => {
  let root: Root;
  let host: HTMLDivElement;
  const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
  const answer = (body: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
  const render = async (threadId: string) => {
    await act(async () => { root.render(<ImportNoticeBanner threadId={threadId} />); });
    await act(async () => { await Promise.resolve(); });
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetImportFailureForTests();
    localStorage.clear();
    welcome.threadId = "thr_first";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it("shows the server's message on the first chat until dismissed", async () => {
    answer(failed);
    await render("thr_first");
    expect($('[data-testid="import-notice"]')?.textContent).toContain(MESSAGE);
    act(() => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Dismiss")!.click(); });
    expect($('[data-testid="import-notice"]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    await render("thr_first");
    expect($('[data-testid="import-notice"]')).toBeNull();
  });

  it("stays off other threads", async () => {
    answer(failed);
    await render("thr_other");
    expect($('[data-testid="import-notice"]')).toBeNull();
  });

  it("draws nothing when nothing failed or the route is missing", async () => {
    answer({ imported: true, sourceDataDir: "/tmp/src/.bb" });
    await render("thr_first");
    expect($('[data-testid="import-notice"]')).toBeNull();
    resetImportFailureForTests();
    answer("Not Found", 404);
    await render("thr_first");
    expect(host.innerHTML).toBe("");
  });
});
