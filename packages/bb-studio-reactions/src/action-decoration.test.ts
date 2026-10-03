// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { mountActionDecoration } from "./action-decoration";
import { menuSettings } from "./settings";

const icon = '<span data-plugin-icon-asset="/api/v1/plugins/emoji-react/assets/icon?h=1"></span>';
afterEach(() => { document.body.replaceChildren(); });

it("only decorates positively identified reaction actions and restores their icons", () => {
  document.body.innerHTML = `<button id="foreign" aria-label="👍">👍</button><button id="action" aria-label="👍">${icon}</button><button id="selection">${icon}👍</button>`;
  const before = document.body.innerHTML;
  const controller = new AbortController();
  const dispose = mountActionDecoration(menuSettings(), controller.signal);
  expect(document.querySelector("#action [data-emoji-react-glyph]")?.textContent).toBe("👍");
  expect(document.querySelector("#selection [data-plugin-icon-asset]")).toBeNull();
  expect(document.querySelector("#foreign")?.outerHTML).toBe('<button id="foreign" aria-label="👍">👍</button>');
  controller.abort();
  dispose();
  expect(document.body.innerHTML).toBe(before);
});

it("hides only configured surfaces and restores pre-existing visibility on abort", () => {
  document.body.innerHTML = `<div data-message-role="user"><button id="user" aria-label="👍" style="display:inline-flex">${icon}</button></div><div data-role="assistant"><button id="assistant" aria-label="👍">${icon}</button></div><button id="unknown" aria-label="👍">${icon}</button>`;
  const controller = new AbortController();
  mountActionDecoration(menuSettings({ showInUserBar: false }), controller.signal);
  expect((document.querySelector("#user") as HTMLButtonElement).hidden).toBe(true);
  expect((document.querySelector("#assistant") as HTMLButtonElement).hidden).toBe(false);
  expect((document.querySelector("#unknown") as HTMLButtonElement).hidden).toBe(false);
  controller.abort();
  const user = document.querySelector("#user") as HTMLButtonElement;
  expect(user.hidden).toBe(false);
  expect(user.style.display).toBe("inline-flex");
});

it("does not undo host visibility changes it did not make", () => {
  document.body.innerHTML = `<button aria-label="👍">${icon}</button>`;
  const controller = new AbortController();
  mountActionDecoration(menuSettings(), controller.signal);
  const button = document.querySelector("button")!;
  button.style.display = "none";
  button.hidden = true;
  controller.abort();
  expect(button.hidden).toBe(true);
  expect(button.style.display).toBe("none");
  expect(button.querySelector("[data-plugin-icon-asset]")).not.toBeNull();
});

it("never mounts after its generation has been aborted", () => {
  document.body.innerHTML = `<button aria-label="👍">${icon}</button>`;
  const before = document.body.innerHTML;
  const controller = new AbortController();
  controller.abort();
  mountActionDecoration(menuSettings(), controller.signal);
  expect(document.body.innerHTML).toBe(before);
});
