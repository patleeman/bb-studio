// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("../ui/index", async () => (await import("../../loops/ui/test-kit")).kitUi);
const { CHAT_CARD, ChatCard, ChatCardAction, ChatCardFooter, ChatCardHeader, ChatCardIconButton } = await import("./chat-card");

const CARDS = [
  "src/kit/app/directive-card.tsx",
  "src/minis/ui/mini-card.tsx",
  "src/work/ui/WorkCard.tsx",
  "src/loops/ui/LoopCard.tsx",
  "src/ui/conversations/finish.tsx",
  "src/ui/conversations/ContinuedCard.tsx",
  "src/ui/conversations/ApprovalCard.tsx",
  "src/explore/ui/next.tsx",
];

it("is one shell: the column's full width, one radius, border and background", () => {
  const classes = CHAT_CARD.split(" ");
  expect(classes).toEqual(expect.arrayContaining(["w-full", "rounded-lg", "border", "border-border/70", "bg-background", "overflow-hidden"]));
  expect(classes.some((name) => name.startsWith("max-w-"))).toBe(false);
});

it("every chat card is drawn from it, with no width cap or radius of its own", () => {
  for (const file of CARDS) {
    const source = readFileSync(resolve(__dirname, "../../..", file), "utf8");
    expect(source, file).toMatch(/chat-card"|CHAT_CARD/);
    expect(source, file).not.toMatch(/rounded-xl|max-w-xl|max-w-2xl/);
  }
});

it("draws the header as icon, title, meta and actions, and the footer as actions", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const opened = vi.fn();
  await act(async () => root.render(
    <ChatCard data-testid="card">
      <ChatCardHeader icon="FileText" title="Plan" meta="Page" onOpen={opened} actions={<ChatCardIconButton icon="ArrowUpRight" label="Open Plan" />} />
      <ChatCardFooter><ChatCardAction icon="Brain">Memory</ChatCardAction></ChatCardFooter>
    </ChatCard>,
  ));
  const card = host.querySelector('[data-testid="card"]')!;
  expect(card.hasAttribute("data-studio-card")).toBe(true);
  expect(card.querySelector("[data-studio-card-title]")!.textContent).toBe("Plan");
  expect(card.querySelector("[data-studio-card-meta]")!.textContent).toBe("Page");
  expect(card.querySelector('button[aria-label="Open Plan"]')).not.toBeNull();
  expect(card.querySelector("[data-studio-card-foot] button")!.textContent).toBe("Memory");
  await act(async () => (card.querySelector("[data-studio-card-head] button") as HTMLButtonElement).click());
  expect(opened).toHaveBeenCalled();
  await act(async () => root.unmount());
});
