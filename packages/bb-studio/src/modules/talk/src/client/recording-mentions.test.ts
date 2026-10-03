// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { linkRecordingMentions } from "./recording-mentions";

let controller: AbortController;
afterEach(() => { controller?.abort(); document.body.innerHTML = ""; });

function pill(resource: unknown = { kind: "plugin", pluginId: "talk", itemId: "recordings:rec_aaaaaaaa" }) {
  const element = document.createElement("span");
  element.setAttribute("data-prompt-mention", "true");
  element.setAttribute("data-prompt-mention-resource", JSON.stringify(resource));
  element.innerHTML = "<span>Dictation</span>";
  document.body.append(element);
  return element;
}

function start() {
  controller = new AbortController();
  const open = vi.fn();
  linkRecordingMentions(open, controller.signal);
  return open;
}

describe("saved recording pills", () => {
  it("opens the saved source by clicking its label or using the keyboard", () => {
    const element = pill(); const open = start();
    expect(element.getAttribute("role")).toBe("link");
    expect(element.tabIndex).toBe(0);
    (element.firstChild as HTMLElement).click();
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(open.mock.calls).toEqual(Array(3).fill(["/plugins/studio/recordings/rec_aaaaaaaa"]));
  });

  it("leaves drafts, other plugins, malformed references, and native links alone", () => {
    const draft = pill(); const editor = document.createElement("div"); editor.contentEditable = "true";
    editor.setAttribute("contenteditable", "true"); document.body.append(editor); editor.append(draft);
    const other = pill({ kind: "plugin", pluginId: "pages", itemId: "recordings:rec_aaaaaaaa" });
    const invalid = pill({ kind: "plugin", pluginId: "talk", itemId: "recordings:../../secret" });
    const broken = pill(); broken.setAttribute("data-prompt-mention-resource", "{");
    const native = pill(); const anchor = document.createElement("a"); document.body.append(anchor); anchor.append(native);
    const open = start();
    for (const element of [draft, other, invalid, broken, native]) {
      element.click(); expect(element.hasAttribute("data-talk-recording-link")).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it("links newly rendered messages and restores pills on unload", async () => {
    const open = start(); const element = pill();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(element.getAttribute("role")).toBe("link");
    controller.abort();
    expect(element.hasAttribute("role")).toBe(false);
    expect(element.hasAttribute("tabindex")).toBe(false);
    expect(element.hasAttribute("data-talk-recording-link")).toBe(false);
    element.click(); expect(open).not.toHaveBeenCalled();
  });
});
