// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { installOverlayModality, isLastInputKeyboard } from "./overlay-trigger";

afterEach(() => {
  installOverlayModality();
});

it("tracks input modality and replaces prior listeners on reinstall without stacking", () => {
  const disposeFirst = installOverlayModality();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
  expect(isLastInputKeyboard()).toBe(true);
  document.dispatchEvent(new Event("pointerdown"));
  expect(isLastInputKeyboard()).toBe(false);

  // Reinstalling tears down the previous AbortController and stops its listeners.
  const addSpy = vi.spyOn(document, "addEventListener");
  const disposeSecond = installOverlayModality();
  expect(addSpy).toHaveBeenCalledTimes(2);
  addSpy.mockRestore();

  // Disposing the current installation stops tracking until reinstalled.
  disposeSecond();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  expect(isLastInputKeyboard()).toBe(false);
  // Calling an already-replaced dispose is a safe no-op.
  disposeFirst();
});
