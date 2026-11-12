// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ open: vi.fn(), openLink: vi.fn(async (_link: string, _options: unknown) => ({ via: "workbench" })) }));
vi.mock("../../links/open", () => ({ openLinkFromAnywhere: state.openLink, clickModifiers: (event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => ({ meta: !!event?.metaKey, ctrl: !!event?.ctrlKey, shift: !!event?.shiftKey }) }));
vi.mock("../../kit/ui/icon", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));
vi.mock("../../kit/app/index", () => ({ openAppPath: state.open, StudioBar: ({ children, slotOnly }: { children?: ReactNode; slotOnly?: boolean }) => <div data-testid="studio-bar" data-slot-only={slotOnly ? "" : undefined}>{children}</div> }));
const tab = vi.hoisted(() => ({ window: null as null | { title: string; toolbar: HTMLElement | null } }));
vi.mock("../../kit/app/host-sdk", () => ({ useHostTabWindow: () => tab.window }));

const { BOT_PAGE_CARD_BOX } = await import("./BotPageLayout");
const { BOT_PAGE_CARD, BOT_PAGE_COLUMN, BotPageColumns, BotItemDetail, BotPageGroup, BotPageLayout, BotPageNewButton, BotPageRow, BotPageToolbar } = await import("./index");

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); state.open.mockClear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); tab.window = null; document.documentElement.removeAttribute("data-studio-glass"); });
const render = (node: ReactNode) => act(() => root.render(node));
const q = <E extends Element = HTMLElement>(selector: string) => container.querySelector<E>(selector as string) as E | null;
const qa = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const type = (input: HTMLInputElement, value: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const key = (target: EventTarget, name: string) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });

it("under a scene theme the header stays one bar marked as the column's, with nothing of it in the card", () => {
  document.documentElement.setAttribute("data-studio-glass", "");
  render(<BotPageLayout testId="page" title="Automations" bot="Chief of Staff" botId="bot_main" actions={<button type="button">Act</button>} toolbar={<div data-testid="tb" />}><p data-testid="body" /></BotPageLayout>);
  const card = q("[data-testid=bot-page-card]")!;
  const column = q("[data-testid=tb]")!.parentElement!;
  expect(card.nextElementSibling).toBe(column);
  expect(BOT_PAGE_CARD.split(" ")).toEqual(expect.arrayContaining(BOT_PAGE_CARD_BOX.split(" ")));
  for (const each of ["mx-auto", "w-full", "max-w-4xl", "px-8"]) expect(BOT_PAGE_COLUMN.split(" ")).toContain(each);
  const bar = q("[data-testid=page-bar]")!;
  expect(bar.getAttribute("data-studio-page-bar")).toBe("column");
  expect(qa("[data-testid=page-bar-title]").map((each) => each.textContent)).toEqual(["Automations"]);
  expect(bar.querySelector("[data-testid=page-bar-detail]")!.textContent).toBe("Chief of Staff");
  expect(bar.textContent).toContain("Act");
  expect(q("[data-studio-title-row]")).toBeNull();
  act(() => bar.querySelector<HTMLButtonElement>("[data-testid=bot-page-bot]")!.click());
  expect(state.open).toHaveBeenCalledWith("/plugins/studio/studio/bot/bot_main");
});

it("in a workbench tab window a scene theme adds no title row; the actions stay in the window's toolbar", () => {
  document.documentElement.setAttribute("data-studio-glass", "");
  const toolbar = document.createElement("div");
  document.body.append(toolbar);
  tab.window = { title: "Todos", toolbar };
  render(<BotPageLayout title="Todos" bot="Chief of Staff" actions={<button type="button">Act</button>} />);
  expect(q("[data-studio-title-row]")).toBeNull();
  expect(toolbar.textContent).toBe("Act");
  toolbar.remove();
});

