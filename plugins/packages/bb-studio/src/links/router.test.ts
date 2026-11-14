import { describe, expect, it, vi } from "vitest";
import { pathFor, TAB_KIND_REGISTRY, tabKindEntry, tabOpenFor, type TabRef } from "../tab-kinds";
import { SAMPLE_REFS as SAMPLE } from "./audit";
import { directiveFor, goneText, howFor, LINK_KINDS, linkFor, needsResolution, NOT_FOUND_TAB, NOT_FOUND_TITLE, openLink, parseLink, refOf, type LinkDeps, type LinkResolution, type LinkTarget } from "./router";

const ORIGIN = "http://127.0.0.1:38986";


const entity = (ref: TabRef, link: string): LinkTarget => ({ type: "entity", ref, link });

describe("canonical links", () => {
  it("every registry kind has a bb:// link that parses back to itself", () => {
    expect(LINK_KINDS).toEqual(TAB_KIND_REGISTRY.map((entry) => entry.id));
    for (const kind of LINK_KINDS) {
      const ref = SAMPLE[kind];
      const link = linkFor(ref);
      expect(link.startsWith(`bb://${kind}`)).toBe(true);
      expect(parseLink(link, ORIGIN), link).toEqual(entity(ref, link));
    }
  });

  it("every kind with an app route parses from it, as a path, a full URL on this BB and bb:// plus the route", () => {
    for (const kind of LINK_KINDS) {
      const ref = SAMPLE[kind];
      const path = pathFor(ref);
      if (!path) {
        expect(tabKindEntry(kind).owner, kind).toBe("bb");
        continue;
      }
      const expected = kind === "worker" ? { kind: "conversation", id: ref.id } : ref;
      expect((parseLink(path, ORIGIN) as { ref: TabRef }).ref, path).toEqual(expected);
      expect((parseLink(`${ORIGIN}${path}`, ORIGIN) as { ref: TabRef }).ref, path).toEqual(expected);
      expect((parseLink(`bb://${path.slice(1)}`, ORIGIN) as { ref: TabRef }).ref, path).toEqual(expected);
    }
  });

  it("a card directive names the same target as the item's link", () => {
    for (const kind of LINK_KINDS) {
      const ref = SAMPLE[kind];
      const directive = directiveFor(ref);
      if (!directive) continue;
      expect(parseLink(directive, ORIGIN)).toEqual(entity(ref, directive));
    }
    expect(directiveFor(SAMPLE.page)).toBe('::page{id="pg_0123456789abcdef"}');
    expect(parseLink("::drawing{id=\"drw_0123456789abcdef\"}")).toEqual(entity(SAMPLE.whiteboard, "::drawing{id=\"drw_0123456789abcdef\"}"));
    expect(parseLink("::mini{id='mini_0123456789abcdef'}")?.type).toBe("entity");
    expect(parseLink("::loop{id=\"loop_1\"}")).toEqual(entity({ kind: "todos", id: null }, "::loop{id=\"loop_1\"}"));
    expect(parseLink("::loops{open=\"pane\"}")).toEqual(entity({ kind: "todos", id: null }, "::loops{open=\"pane\"}"));
    expect(parseLink("::bot-thread{threadId=\"thr_9\"}")).toEqual(entity({ kind: "conversation", id: "thr_9" }, "::bot-thread{threadId=\"thr_9\"}"));
    expect(parseLink("::finished{}")).toBeNull();
    expect(parseLink("::page{id=\"dsn_0123456789abcdef\"}")).toEqual(entity(SAMPLE.design, "::page{id=\"dsn_0123456789abcdef\"}"));
  });

  it("reads page: and thread: references with or without @, also when a renderer made them file:// paths, file:// URLs and web links", () => {
    expect(parseLink("page:pg_0123456789abcdef")).toEqual(entity(SAMPLE.page, "page:pg_0123456789abcdef"));
    expect(parseLink("thread:thr_1")).toEqual(entity(SAMPLE.conversation, "thread:thr_1"));
    expect(parseLink("file:///Users/p/src/a.ts")).toEqual(entity(SAMPLE.file, "file:///Users/p/src/a.ts"));
    expect(parseLink("@thread:thr_1")).toEqual(entity(SAMPLE.conversation, "@thread:thr_1"));
    expect(parseLink("@page:pg_0123456789abcdef")).toEqual(entity(SAMPLE.page, "@page:pg_0123456789abcdef"));
    const wrapped = "file:///work/workspaces/thr_9/%40thread%3Athr_1";
    expect(parseLink(wrapped)).toEqual(entity(SAMPLE.conversation, wrapped));
    expect(parseLink("file:///work/workspaces/thr_9/@page:pg_0123456789abcdef")).toEqual(entity(SAMPLE.page, "file:///work/workspaces/thr_9/@page:pg_0123456789abcdef"));
    expect(parseLink("file:///Users/p/My%20Notes/a.md")).toEqual(entity({ kind: "file", id: "/Users/p/My Notes/a.md" }, "file:///Users/p/My%20Notes/a.md"));
    expect(parseLink("https://example.com/docs", ORIGIN)).toEqual({ type: "external", url: "https://example.com/docs", link: "https://example.com/docs" });
    expect(parseLink("mailto:a@b.c")).toEqual({ type: "external", url: "mailto:a@b.c", link: "mailto:a@b.c" });
    expect(parseLink(" bb://page/pg_0123456789abcdef ")).toEqual(entity(SAMPLE.page, "bb://page/pg_0123456789abcdef"));
    expect(parseLink("BB://Page/pg_0123456789abcdef")).toBeNull();
    expect(parseLink("bb://browser/https%3A%2F%2Fexample.com%2Fdocs%3Fx%3D1")).toEqual(entity(SAMPLE.browser, "bb://browser/https%3A%2F%2Fexample.com%2Fdocs%3Fx%3D1"));
  });

  it("refuses what names nothing: empty text, unknown schemes and kinds, ids of the wrong kind, routes the registry doesn't know", () => {
    expect(parseLink("")).toBeNull();
    expect(parseLink(null)).toBeNull();
    expect(parseLink("javascript:alert(1)")).toBeNull();
    expect(parseLink("bb://widget/w_1")).toBeNull();
    expect(parseLink("bb://page/thr_1")).toBeNull();
    expect(parseLink("bb://bot")).toBeNull();
    expect(parseLink("bb://conversation")).toBeNull();
    expect(parseLink(`${ORIGIN}/settings`, ORIGIN)).toBeNull();
    expect(parseLink("/plugins/other/panel/x")).toBeNull();
    expect(parseLink("//evil.test/threads/thr_1", ORIGIN)).toBeNull();
    expect(parseLink("bb://memory")).toEqual(entity({ kind: "memory", id: null }, "bb://memory"));
    expect(parseLink("bb://page/%E0%A4%A")).toBeNull();
  });

  it("refOf checks an id against its kind, and lets a family id find its own kind", () => {
    expect(refOf("page", "dsn_0123456789abcdef")).toEqual(SAMPLE.design);
    expect(refOf("page", null)).toBeNull();
    expect(refOf("vscode", "anything")).toEqual({ kind: "vscode", id: null });
    expect(refOf("archive", null)).toEqual({ kind: "archive", id: null });
    expect(refOf("file", null)).toBeNull();
  });
});

