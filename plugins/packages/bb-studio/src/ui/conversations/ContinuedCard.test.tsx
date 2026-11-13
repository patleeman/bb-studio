// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { continuedFallback } from "../../continue-shared";

const state = vi.hoisted(() => ({ info: null as Record<string, unknown> | null, toThread: vi.fn(), asked: [] as unknown[] }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toThread: state.toThread }) }));
vi.mock("../live", () => ({
  useLive: (method: string, input: unknown, options: { enabled?: boolean }) => {
    if (options.enabled !== false) state.asked.push([method, input]);
    return { data: state.info ? { info: state.info } : null, error: null, loading: false, refresh: () => {} };
  },
}));
vi.mock("../../kit/app/index", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));

const { ContinuedCard, fallbackAfter } = await import("./ContinuedCard");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.info = null;
  state.asked = [];
  state.toThread.mockReset();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => { act(() => root?.unmount()); host.remove(); });

function message(after: string): { mount: HTMLElement; next: HTMLElement | null } {
  host.innerHTML = `<div class="mount"></div>${after}`;
  const mount = host.querySelector<HTMLElement>(".mount")!;
  return { mount, next: mount.nextElementSibling as HTMLElement | null };
}

function render(mount: HTMLElement, attributes: Record<string, string>) {
  root = createRoot(mount);
  act(() => root.render(<ContinuedCard attributes={attributes} source="" message={{ id: "m1", threadId: "thr_main", turnId: null, projectId: null } as never} openWorkspaceFile={null} />));
}

const linkHtml = (threadId: string, title: string) => {
  const md = continuedFallback(threadId, title);
  const [, text, href] = md.match(/^\[(.+)\]\((.+)\)$/)!;
  return `<p><a href="${href}">${text}</a></p>`;
};

it("shows the new conversation's live title and opens it", () => {
  state.info = { title: "HUD redesign v2", archivedAt: null, needsYou: null };
  const { mount } = message("");
  render(mount, { to: "thr_hud", title: "HUD redesign" });
  const card = host.querySelector<HTMLButtonElement>('[data-testid="continued-card"]')!;
  expect(card.textContent).toContain("Continued in");
  expect(host.querySelector('[data-testid="continued-title"]')!.textContent).toBe("HUD redesign v2");
  expect(state.asked).toContainEqual(["bot_thread_info", { threadId: "thr_hud" }]);
  act(() => card.click());
  expect(state.toThread).toHaveBeenCalledWith("thr_hud");
});

it("falls back to the title it was given, and draws nothing for a bad id", () => {
  const { mount } = message("");
  render(mount, { to: "thr_hud", title: "HUD redesign" });
  expect(host.querySelector('[data-testid="continued-title"]')!.textContent).toBe("HUD redesign");
  act(() => root.unmount());
  const again = message("");
  render(again.mount, { to: "../etc" });
  expect(host.querySelector('[data-testid="continued-card"]')).toBeNull();
});

it("hides the plain link under it on desktop, and only that link", () => {
  const { mount, next } = message(linkHtml("thr_hud", "HUD redesign"));
  render(mount, { to: "thr_hud", title: "HUD redesign" });
  expect(next!.hidden).toBe(true);
  act(() => root.unmount());
  expect(next!.hidden).toBe(false);

  const other = message(linkHtml("thr_other", "HUD redesign"));
  render(other.mount, { to: "thr_hud" });
  expect(other.next!.hidden).toBe(false);
  act(() => root.unmount());

  const prose = message('<p>See <a href="/threads/thr_hud">the HUD</a> for more.</p>');
  render(prose.mount, { to: "thr_hud" });
  expect(prose.next!.hidden).toBe(false);
});

it("finds the link after the host's wrappers around the card", () => {
  host.innerHTML = `<div class="outer"><div class="inner"><span class="card"></span></div></div>${linkHtml("thr_hud", "HUD")}`;
  expect(fallbackAfter(host.querySelector(".card")!, "thr_hud")).toBe(host.querySelector("p"));
  host.innerHTML = `<div><span class="card"></span></div><ul><li><a href="/threads/thr_hud">x</a></li></ul>`;
  expect(fallbackAfter(host.querySelector(".card")!, "thr_hud")).toBeNull();
});
