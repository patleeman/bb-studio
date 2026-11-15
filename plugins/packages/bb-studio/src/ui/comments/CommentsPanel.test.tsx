// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../kit/ui/index", async (original) => ({ ...(await original<object>()), Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const { CommentsPanel } = await import("./CommentsPanel");
type Props = Parameters<typeof CommentsPanel>[0];

const Author = ({ authorId }: { authorId: string }) => <span data-author-name="">{authorId === "user" ? "You" : "Assistant"}</span>;
const THREADS: Props["threads"] = [
  { id: "t-open", quote: "40 teams", resolved: false, messages: [{ id: "c1", authorId: "agent:thr_a", text: "Is 40 right?", at: Date.now() - 60_000 }, { id: "c2", authorId: "user", text: "Make it 50", at: Date.now() }] },
  { id: "t-done", quote: "Friday", resolved: true, resolvedBy: "user", resolvedAt: Date.now(), messages: [{ id: "c3", authorId: "user", text: "Keep Friday", at: Date.now() }] },
];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

function render(props: Partial<Props> = {}) {
  const handlers = { onSelect: vi.fn(), onResolve: vi.fn(async () => {}), onReply: vi.fn(async () => {}), onClose: vi.fn() };
  act(() => root.render(<CommentsPanel threads={THREADS} activeId={null} Author={Author} emptyHint="Select text and choose Comment." {...handlers} {...props} />));
  return handlers;
}
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
const button = (label: string) => $$("button").find((each) => each.textContent?.trim() === label || each.getAttribute("aria-label") === label)!;
const type = (field: HTMLTextAreaElement, value: string) => {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

it("shows a header with the open count and close, and only open threads under Open", () => {
  const { onClose } = render();
  expect($("aside[aria-label=Comments]")!.textContent).toContain("Comments");
  expect($("[aria-label='1 open']")!.textContent).toBe("1");
  expect($$("[data-comment-thread]").map((card) => card.dataset.commentThread)).toEqual(["t-open"]);
  expect($("[data-comment-quote]")!.textContent).toBe("40 teams");
  expect($$("[data-comment-thread] p").map((each) => each.textContent)).toEqual(["Is 40 right?", "Make it 50"]);
  expect(host.textContent).not.toContain("Marked as resolved");
  act(() => button("Close comments").click());
  expect(onClose).toHaveBeenCalled();
});

it("shows resolved threads under Resolved with a small resolved line and Reopen", async () => {
  const { onResolve } = render();
  act(() => $("[data-testid=comments-filter-resolved]")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  act(() => $("[data-testid=comments-filter-resolved]")!.click());
  expect($$("[data-comment-thread]").map((card) => card.dataset.commentThread)).toEqual(["t-done"]);
  expect($("[data-testid=comment-resolved-line]")!.textContent).toMatch(/^Resolved by You · /);
  expect($("[data-comment-thread] textarea")).toBeNull();
  await act(async () => $("[data-testid=comment-reopen]")!.click());
  expect(onResolve).toHaveBeenCalledWith("t-done", false);
});

it("replies inline and resolves an open thread, and selects it on click", async () => {
  const { onReply, onResolve, onSelect } = render();
  const field = $("[data-comment-thread] textarea") as HTMLTextAreaElement;
  type(field, "Done, thanks");
  await act(async () => button("Reply").click());
  expect(onReply).toHaveBeenCalledWith("t-open", "Done, thanks");
  expect(field.value).toBe("");
  await act(async () => $("[data-testid=comment-resolve]")!.click());
  expect(onResolve).toHaveBeenCalledWith("t-open", true);
  act(() => $("[data-comment-quote]")!.click());
  expect(onSelect).toHaveBeenCalledWith("t-open");
});

it("marks the active thread and switches to its tab", () => {
  render({ activeId: "t-done" });
  expect($("[data-comment-thread='t-done']")!.dataset.active).toBe("true");
});

it("has an empty state, and a draft with its quote at the top", async () => {
  render({ threads: [] });
  expect($("[data-testid=comments-empty]")!.textContent).toContain("No comments yet");
  expect($("[data-testid=comments-empty]")!.textContent).toContain("Select text and choose Comment.");
  const onSubmit = vi.fn(async () => {});
  const onCancel = vi.fn();
  render({ draft: { quote: "crash rate", onSubmit, onCancel } });
  const list = $$("section");
  expect(list[0]!.dataset.testid).toBe("comment-draft");
  expect(list[0]!.querySelector("[data-comment-quote]")!.textContent).toBe("crash rate");
  type(list[0]!.querySelector("textarea")!, "Lower it?");
  await act(async () => button("Comment").click());
  expect(onSubmit).toHaveBeenCalledWith("Lower it?");
  act(() => button("Cancel").click());
  expect(onCancel).toHaveBeenCalled();
});
