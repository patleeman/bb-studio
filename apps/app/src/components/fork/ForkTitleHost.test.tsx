// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { PageShell } from "@/components/ui/page-shell";
import { forkCascade } from "@/test/fork-css-cascade";
import {
  applyAppearance,
  cleanAppearance,
} from "@/components/fork/ForkAppBackdrop";
import {
  FORK_TITLE_HOST_ATTRIBUTE,
  FORK_TITLE_ROWS_ATTRIBUTE,
  ForkTitleHost,
} from "./ForkTitleHost";

const desktop = vi.hoisted(() => ({ framed: false }));

vi.mock("@/components/ui/sidebar.js", () => ({
  useIsSidebarFramed: () => desktop.framed,
  useIsSidebarShowing: () => true,
  useSidebarKeepsCollapsedRail: () => false,
}));

const here = dirname(fileURLToPath(import.meta.url));
const root = document.documentElement;
const mounts = { count: 0 };

function Title() {
  useEffect(() => {
    mounts.count += 1;
  }, []);
  return <p data-testid="title">Settings</p>;
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div data-testid="scope">
      <AppPageHeader center={<Title />} actions={<button>Act</button>} />
      <main>{children}</main>
    </div>
  );
}

async function titleRows(on: boolean) {
  await act(async () => {
    if (on) root.setAttribute(FORK_TITLE_ROWS_ATTRIBUTE, "");
    else root.removeAttribute(FORK_TITLE_ROWS_ATTRIBUTE);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const header = () => document.querySelector("header") as HTMLElement;
const group = () =>
  document.querySelector('[data-fork-header-group="title"]') as HTMLElement;
const host = () =>
  document.querySelector(`[${FORK_TITLE_HOST_ATTRIBUTE}]`) as HTMLElement;

afterEach(() => {
  cleanup();
  desktop.framed = false;
  mounts.count = 0;
  root.removeAttribute(FORK_TITLE_ROWS_ATTRIBUTE);
  root.removeAttribute("data-fork-cards");
});

describe.each([
  ["unframed", false],
  ["framed", true],
])("a header's title group in the %s layout", (_name, framed) => {
  it("stays in the bar until the appearance asks for title rows, then moves into the page's host as the same nodes, and comes back", async () => {
    desktop.framed = framed;
    render(
      <Page>
        <PageShell>
          <span data-testid="content">Threads</span>
        </PageShell>
      </Page>,
    );
    expect(
      header().className.includes("h-(--bb-window-title-bar-height)"),
    ).toBe(framed);
    const title = screen.getByTestId("title");
    expect(header().contains(group())).toBe(true);
    expect(host().getAttribute(FORK_TITLE_HOST_ATTRIBUTE)).toBe("page");
    expect(host().childElementCount).toBe(0);
    expect(host().nextElementSibling).toBe(screen.getByTestId("content"));

    await titleRows(true);
    expect(header().contains(group())).toBe(false);
    expect(host().contains(group())).toBe(true);
    expect(screen.getByTestId("title")).toBe(title);
    expect(mounts.count).toBe(1);
    expect(
      header().querySelector('[data-fork-header-group="actions"]'),
    ).not.toBeNull();

    await titleRows(false);
    expect(header().contains(group())).toBe(true);
    expect(host().childElementCount).toBe(0);
    expect(screen.getByTestId("title")).toBe(title);
    expect(mounts.count).toBe(1);
  });

  it("keeps the title in the bar on a page with no host, finds a host that mounts later, and returns when it goes", async () => {
    desktop.framed = framed;
    root.setAttribute(FORK_TITLE_ROWS_ATTRIBUTE, "");
    const view = render(
      <Page>
        <span>Plain</span>
      </Page>,
    );
    expect(header().contains(group())).toBe(true);
    view.rerender(
      <Page>
        <div
          {...{ [FORK_TITLE_HOST_ATTRIBUTE]: "" }}
          data-testid="plugin-host"
        />
      </Page>,
    );
    await titleRows(true);
    expect(screen.getByTestId("plugin-host").contains(group())).toBe(true);
    view.rerender(
      <Page>
        <span>Plain</span>
      </Page>,
    );
    await titleRows(true);
    expect(header().contains(group())).toBe(true);
    expect(mounts.count).toBe(1);
  });

  it("uses only a host under the header's own parent, and leaves nothing behind in the host when the header unmounts", async () => {
    desktop.framed = framed;
    root.setAttribute(FORK_TITLE_ROWS_ATTRIBUTE, "");
    const view = render(
      <>
        <div data-testid="other-pane">
          <ForkTitleHost kind="page" />
        </div>
        <Page>
          <span>Plain</span>
        </Page>
      </>,
    );
    await titleRows(true);
    expect(header().contains(group())).toBe(true);
    expect(host().childElementCount).toBe(0);
    view.rerender(
      <>
        <div data-testid="other-pane">
          <ForkTitleHost kind="page" />
        </div>
        <Page>
          <ForkTitleHost kind="tools" />
        </Page>
      </>,
    );
    await titleRows(true);
    const tools = document.querySelector(
      `[${FORK_TITLE_HOST_ATTRIBUTE}="tools"]`,
    ) as HTMLElement;
    expect(tools.contains(group())).toBe(true);
    expect(tools.className).toContain("max-w-5xl");
    view.rerender(
      <div data-testid="scope">
        <main>
          <ForkTitleHost kind="tools" />
        </main>
      </div>,
    );
    expect(
      document.querySelector(`[${FORK_TITLE_HOST_ATTRIBUTE}="tools"]`)
        ?.childElementCount,
    ).toBe(0);
  });
});

describe("title rows in the appearance", () => {
  it("are asked for with layout.cards.titleRow: true only, and mark <html> while applied", () => {
    const cards = (titleRow: unknown) =>
      cleanAppearance({ layout: { cards: { gap: 10, radius: 8, titleRow } } })
        .cards;
    expect(cards(true)).toEqual({ gap: 10, radius: 8, titleRow: true });
    for (const value of [undefined, false, 1, "true"]) {
      expect(cards(value)?.titleRow).toBe(false);
    }
    const undo = applyAppearance(
      root,
      cleanAppearance({ layout: { cards: { gap: 10, radius: 8 } } }),
    );
    expect(root.hasAttribute(FORK_TITLE_ROWS_ATTRIBUTE)).toBe(false);
    undo();
    const undoRows = applyAppearance(
      root,
      cleanAppearance({
        layout: { cards: { gap: 10, radius: 8, titleRow: true } },
      }),
    );
    expect(root.hasAttribute(FORK_TITLE_ROWS_ATTRIBUTE)).toBe(true);
    undoRows();
    expect(root.hasAttribute(FORK_TITLE_ROWS_ATTRIBUTE)).toBe(false);
  });
});

describe("where bb puts its title hosts", () => {
  it("a page shell's host is the first child of its content column, and both Skills and Plugins wrappers start with one", () => {
    const tools = readFileSync(join(here, "../../views/ToolsView.tsx"), "utf8");
    expect(tools).toMatch(
      /<div className="box-border h-full w-full pb-4 pt-3 md:pt-4">\s*<ForkTitleHost kind="tools" \/>/u,
    );
    expect(tools).toMatch(
      /<div className="relative h-full overflow-hidden">\s*<ForkTitleHost kind="tools" \/>/u,
    );
    render(
      <PageShell>
        <span data-testid="content" />
      </PageShell>,
    );
    const column = document.querySelector("[data-page-scroll-viewport]")
      ?.firstElementChild as HTMLElement;
    expect(column.firstElementChild).toBe(host());
  });
});

describe("a title row's style", () => {
  function pageHost(filled: boolean) {
    render(
      <div data-sidebar="inset">
        <PageShell contentClassName="pt-4">
          <span />
        </PageShell>
      </div>,
    );
    if (filled) host().appendChild(document.createElement("div"));
    return host();
  }

  it("draws no host while it is empty or no title rows are asked for", () => {
    const element = pageHost(false);
    expect(forkCascade(element, "display")).toBe("none");
    element.appendChild(document.createElement("div"));
    expect(forkCascade(element, "display")).toBeNull();
    expect(forkCascade(element, "position")).toBeNull();
  });

  it("a page's row is the card's first row: sticky at the top of the scroll area, the card's width and top corners, its text on the content's left edge, and the column's top padding gone", () => {
    const element = pageHost(true);
    root.setAttribute("data-fork-cards", "");
    root.setAttribute(FORK_TITLE_ROWS_ATTRIBUTE, "");
    const style = (property: string) => forkCascade(element, property);
    expect(style("display")).toBe("flex");
    expect(style("position")).toBe("sticky");
    expect(style("top")).toBe("0");
    expect(style("height")).toBe("var(--fork-title-row-height)");
    expect(style("width")).toBe(
      "min(100cqw, calc(100% + 2 * var(--fork-cards-page-bleed)))",
    );
    expect(style("padding-inline")).toBe(
      "calc( (min(100cqw, calc(100% + 2 * var(--fork-cards-page-bleed))) - 100%) / 2 )",
    );
    expect(style("border-radius")).toBe(
      "var(--fork-cards-radius) var(--fork-cards-radius) 0 0",
    );
    expect(forkCascade(root, "--fork-title-row-height")).toBe("44px");
    expect(forkCascade(element.parentElement as Element, "padding-top")).toBe(
      "0",
    );
  });

  it("backs the row with the card's own glass, a little denser and more blurred, fading out below it, so what scrolls under does not show through", () => {
    const element = pageHost(true);
    root.setAttribute("data-fork-cards", "");
    root.setAttribute(FORK_TITLE_ROWS_ATTRIBUTE, "");
    const backing = (property: string) =>
      forkCascade(element, property, "::before");
    expect(backing("background")).toBe("var(--fork-title-row-background)");
    expect(backing("backdrop-filter")).toBe("var(--fork-title-row-filter)");
    expect(backing("inset")).toBe(
      "0 0 calc(-1 * var(--fork-title-row-tail)) 0",
    );
    expect(backing("mask-image")).toContain("transparent");
    expect(forkCascade(root, "--fork-title-row-background")).toBe(
      "linear-gradient( color-mix(in oklab, var(--canvas) 40%, transparent) 0 0 ), var(--fork-surface-main-background, transparent)",
    );
    expect(forkCascade(root, "--fork-title-row-filter")).toBe(
      "var(--fork-surface-main-backdrop-filter,) blur(14px)",
    );
  });

  it("draws the title group in a host bare: no pill, no padding, the row's width", () => {
    const element = pageHost(false);
    const title = document.createElement("div");
    title.setAttribute("data-fork-header-group", "title");
    element.appendChild(title);
    root.setAttribute("data-fork-cards", "");
    root.setAttribute(FORK_TITLE_ROWS_ATTRIBUTE, "");
    expect(forkCascade(title, "background")).toBe("none");
    expect(forkCascade(title, "backdrop-filter")).toBe("none");
    expect(forkCascade(title, "box-shadow")).toBe("none");
    expect(forkCascade(title, "padding-inline")).toBe("0");
    expect(forkCascade(title, "flex")).toBe("1");
  });
});
