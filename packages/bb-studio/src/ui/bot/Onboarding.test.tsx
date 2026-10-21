// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../../pages/ui/talk", () => ({
  TALK_FIELD_ATTR: "data-talk-field", TALK_FIELD_LABEL_ATTR: "data-talk-label", TALK_INSERT_EVENT: "talk-insert",
  toggleTalk: () => {}, useTalk: () => ({ mode: "unavailable", phase: null }),
}));
vi.mock("../../kit/ui/index", () => ({ Icon: () => null }));

const { IDEAS, Welcome } = await import("./Onboarding");
const look = { shape: "blob", color: "#5b8def", emoji: "🤖" };

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const button = (label: string) => [...container.querySelectorAll("button")].find((each) => each.textContent === label)!;
const field = () => container.querySelector("textarea")!;
const type = (text: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field(), text);
  field().dispatchEvent(new Event("input", { bubbles: true }));
});

test("one question; an idea fills it, and Create sends what's written, trimmed", async () => {
  const onCreate = vi.fn(async () => true);
  act(() => root.render(<Welcome first look={look} busy={false} error={null} onCreate={onCreate} />));
  expect(container.querySelector("h1")?.textContent).toBe("Meet your Bot");
  expect(container.querySelector('label[for="bot-welcome-goal"]')?.textContent).toBe("What should your Bot help with?");
  expect(container.querySelector("svg[data-shape=blob]")).not.toBeNull();
  act(() => button(IDEAS[1]!.label).click());
  expect(field().value).toBe(IDEAS[1]!.text);
  expect(button(IDEAS[1]!.label).getAttribute("aria-pressed")).toBe("true");
  type("  Watch my PRs  ");
  await act(async () => button("Create Bot").click());
  expect(onCreate).toHaveBeenCalledWith("Watch my PRs");
});

test("Enter creates (empty is fine: the Bot asks); Shift+Enter doesn't; busy shows Creating… and blocks it", async () => {
  const onCreate = vi.fn(async () => true);
  act(() => root.render(<Welcome first={false} look={look} busy={false} error="Nope" onCreate={onCreate} />));
  expect(container.querySelector("h1")?.textContent).toBe("Make another Bot");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Nope");
  await act(async () => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })));
  expect(onCreate).not.toHaveBeenCalled();
  await act(async () => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(onCreate).toHaveBeenCalledWith("");
  act(() => root.render(<Welcome first look={look} busy error={null} onCreate={onCreate} />));
  expect(button("Creating…").disabled).toBe(true);
  expect(field().disabled).toBe(true);
});
