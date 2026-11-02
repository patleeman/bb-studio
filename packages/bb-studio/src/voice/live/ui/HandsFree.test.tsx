// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => {
  const rpc = { call: vi.fn() };
  return { experimental_Icon: () => null, useSdk: () => ({}), useComposer: () => ({ scope: { kind: "thread", threadId: "thr_1" } }), useRpc: () => rpc, useBbNavigate: () => ({}), useRealtime: () => {} };
});
vi.mock("../../../kit/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../kit/ui")>()),
  Icon: ({ name, className }: { name: string; className?: string }) => <span data-icon={name} className={className} />,
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
}));
// A session that's live as soon as it starts, without a server or a mic.
vi.mock("./session", () => ({
  LiveSession: class {
    machine = { isLive: false };
    trace = [];
    snapshot = 0;
    private listeners = new Set<() => void>();
    subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    start() { this.machine = { isLive: true }; this.snapshot++; for (const listener of this.listeners) listener(); }
  },
}));

import { COMPOSER_BUTTON } from "../../../kit/app/index";
import { HandsFreeComposerButton, handsFreeButtonClass } from "./HandsFree";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const button = () => host.querySelector<HTMLButtonElement>('[data-testid="handsfree-composer"]')!;

describe("the composer's hands-free button", () => {
  it("is the mic's ghost button: 32px, rounded-md, a 16px glyph, never a filled circle", () => {
    expect(COMPOSER_BUTTON).toContain("size-8");
    expect(COMPOSER_BUTTON).toContain("rounded-md");
    expect(COMPOSER_BUTTON).toContain("[&_[data-icon-root]]:size-4");
    expect(handsFreeButtonClass(false)).toBe(COMPOSER_BUTTON);
    act(() => root.render(<HandsFreeComposerButton />));
    expect(button().className).toBe(COMPOSER_BUTTON);
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(button().querySelector('[data-icon="studio/handsfree"]')?.className).toBe("size-4");
  });

  it("only tints the glyph with the accent while a session is live", () => {
    act(() => root.render(<HandsFreeComposerButton />));
    act(() => button().click());
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(button().getAttribute("aria-label")).toBe("Hands-free voice is on");
    const live = button().className;
    expect(live).toContain("text-orange-600");
    expect(live).toContain("dark:text-orange-400");
    expect(live.startsWith(COMPOSER_BUTTON)).toBe(true);
    // No fill, no circle: the button keeps the mic's shape and background.
    expect(live).not.toMatch(/(^|\s)(rounded-full|bg-|aria-pressed:bg-)/);
  });
});
