// @vitest-environment jsdom
// Esc clears a search field first; only an empty field lets Escape close
// what is around it.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSearchEscape, searchEscape, useSearchEscape } from "./search-escape";

const key = (name: string, over: Record<string, unknown> = {}) => ({ key: name, preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: { blur: vi.fn() }, ...over });

describe("Escape in a search field", () => {
  it("clears a field with text and stops the key, so nothing around it closes", () => {
    const clear = vi.fn();
    const event = key("Escape");
    expect(handleSearchEscape(event, "retry", clear)).toBe(true);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("lets Escape through on an empty field, so the popover closes", () => {
    const clear = vi.fn();
    const event = key("Escape");
    expect(handleSearchEscape(event, "", clear)).toBe(false);
    expect(clear).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(event.currentTarget.blur).not.toHaveBeenCalled();
  });

  it("leaves an empty field that is in nothing, when asked to", () => {
    const event = key("Escape");
    searchEscape("", vi.fn(), { whenEmpty: "blur" })(event);
    expect(event.currentTarget.blur).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("ignores other keys, and Escape that only cancels an IME composition", () => {
    const clear = vi.fn();
    expect(handleSearchEscape(key("Enter"), "retry", clear)).toBe(false);
    expect(handleSearchEscape(key("Escape", { isComposing: true }), "retry", clear)).toBe(false);
    expect(handleSearchEscape(key("Escape", { nativeEvent: { isComposing: true } }), "retry", clear)).toBe(false);
    expect(clear).not.toHaveBeenCalled();
  });
});

describe("a search field inside a layer that closes on Escape", () => {
  let root: Root;
  let container: HTMLDivElement;
  // Stands for Radix's dismissable layer: it listens on the document, in the capture phase.
  const layerClosed = vi.fn();
  const layer = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) layerClosed(); };

  function Field() {
    const [query, setQuery] = useState("");
    const ref = useSearchEscape(query, () => setQuery(""));
    return <input ref={ref} aria-label="Find" value={query} onChange={(event) => setQuery(event.target.value)} />;
  }
  const input = () => container.querySelector("input")!;
  const type = async (text: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), text);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const press = async (name: string, target: Element = input()) => {
    await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
  };

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    layerClosed.mockClear();
    document.addEventListener("keydown", layer, true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<><Field /><button type="button">Other</button></>));
  });
  afterEach(() => {
    act(() => root.unmount());
    document.removeEventListener("keydown", layer, true);
    container.remove();
  });

  it("clears on the first Escape and closes the layer on the second", async () => {
    await type("retry");
    expect(input().value).toBe("retry");
    await press("Escape");
    expect(input().value).toBe("");
    expect(layerClosed).not.toHaveBeenCalled();
    await press("Escape");
    expect(layerClosed).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape pressed elsewhere in the layer alone", async () => {
    await type("retry");
    await press("Escape", container.querySelector("button")!);
    expect(input().value).toBe("retry");
    expect(layerClosed).toHaveBeenCalledTimes(1);
  });
});
