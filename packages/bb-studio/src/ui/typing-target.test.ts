// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { isTypingTarget, keyInScope } from "./typing-target";

afterEach(() => { document.body.innerHTML = ""; });

/** Dispatches a Space keydown and asks a window listener, as global shortcuts do, during dispatch. */
const typing = (target: EventTarget, init: KeyboardEventInit = {}) => {
  let seen: boolean | null = null;
  window.addEventListener("keydown", (event) => { seen = isTypingTarget(event); }, { once: true });
  target.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, composed: true, ...init }));
  return seen;
};

const add = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host.firstElementChild as HTMLElement;
};

it.each([
  ["an input", "<input>"],
  ["a textarea", "<textarea></textarea>"],
  ["a select", "<select><option>a</option></select>"],
  ["a contenteditable", "<div contenteditable='true'></div>"],
  ["a plaintext-only contenteditable", "<div contenteditable='plaintext-only'></div>"],
  ["a textbox", "<div role='textbox' tabindex='0'></div>"],
  ["a combobox", "<div role='combobox' tabindex='0'></div>"],
])("is true for a key in %s", (_, html) => {
  expect(typing(add(html))).toBe(true);
});

it("is true inside a contenteditable", () => {
  const editor = add("<div contenteditable><p><span>text</span></p></div>");
  expect(typing(editor.querySelector("span")!)).toBe(true);
});

it("is true when focus is in a field even if the target is elsewhere", () => {
  add("<input id='field'>");
  (document.getElementById("field") as HTMLInputElement).focus();
  expect(isTypingTarget({ target: document.body })).toBe(true);
});

it("is true while an IME composes", () => {
  expect(typing(document.body, { isComposing: true })).toBe(true);
  expect(isTypingTarget({ target: document.body, keyCode: 229 })).toBe(true);
});

it("is false for the body, buttons, plain elements and contenteditable=false", () => {
  expect(typing(document.body)).toBe(false);
  expect(typing(add("<button>Go</button>"))).toBe(false);
  expect(typing(add("<div tabindex='0'>canvas</div>"))).toBe(false);
  expect(typing(add("<div contenteditable='false'>x</div>"))).toBe(false);
});

it("sees through an open shadow root", () => {
  const host = add("<div></div>");
  const input = document.createElement("input");
  host.attachShadow({ mode: "open" }).append(input);
  expect(typing(input)).toBe(true);
});

it("keyInScope: body or inside the scope, not elsewhere", () => {
  const scope = add("<div><span></span></div>");
  const other = add("<div></div>");
  expect(keyInScope(document.body, scope)).toBe(true);
  expect(keyInScope(scope.querySelector("span"), scope)).toBe(true);
  expect(keyInScope(other, scope)).toBe(false);
});
