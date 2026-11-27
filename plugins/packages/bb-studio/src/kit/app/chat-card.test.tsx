// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("../ui/index", async () => (await import("../../loops/ui/test-kit")).kitUi);
const { CHAT_CARD, CHAT_CARD_BODY, CHAT_CARD_HEAD, ChatCard, ChatCardAction, ChatCardFooter, ChatCardHeader, ChatCardIconButton } = await import("./chat-card");

const { GLASS_ATTRIBUTE, PAGE_HEADER, THEME_CSS } = await import("../../theme/tokens");

const CARDS = [
  "src/kit/app/directive-card.tsx",
  "src/minis/ui/mini-card.tsx",
  "src/tasks/ui/TaskCard.tsx",
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

it("starts the header's icon on the body's text column, with no theme rule taking the padding back", async () => {
  // The header and the body share one left inset.
  const left = (classes: string) => classes.split(" ").filter((name) => /^p[lx]?-/.test(name) && !name.startsWith("py-"));
  expect(left(CHAT_CARD_HEAD)).toContain("pl-3");
  expect(left(CHAT_CARD_BODY)).toContain("px-3");

  // Under the glass theme a card sits in the chat pane, below bb's page header. The theme's page header rule
  // once matched every <header> there and set the card header's padding to 0 (the circle sat 3 px from the edge).
  document.documentElement.setAttribute(GLASS_ATTRIBUTE, "");
  const pane = document.createElement("div");
  pane.setAttribute("data-sidebar", "inset");
  pane.innerHTML = '<header data-testid="page-header"><div data-testid="app-page-header-content-row"></div></header>';
  document.body.append(pane);
  const host = document.createElement("div");
  pane.append(host);
  const root = createRoot(host);
  await act(async () => root.render(
    <ChatCard>
      <ChatCardHeader icon="Circle" title="Defrost the freezer" meta="Do" divided />
      <div data-testid="body" className={CHAT_CARD_BODY}>Overdue reminder.</div>
    </ChatCard>,
  ));
  const style = document.createElement("style");
  style.textContent = THEME_CSS;
  document.head.append(style);
  const rules: CSSStyleRule[] = [];
  const walk = (list: CSSRuleList) => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) rules.push(rule);
      else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
    }
  };
  walk(style.sheet!.cssRules);
  const padded = (rule: CSSStyleRule) => /(^|;)\s*padding/.test(rule.style.cssText);
  const matching = (element: Element) => rules.filter((rule) => padded(rule) && element.matches(rule.selectorText)).map((rule) => rule.selectorText);
  try {
    expect(matching(pane.querySelector('[data-testid="page-header"]')!)).toContain(PAGE_HEADER);
    expect(matching(pane.querySelector("[data-studio-card-head]")!)).toEqual([]);
    expect(matching(pane.querySelector('[data-testid="body"]')!)).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    style.remove();
    pane.remove();
    document.documentElement.removeAttribute(GLASS_ATTRIBUTE);
  }
});