it("the layout: one header '<Page> · <Bot>' with actions, the shared column, and no panel of its own", () => {
  render(<BotPageLayout testId="page" title="Todos" bot="Chief of Staff" botId="bot_main" actions={<button type="button">Act</button>} toolbar={<div data-testid="tb" />}><p data-testid="body" /></BotPageLayout>);
  expect(q("[data-testid=page-bar]")?.textContent).toBe("Todos·Chief of Staff" + "Act");
  expect(qa("[data-testid=page-bar]")).toHaveLength(1);
  expect(q("[data-testid=page]")?.dataset.botPage).toBe("Todos");
  // Toolbar and content sit in the same column on every page.
  const column = q("[data-testid=tb]")!.parentElement!;
  expect(column.className).toBe(BOT_PAGE_COLUMN);
  expect(q("[data-testid=body]")!.parentElement).toBe(column);
  expect(q("[data-testid=bot-page-detail], [data-fork-card=secondary-panel], aside")).toBeNull();
  // Under a scene theme the host paints the column's card: the first child of the scroller, behind the column.
  const scroller = column.parentElement!;
  const card = q("[data-testid=bot-page-card]")!;
  expect(scroller.firstElementChild).toBe(card);
  expect(card.nextElementSibling).toBe(column);
  expect(card.getAttribute("data-fork-card")).toBe("main");
  expect(card.getAttribute("aria-hidden")).toBe("true");
  expect(card.className).toBe(BOT_PAGE_CARD);
  expect(BOT_PAGE_CARD.split(" ")).toEqual(expect.arrayContaining(["sticky", "top-0", "-z-10", "mx-auto", "h-[100cqh]", "-mb-[100cqh]", "max-w-[880px]", "pointer-events-none"]));
  expect(scroller.className.split(" ")).toContain("isolate");
  expect(scroller.parentElement!.className.split(" ")).toContain("[container-type:size]");
  // The Bot's name opens the Bot's page.
  act(() => q<HTMLButtonElement>("[data-testid=bot-page-bot]")!.click());
  expect(state.open).toHaveBeenCalledWith("/plugins/studio/studio/bot/bot_main");
  render(<BotPageLayout title="Todos" bot="Chief of Staff" />);
  // Without its id, the name is plain text; without a Bot, the title stands alone.
  expect(q("[data-testid=bot-page-bot]")).toBeNull();
  render(<BotPageLayout title="Automations" />);
  expect(q("[data-testid=page-bar]")?.textContent).toBe("Automations");
});

it("in a tab's own window the layout draws no title row; its toolbar stays in the page", () => {
  const toolbar = document.createElement("div");
  document.body.append(toolbar);
  tab.window = { title: "Memory", toolbar };
  render(<BotPageLayout testId="page" title="Memory" bot="Chief of Staff" botId="bot_main" toolbar={<BotPageToolbar search={{ value: "", onChange: () => {}, placeholder: "Search memory" }} onNew={() => {}} />}><p data-testid="body" /></BotPageLayout>);
  expect(q("[data-testid=page-bar]")).toBeNull();
  expect(container.textContent).not.toContain("Chief of Staff");
  expect(q("[data-testid=bot-page-search]")).not.toBeNull();
  expect(q("[data-testid=bot-page-new]")).not.toBeNull();
  expect(q("[data-testid=body]")).not.toBeNull();
  expect(toolbar.textContent).toBe("");
  toolbar.remove();
});

it("the toolbar: search with Esc to clear, pills only past one choice, and New or a page's own New menu", () => {
  const changed = vi.fn(), picked = vi.fn(), added = vi.fn();
  const toolbar = (options: { id: string; label: string; count?: number }[], extra: object = {}) => (
    <BotPageToolbar search={{ value: "red", onChange: changed, placeholder: "Search todos" }} filter={{ label: "Area", value: "all", options, onChange: picked }} onNew={added} {...extra} />
  );
  render(toolbar([{ id: "all", label: "All" }, { id: "Home", label: "Home", count: 3 }]));
  const field = q<HTMLInputElement>("[data-testid=bot-page-search]")!;
  expect(field.getAttribute("aria-label")).toBe("Search todos");
  type(field, "homelab");
  expect(changed).toHaveBeenLastCalledWith("homelab");
  key(field, "Escape");
  expect(changed).toHaveBeenLastCalledWith("");
  expect(qa("[data-testid=bot-page-pill]").map((pill) => pill.textContent)).toEqual(["All", "Home3"]);
  expect(q("[data-testid=bot-page-pills]")?.getAttribute("aria-label")).toBe("Area");
  expect(qa("[data-testid=bot-page-pill]")[0]!.dataset.state).toBe("on");
  expect(qa("[data-studio-pill]")).toEqual(qa("[data-testid=bot-page-pill]"));
  act(() => qa("[data-testid=bot-page-pill]")[1]!.click());
  expect(picked).toHaveBeenLastCalledWith("Home");
  // Clicking the chosen pill keeps it: there is no "nothing chosen".
  act(() => qa("[data-testid=bot-page-pill]")[0]!.click());
  expect(picked).toHaveBeenCalledTimes(1);
  act(() => q<HTMLButtonElement>("[data-testid=bot-page-new]")!.click());
  expect(added).toHaveBeenCalled();
  render(toolbar([{ id: "all", label: "All" }], { newAction: <BotPageNewButton data-menu="" /> }));
  expect(q("[data-testid=bot-page-pills]")).toBeNull();
  expect(qa("[data-testid=bot-page-new]")).toHaveLength(1);
  expect(q("[data-testid=bot-page-new]")?.hasAttribute("data-menu")).toBe(true);
});