describe("the modifier rule", () => {
  it("is one rule: a click the workbench, ⌘ or Ctrl the second pane, Shift a window", () => {
    expect(howFor()).toBe("workbench");
    expect(howFor(null)).toBe("workbench");
    expect(howFor({ alt: true })).toBe("workbench");
    expect(howFor({ meta: true })).toBe("secondPane");
    expect(howFor({ ctrl: true })).toBe("secondPane");
    expect(howFor({ shift: true })).toBe("window");
    expect(howFor({ shift: true, meta: true })).toBe("window");
  });
});

function fakeDeps(overrides: Partial<LinkDeps> & { panes?: number; resolved?: Partial<LinkResolution> } = {}) {
  const { panes = 1, resolved, ...rest } = overrides;
  const wb = {
    layout: () => ({ panes: Array.from({ length: panes }, () => ({ tabs: [], widthPercent: 100 / panes })) }),
    open: vi.fn(async (_spec: unknown, _options: unknown) => "key-1"),
    popOut: vi.fn(async (_key: string) => true),
  };
  const deps: LinkDeps = {
    inMain: () => true,
    relay: vi.fn(async () => {}),
    thread: () => "thr_cur",
    studioPage: () => false,
    resolve: vi.fn(async (): Promise<LinkResolution> => ({ found: true, title: "Resolved", spec: null, ...resolved })),
    workbench: () => wb,
    pageWorkbench: () => null,
    openTab: vi.fn(async () => true),
    openStudioTab: vi.fn(async () => true),
    openMain: vi.fn(),
    popOut: vi.fn(async () => true),
    openUrl: vi.fn(() => true),
    action: vi.fn(() => true),
    toast: vi.fn(),
    ...rest,
  };
  return { deps, wb };
}

