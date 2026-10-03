// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPOSER_REFERENCE_EVENT, insertDictationIntoComposer } from "./composer-dom";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function composer() {
  const box = document.createElement("form");
  box.setAttribute("data-promptbox", "");
  box.innerHTML = '<div contenteditable="true" tabindex="0">Existing draft.</div>';
  document.body.append(box);
  const editor = box.firstElementChild as HTMLElement;
  editor.focus();
  const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn((_command, _showUi, text) => {
    const editor = document.activeElement;
    editor?.append(document.createTextNode(text));
    return true;
  }) });
  return box;
}

const recording = { id: "rec_aaaaaaaa", title: "Brain dump", kind: "dictation" as const };

describe("dictation source delivery", () => {
  it("targets the same composer with only a native reference", async () => {
    const target = composer();
    const elsewhere = document.createElement("form"); document.body.append(elsewhere);
    const wrong = vi.fn(); elsewhere.addEventListener(COMPOSER_REFERENCE_EVENT, wrong);
    const references: unknown[] = [];
    target.addEventListener(COMPOSER_REFERENCE_EVENT, (event) => {
      references.push((event as CustomEvent).detail.recording); event.preventDefault();
    });
    expect(await insertDictationIntoComposer(target, "My thought.", [recording])).toBe(true);
    expect(target.textContent).toContain("Existing draft. My thought.");
    expect(target.textContent).toBe("Existing draft. My thought.");
    expect(references).toEqual([recording]); expect(wrong).not.toHaveBeenCalled();
  });

  it("falls back to a Studio link when no native composer bridge exists", async () => {
    const target = composer();
    expect(await insertDictationIntoComposer(target, "My thought.", [recording])).toBe(true);
    expect(target.textContent).toContain("[Brain dump](/plugins/studio/recordings/rec_aaaaaaaa)");
  });

  it("does not attach anything without a connected destination or transcript", async () => {
    const target = composer(); const listener = vi.fn(); target.addEventListener(COMPOSER_REFERENCE_EVENT, listener);
    expect(await insertDictationIntoComposer(target, "", [recording])).toBe(false);
    target.remove();
    expect(await insertDictationIntoComposer(target, "Text", [recording])).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
});