it("the row: one line, icon and title left, status and meta or columns right, actions on hover, a button only when it opens", () => {
  const opened = vi.fn();
  const columns = [{ key: "kind", label: "Kind", className: "w-28" }, { key: "last", label: "Last run", className: "w-24" }];
  render(<>
    <BotPageColumns title="Name" columns={columns} />
    <BotPageRow testId="row" icon="Eye" title="Morning card" titleText="Morning card" status={{ label: "Active", tone: "success" }} columns={columns.map((column) => ({ key: column.key, className: column.className, content: column.label === "Kind" ? "Watcher" : "2h ago" }))} onOpen={opened} selected actions={<button type="button">Run</button>} />
    <BotPageRow testId="plain" title="Release notes" meta="Page · 3d" muted />
  </>);
  const row = q("[data-testid=row]")!;
  expect(row.querySelector("[data-icon=Eye]")).not.toBeNull();
  expect([...row.querySelectorAll("[data-testid=bot-page-row-title], [data-testid=bot-page-row-status], [data-column]")].map((each) => each.textContent)).toEqual(["Morning card", "Active", "Watcher", "2h ago"]);
  expect(row.querySelector("[data-testid=bot-page-row-status]")?.className).toContain("text-success");
  expect(row.dataset.selected).toBe("true");
  // The header's columns have the rows' widths.
  expect(qa("[role=columnheader]").map((each) => [each.textContent, each.className.split(" ").find((name) => /^w-\d+$/.test(name)) ?? ""])).toEqual([["Name", ""], ["Kind", "w-28"], ["Last run", "w-24"]]);
  act(() => row.querySelector<HTMLButtonElement>("[data-testid=bot-page-row-open]")!.click());
  expect(opened).toHaveBeenCalledTimes(1);
  // Actions sit outside the open button, so they don't open the row.
  act(() => row.querySelector<HTMLButtonElement>("[data-testid=bot-page-row-actions] button")!.click());
  expect(opened).toHaveBeenCalledTimes(1);
  const plain = q("[data-testid=plain]")!;
  expect(plain.querySelector("button")).toBeNull();
  expect(plain.querySelector("[data-testid=bot-page-row-meta]")?.textContent).toBe("Page · 3d");
  expect(plain.querySelector("[data-testid=bot-page-row-title]")?.className).toContain("text-muted-foreground");
});

it("the group: its title and count, folding when collapsible", () => {
  render(<>
    <BotPageGroup title="Today" count={2}><p data-testid="a" /></BotPageGroup>
    <BotPageGroup title={<button type="button">Launch prep</button>} label="Launch prep" count={1} collapsible defaultOpen={false}><p data-testid="b" /></BotPageGroup>
  </>);
  const [today, folded] = qa("section");
  expect(today!.getAttribute("aria-label")).toBe("Today");
  expect(today!.querySelector("[data-testid=bot-page-group-count]")?.textContent).toBe("2");
  expect(q("[data-testid=a]")).not.toBeNull();
  expect(folded!.getAttribute("aria-label")).toBe("Launch prep");
  expect(q("[data-testid=b]")).toBeNull();
  act(() => folded!.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
  expect(q("[data-testid=b]")).not.toBeNull();
  expect(folded!.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toBe("true");
});

it("an item's detail, the content of its workbench tab: title, body, facts and actions, with no close button of its own", () => {
  render(<BotItemDetail testId="item" title="Pay the bill" facts={[{ label: "Due", value: "Fri" }, { label: "Area", value: "Home" }]} actions={<button type="button">Done</button>}><input data-testid="field" /></BotItemDetail>);
  expect(q("[data-testid=item] [data-testid=bot-item-title]")?.textContent).toBe("Pay the bill");
  expect(qa("dt").map((dt) => `${dt.textContent}=${dt.nextElementSibling?.textContent}`)).toEqual(["Due=Fri", "Area=Home"]);
  expect(q("[data-testid=bot-item-actions]")?.textContent).toBe("Done");
  expect(q("[aria-label=Close]")).toBeNull();
  tab.window = { title: "Pay the bill", toolbar: null };
  render(<BotItemDetail testId="item" title="Pay the bill" facts={[{ label: "Due", value: "Fri" }]} />);
  expect(q("[data-testid=bot-item-title]")).toBeNull();
  expect(q("[data-testid=bot-item-facts]")).not.toBeNull();
  tab.window = null;
});