describe("openLink", () => {
  it("opens every Studio kind through the registry's open spec in the conversation's workbench", async () => {
    for (const kind of LINK_KINDS) {
      const ref = SAMPLE[kind];
      const entry = tabKindEntry(kind);
      if (entry.open.via === "bb") continue;
      const { deps } = fakeDeps();
      const link = linkFor(ref);
      const outcome = await openLink(entity(ref, link), { source: "transcript" }, deps);
      expect(outcome, kind).toEqual({ via: "workbench", pane: null, opened: true });
      expect(deps.openTab, kind).toHaveBeenCalledWith(ref, needsResolution(ref) ? "Resolved" : null, { threadId: "thr_cur" });
      expect(tabOpenFor(ref), kind).not.toBeNull();
    }
  });

  it("⌘ opens a new tab in the second pane: pane 2 when there are two, a new pane when there is one", async () => {
    const one = fakeDeps({ panes: 1 });
    await openLink(entity(SAMPLE.page, "bb://page/x"), { source: "card", modifiers: { meta: true } }, one.deps);
    expect(one.deps.openTab).toHaveBeenCalledWith(SAMPLE.page, "Resolved", { threadId: "thr_cur", pane: "new" });
    const two = fakeDeps({ panes: 2 });
    await openLink(entity(SAMPLE.page, "bb://page/x"), { source: "card", modifiers: { ctrl: true } }, two.deps);
    expect(two.deps.openTab).toHaveBeenCalledWith(SAMPLE.page, "Resolved", { threadId: "thr_cur", pane: 2 });
  });

  it("Shift opens a window of its own at the target's route, and falls back to the workbench when BB can't", async () => {
    const { deps } = fakeDeps();
    expect(await openLink(entity(SAMPLE.page, "bb://page/x"), { source: "card", modifiers: { shift: true }, title: "Plan" }, deps)).toEqual({ via: "window", opened: true });
    expect(deps.popOut).toHaveBeenCalledWith(pathFor(SAMPLE.page), "Plan");
    expect(deps.openTab).not.toHaveBeenCalled();
    const refused = fakeDeps({ popOut: vi.fn(async () => false) });
    expect(await openLink(entity(SAMPLE.page, "bb://page/x"), { source: "card", how: "window" }, refused.deps)).toEqual({ via: "workbench", pane: null, opened: true });
  });

  it("opens bb's own kinds through the workbench API with the server's spec, in a window with popOut", async () => {
    const spec = { kind: "file" as const, target: { kind: "host" as const, hostId: "h1", path: "/Users/p/src/a.ts" }, location: null };
    const { deps, wb } = fakeDeps({ resolved: { title: "a.ts", spec } });
    expect(await openLink(entity(SAMPLE.file, linkFor(SAMPLE.file)), { source: "file" }, deps)).toEqual({ via: "workbench", pane: null, opened: true });
    expect(wb.open).toHaveBeenCalledWith(spec, { focus: true });
    expect(deps.resolve).toHaveBeenCalledWith(SAMPLE.file, "thr_cur");
    const windowed = fakeDeps({ resolved: { title: "a.ts", spec }, popOut: vi.fn(async () => false) });
    expect(await openLink(entity(SAMPLE.file, linkFor(SAMPLE.file)), { source: "file", modifiers: { shift: true } }, windowed.deps)).toEqual({ via: "window", opened: true });
    expect(windowed.wb.popOut).toHaveBeenCalledWith("key-1");
    const second = fakeDeps({ resolved: { title: "Diff of a", spec: { kind: "diff", path: "src/a.ts" } }, panes: 2 });
    await openLink(entity(SAMPLE.diff, linkFor(SAMPLE.diff)), { source: "agent", modifiers: { meta: true } }, second.deps);
    expect(second.wb.open).toHaveBeenCalledWith({ kind: "diff", path: "src/a.ts" }, { focus: true, pane: 2 });
    const browser = fakeDeps();
    expect(await openLink(entity(SAMPLE.browser, linkFor(SAMPLE.browser)), { source: "transcript" }, browser.deps)).toEqual({ via: "workbench", pane: null, opened: true });
    expect(browser.wb.open).toHaveBeenCalledWith({ kind: "url", url: SAMPLE.browser.id }, { focus: true });
    expect(browser.deps.resolve).not.toHaveBeenCalled();
    const noTerminal = fakeDeps();
    expect((await openLink(entity(SAMPLE.terminal, "bb://terminal"), { source: "agent" }, noTerminal.deps)).via).toBe("none");
  });

  it("an external link goes to BB's browser setting, whatever the modifier", async () => {
    const { deps } = fakeDeps();
    const target: LinkTarget = { type: "external", url: "https://example.com/", link: "https://example.com/" };
    expect(await openLink(target, { source: "palette", modifiers: { meta: true } }, deps)).toEqual({ via: "external", opened: true });
    expect(deps.openUrl).toHaveBeenCalledWith("https://example.com/");
    expect(deps.openTab).not.toHaveBeenCalled();
    expect(deps.popOut).not.toHaveBeenCalled();
  });

  it("in a popped-out window, relays the link and the rule to the main window", async () => {
    const { deps } = fakeDeps({ inMain: () => false });
    expect(await openLink(entity(SAMPLE.page, "bb://page/x"), { source: "window", modifiers: { shift: true } }, deps)).toEqual({ via: "relay", how: "window" });
    expect(deps.relay).toHaveBeenCalledWith("bb://page/x", "window");
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.openTab).not.toHaveBeenCalled();
    await openLink({ type: "external", url: "https://example.com/", link: "https://example.com/" }, { source: "window" }, deps);
    expect(deps.relay).toHaveBeenLastCalledWith("https://example.com/", "workbench");
  });

  it("a target that is gone says so in a toast from a conversation, leaving no tab in its panel, and opens the Not found tab on a Studio page", async () => {
    const { deps } = fakeDeps({ resolved: { found: false, title: null } });
    expect(await openLink(entity(SAMPLE.page, "bb://page/pg_0123456789abcdef"), { source: "transcript" }, deps)).toEqual({ via: "notFound", opened: false });
    expect(deps.toast).toHaveBeenCalledWith("That page is gone");
    expect(deps.openStudioTab).not.toHaveBeenCalled();
    expect(deps.openTab).not.toHaveBeenCalled();
    expect(deps.openMain).not.toHaveBeenCalled();
    const page = fakeDeps({ resolved: { found: false, title: null }, thread: () => null, studioPage: () => true });
    expect(await openLink(entity(SAMPLE.page, "bb://page/pg_0123456789abcdef"), { source: "palette" }, page.deps)).toEqual({ via: "notFound", opened: true });
    expect(page.deps.openStudioTab).toHaveBeenCalledWith(
      { pluginId: "studio", tabId: NOT_FOUND_TAB, params: { kind: "page", id: "pg_0123456789abcdef", link: "bb://page/pg_0123456789abcdef" }, title: NOT_FOUND_TITLE },
      { threadId: null },
    );
    const nowhere = fakeDeps({ resolved: { found: false }, thread: () => null });
    expect(await openLink(entity(SAMPLE.page, "bb://page/x"), { source: "transcript" }, nowhere.deps)).toEqual({ via: "notFound", opened: false });
    expect(nowhere.deps.openStudioTab).not.toHaveBeenCalled();
    expect(nowhere.deps.toast).toHaveBeenCalledWith("That page is gone");
  });

  it("names a missing link's kind in its toast, never its address or id", async () => {
    const { deps } = fakeDeps({ resolved: { found: false, title: null } });
    await openLink(entity(SAMPLE.conversation, "bb://conversation/thr_1"), { source: "transcript" }, deps);
    expect(deps.toast).toHaveBeenLastCalledWith("That conversation is gone");
    expect(goneText("Memory record")).toBe("That memory record is gone");
    expect(goneText("Visual Chat board")).toBe("That Visual Chat board is gone");
    expect(goneText("VS Code")).toBe("That VS Code is gone");
  });

  it("checks existence only where something can be gone, and a failed check still opens", async () => {
    expect(needsResolution(SAMPLE.library)).toBe(false);
    expect(needsResolution({ kind: "memory", id: null })).toBe(false);
    expect(needsResolution(SAMPLE.browser)).toBe(false);
    expect(needsResolution(SAMPLE.page)).toBe(true);
    expect(needsResolution(SAMPLE.conversation)).toBe(true);
    const { deps } = fakeDeps({ resolve: vi.fn(async () => { throw new Error("offline"); }) });
    expect(await openLink(entity(SAMPLE.page, "bb://page/x"), { source: "transcript" }, deps)).toEqual({ via: "workbench", pane: null, opened: true });
    const none = fakeDeps();
    await openLink(entity(SAMPLE.library, "bb://library"), { source: "palette" }, none.deps);
    expect(none.deps.resolve).not.toHaveBeenCalled();
    expect(none.deps.openTab).toHaveBeenCalledWith(SAMPLE.library, null, { threadId: "thr_cur" });
  });

  it("with no conversation on screen, a thread opens in the main view and an item in the Studio page's panel, else the main view", async () => {
    const page = fakeDeps({ thread: () => null, studioPage: () => true });
    await openLink(entity(SAMPLE.page, "bb://page/x"), { source: "palette" }, page.deps);
    expect(page.deps.openTab).toHaveBeenCalledWith(SAMPLE.page, "Resolved", { threadId: null });
    await openLink(entity(SAMPLE.conversation, "bb://conversation/thr_1"), { source: "palette" }, page.deps);
    expect(page.deps.openMain).toHaveBeenCalledWith("/threads/thr_1");
    const elsewhere = fakeDeps({ thread: () => null });
    expect(await openLink(entity(SAMPLE.page, "bb://page/x"), { source: "palette" }, elsewhere.deps)).toEqual({ via: "main" });
    expect(elsewhere.deps.openMain).toHaveBeenCalledWith(pathFor(SAMPLE.page));
    expect(elsewhere.deps.openTab).not.toHaveBeenCalled();
  });

  it("a Bot page row opens beside the page: an automation, a todo, a memory record and a thread as tabs of the page's workbench; Shift a window; a deleted one the Not found tab", async () => {
    for (const kind of ["automation", "todo", "record", "conversation", "page"] as const) {
      const page = fakeDeps({ thread: () => null, studioPage: () => true });
      const link = linkFor(SAMPLE[kind]);
      expect(await openLink(entity(SAMPLE[kind], link), { source: "botPage", title: "Row" }, page.deps), kind).toEqual({ via: "workbench", pane: null, opened: true });
      expect(page.deps.openTab, kind).toHaveBeenCalledWith(SAMPLE[kind], "Row", { threadId: null });
      expect(page.deps.openMain, kind).not.toHaveBeenCalled();
      expect(await openLink(entity(SAMPLE[kind], link), { source: "botPage", modifiers: { meta: true } }, page.deps), kind).toEqual({ via: "workbench", pane: "new", opened: true });
      expect(page.deps.openTab, kind).toHaveBeenLastCalledWith(SAMPLE[kind], "Resolved", { threadId: null, pane: "new" });
      expect(await openLink(entity(SAMPLE[kind], link), { source: "botPage", modifiers: { shift: true } }, page.deps), kind).toEqual({ via: "window", opened: true });
      expect(page.deps.popOut, kind).toHaveBeenCalledWith(pathFor(SAMPLE[kind]), "Resolved");
    }
    for (const kind of ["automation", "todo", "record"] as const) {
      const gone = fakeDeps({ thread: () => null, studioPage: () => true, resolved: { found: false, title: null } });
      const link = linkFor(SAMPLE[kind]);
      expect(await openLink(entity(SAMPLE[kind], link), { source: "botPage" }, gone.deps), kind).toEqual({ via: "notFound", opened: true });
      expect(gone.deps.openStudioTab, kind).toHaveBeenCalledWith({ pluginId: "studio", tabId: NOT_FOUND_TAB, params: { kind, id: SAMPLE[kind].id, link }, title: NOT_FOUND_TITLE }, { threadId: null });
      expect(gone.deps.openTab, kind).not.toHaveBeenCalled();
    }
    const split = fakeDeps({ thread: () => null, studioPage: () => true, panes: 2 });
    split.deps.pageWorkbench = () => split.wb;
    expect(await openLink(entity(SAMPLE.todo, linkFor(SAMPLE.todo)), { source: "botPage", modifiers: { meta: true } }, split.deps)).toEqual({ via: "workbench", pane: 2, opened: true });
    expect(split.deps.openTab).toHaveBeenLastCalledWith(SAMPLE.todo, "Resolved", { threadId: null, pane: 2 });
    const beside = fakeDeps();
    await openLink(entity(SAMPLE.todo, linkFor(SAMPLE.todo)), { source: "botPage", modifiers: { meta: true } }, beside.deps);
    expect(beside.deps.openTab).toHaveBeenCalledWith(SAMPLE.todo, "Resolved", { threadId: "thr_cur", pane: "new" });
    expect(tabOpenFor(SAMPLE.automation)).toEqual({ pluginId: "studio", tabId: "automation", params: { id: "bot_main:aut_0123456789abcdef" }, title: "Automation" });
    expect(pathFor(SAMPLE.todo)).toBe("/plugins/studio/studio/todo/loop_0123abcd");
    expect(needsResolution(SAMPLE.record)).toBe(true);
  });

  it("the conversation on screen opens in the main view, not beside itself; a declined workbench falls back to the route", async () => {
    const { deps } = fakeDeps();
    expect(await openLink(entity({ kind: "conversation", id: "thr_cur" }, "bb://conversation/thr_cur"), { source: "transcript" }, deps)).toEqual({ via: "main" });
    expect(deps.openMain).toHaveBeenCalledWith("/threads/thr_cur");
    const declined = fakeDeps({ openTab: vi.fn(async () => false) });
    expect(await openLink(entity(SAMPLE.page, "bb://page/x"), { source: "transcript" }, declined.deps)).toEqual({ via: "main" });
    expect(declined.deps.openMain).toHaveBeenCalledWith(pathFor(SAMPLE.page));
    const main = fakeDeps();
    expect(await openLink(entity(SAMPLE.page, "bb://page/x"), { source: "agent", how: "main" }, main.deps)).toEqual({ via: "main" });
  });
});
