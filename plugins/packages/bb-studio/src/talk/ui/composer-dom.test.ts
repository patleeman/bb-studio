// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPOSER_REFERENCE_EVENT, findComposer, insertDictationIntoComposer, interceptBuiltInMic } from "./composer-dom";

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
    expect(target.textContent).toContain("[Brain dump](/plugins/studio/studio/recordings/rec_aaaaaaaa)");
  });

  it("does not attach anything without a connected destination or transcript", async () => {
    const target = composer(); const listener = vi.fn(); target.addEventListener(COMPOSER_REFERENCE_EVENT, listener);
    expect(await insertDictationIntoComposer(target, "", [recording])).toBe(false);
    target.remove();
    expect(await insertDictationIntoComposer(target, "Text", [recording])).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("findComposer", () => {
  it("prefers the focused composer over a later one on screen", () => {
    const boxes = [0, 1].map(() => {
      const box = document.createElement("form");
      box.setAttribute("data-promptbox", "");
      box.innerHTML = '<div contenteditable="true" tabindex="0"></div>';
      Object.defineProperty(box, "offsetParent", { value: document.body });
      document.body.append(box);
      return box;
    });
    (boxes[0]!.firstElementChild as HTMLElement).focus();
    expect(findComposer()).toBe(boxes[0]);
    (document.activeElement as HTMLElement).blur();
    expect(findComposer()).toBe(boxes[1]);
  });
});

describe("interceptBuiltInMic", () => {
  it("claims a composer mic button and skips full-document scans on unrelated streaming mutations", async () => {
    const box = document.createElement("form");
    box.setAttribute("data-promptbox", "");
    const mic = document.createElement("button");
    mic.setAttribute("aria-label", "Start voice input");
    box.append(mic);
    document.body.append(box);

    const ctrl = new AbortController();
    let listener = () => {};
    let mode: "idle" | "active" = "idle";
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
    interceptBuiltInMic({
      enabled: () => true,
      stateFor: () => ({ mode, title: mode === "active" ? "Stop dictation" : "Dictate" }),
      onPress: vi.fn(),
      subscribe: (fn) => { listener = fn; return () => {}; },
    }, ctrl.signal);

    expect(mic.hasAttribute("data-talk-mic")).toBe(true);
    expect(mic.title).toBe("Dictate");

    const qsa = vi.spyOn(document, "querySelectorAll");
    const msg = document.createElement("p");
    msg.textContent = "Streaming chunk";
    document.body.append(msg);
    await new Promise((r) => setTimeout(r, 0));
    expect(qsa).not.toHaveBeenCalled();

    mode = "active";
    listener();
    expect(mic.hasAttribute("data-talk-dictating")).toBe(true);
    expect(mic.title).toBe("Stop dictation");
    expect(qsa).not.toHaveBeenCalled();

    ctrl.abort();
  });
});
