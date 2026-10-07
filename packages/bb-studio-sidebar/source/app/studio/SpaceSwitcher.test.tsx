// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSpaceSwitchGestures } from "./SpaceSwitcher.js";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function setup() {
  const step = vi.fn();
  renderHook(() => useSpaceSwitchGestures({ current: null }, step));
  const press = (target: EventTarget, init: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true, altKey: true, bubbles: true, cancelable: true, ...init }));
  return { step, press };
}

describe("⌃⌥ arrows", () => {
  it("step through the Spaces from outside text fields", () => {
    const { step, press } = setup();
    press(document.body);
    expect(step).toHaveBeenCalledWith(1);
  });

  it("leave inputs, textareas, editable elements and IME compositions alone", () => {
    const { step, press } = setup();
    const input = document.body.appendChild(document.createElement("input"));
    const textarea = document.body.appendChild(document.createElement("textarea"));
    const editor = document.body.appendChild(document.createElement("div"));
    editor.setAttribute("contenteditable", "true");
    const inside = editor.appendChild(document.createElement("span"));
    press(input);
    press(textarea);
    press(inside);
    press(document.body, { isComposing: true });
    expect(step).not.toHaveBeenCalled();
  });
});
