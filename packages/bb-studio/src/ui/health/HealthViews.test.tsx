// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  summary: { problems: [{ key: "studio:broken", hidden: false, lasting: true }] },
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./use-health", () => ({ useHealth: () => ({ summary: state.summary }) }));

const { HealthWatch, setHealthFooter } = await import("./HealthViews");

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it("opens the health footer when storing seen problems fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setHealthFooter({ open: state.open, close: state.close });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(<HealthWatch />); });
  await act(async () => {
    state.summary = { problems: [{ key: "studio:broken", hidden: false, lasting: true }] };
    root.render(<HealthWatch />);
  });
  expect(state.open).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
