import { afterEach, describe, expect, it, vi } from "vitest";
import { QUICK_COMMAND_ID, QUICK_COMMAND_TITLE, QUICK_SHORTCUT, registerQuickCard } from "./quick-app";
import { createQuickStore, expandHref, neighborChats } from "./ui/quick-store";
import { cardRect, COMPOSER_GAP, SAFE_TOP, DEFAULT_GEOMETRY, defaultRect, geometryOf, loadGeometry, MARGIN, MIN_HEIGHT, MIN_WIDTH, movedRect, placeCard, QUICK_GEOMETRY_KEY, resizedRect, SAFE_BOTTOM, saveGeometry } from "./ui/quick-geometry";
import { canvasHref, canvasNewHref } from "./shared";

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), map };
};

describe("the quick card's state", () => {
  it("opens and closes, and each summon starts a fresh chat", () => {
    const store = createQuickStore();
    const seen: boolean[] = [];
    store.subscribe(() => seen.push(store.get().open));
    expect(store.get()).toEqual({ open: false, session: 0, threadId: null });
    store.open();
    expect(store.get()).toEqual({ open: true, session: 1, threadId: null });
    // The first message makes a canvas; the card follows it.
    store.setThread("thr_first");
    expect(store.get().threadId).toBe("thr_first");
    store.close();
    // Closing keeps the chat (it's a canvas in the list); the next summon is a new one.
    expect(store.get()).toEqual({ open: false, session: 1, threadId: "thr_first" });
    store.open();
    expect(store.get()).toEqual({ open: true, session: 2, threadId: null });
    // Opening again while open changes nothing.
    store.open();
    expect(store.get().session).toBe(2);
    expect(seen).toEqual([true, true, false, true]);
  });

  it("Expand opens the card's chat in the full page and closes the card", () => {
    const store = createQuickStore();
    const navigate = vi.fn();
    store.open();
    store.setThread("thr_quick");
    expect(store.expand(navigate)).toBe("/plugins/studio-visual-chat/canvas/thr_quick");
    expect(navigate).toHaveBeenCalledWith(canvasHref("thr_quick"));
    expect(store.get().open).toBe(false);
    // Nothing sent yet: the full page opens a new chat.
    store.open();
    store.expand(navigate);
    expect(navigate).toHaveBeenLastCalledWith(canvasNewHref());
    expect(expandHref(null)).toBe(canvasNewHref());
  });
});

describe("the Visual Chat: Ask command", () => {
  const fakeApp = () => {
    const overlays: { id: string }[] = [];
    const commands: { id: string; title: string; defaultShortcut?: unknown; run(context: unknown): void }[] = [];
    const app = { slots: { experimental_appOverlay: (registration: { id: string }) => overlays.push(registration) }, commands: { register: (registration: (typeof commands)[number]) => commands.push(registration) } };
    return { app: app as never, overlays, commands };
  };

  it("registers the card's overlay and a command with its shortcut, which toggles the card", () => {
    const { app, overlays, commands } = fakeApp();
    const store = registerQuickCard(app);
    expect(overlays.map((overlay) => overlay.id)).toEqual(["quick-card"]);
    expect(commands).toHaveLength(1);
    const [command] = commands;
    expect(command).toMatchObject({ id: QUICK_COMMAND_ID, title: QUICK_COMMAND_TITLE, defaultShortcut: { key: "Space", control: true, shift: true } });
    command!.run({});
    expect(store.get()).toMatchObject({ open: true, session: 1, threadId: null });
    command!.run({});
    expect(store.get().open).toBe(false);
    command!.run({});
    expect(store.get()).toMatchObject({ open: true, session: 2, threadId: null });
  });

  it("has a default shortcut none of BB's or Studio's defaults use, on any platform", () => {
    type Shortcut = { key: string; mod?: boolean; meta?: boolean; control?: boolean; alt?: boolean; shift?: boolean };
    const digits = "123456789".split("");
    const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    // BB's defaults (apps/server/src/services/system/app-keybindings.ts), its desktop menu
    // (apps/desktop/src/desktop-menu-shortcuts.ts, menu.ts), and Studio's search (Mod+Shift+K).
    const taken: Shortcut[] = [
      ...["[", "]", "k", "n", "p", "j", "t", "w", "o", ",", "\\", "0", "=", "-", "r", "f", "l", "d"].map((key) => ({ key, mod: true })),
      ...["p", "o", "e", "x", "[", "]", "k", "t", "n", "r", "c", "m"].map((key) => ({ key, mod: true, shift: true })),
      ...["[", "]"].map((key) => ({ key, control: true, shift: true })),
      ...["m", "p", "t"].flatMap((key) => [{ key, alt: true }, { key, alt: true, shift: true }]),
      ...digits.flatMap((key) => [{ key, control: true }, { key, mod: true }, { key, mod: true, shift: true }]),
      ...arrows.flatMap((key) => [{ key, mod: true, control: true }, { key, mod: true, control: true, shift: true }]),
      { key: "Escape" }, { key: "Enter", mod: true },
    ];
    // Mod is ⌘ on macOS and Ctrl elsewhere, so compare what each platform's keyboard sends.
    const resolve = (each: Shortcut, mac: boolean) => ({ key: each.key.toLowerCase(), meta: !!each.meta || (!!each.mod && mac), control: !!each.control || (!!each.mod && !mac), alt: !!each.alt, shift: !!each.shift });
    for (const mac of [true, false]) {
      const ours = JSON.stringify(resolve(QUICK_SHORTCUT, mac));
      expect(taken.filter((each) => JSON.stringify(resolve(each, mac)) === ours)).toEqual([]);
    }
    expect(QUICK_SHORTCUT).toEqual({ key: "Space", control: true, shift: true });
  });
});

describe("the quick card's place and size", () => {
  const view = { width: 1600, height: 1000 };
  afterEach(() => vi.unstubAllGlobals());

  it("starts bottom right at about 40% of the window", () => {
    const rect = cardRect(DEFAULT_GEOMETRY, view);
    expect(rect.width).toBe(640);
    expect(rect.height).toBe(700);
    expect(rect.left + rect.width).toBe(view.width - MARGIN);
    expect(rect.top + rect.height).toBe(view.height - MARGIN);
  });

  it("starts above the thread's composer, never over it", () => {
    // A thread's composer (with its queue banner), bottom center, under the card's corner.
    const composer = { left: 596, top: 730, width: 720, height: 226 };
    const rect = defaultRect(view, [composer]);
    expect(rect.left + rect.width).toBe(view.width - MARGIN);
    expect(rect.top + rect.height).toBe(composer.top - COMPOSER_GAP);
    expect(rect.height).toBe(composer.top - COMPOSER_GAP - SAFE_TOP);
    // It stays below the page's header bar.
    expect(rect.top).toBeGreaterThanOrEqual(SAFE_TOP);
    // A taller composer (a long draft): the card gets shorter to stay above it and below the header.
    const tall = defaultRect(view, [{ ...composer, top: 520, height: 436 }]);
    expect(tall.top + tall.height).toBe(520 - COMPOSER_GAP);
    expect(tall).toMatchObject({ top: SAFE_TOP, height: 520 - COMPOSER_GAP - SAFE_TOP });
    // In a narrow window the composer spans the width: still above it.
    const narrowView = { width: 760, height: 900 };
    const narrow = defaultRect(narrowView, [{ left: 16, top: 800, width: 728, height: 84 }]);
    expect(narrow.top + narrow.height).toBeLessThanOrEqual(800 - COMPOSER_GAP);
    expect(narrow.top).toBeGreaterThanOrEqual(MARGIN);
    // Hidden composers (zero size) and ones beside the card don't move it.
    expect(defaultRect(view, [{ left: 0, top: 0, width: 0, height: 0 }, { left: 60, top: 700, width: 400, height: 200 }])).toEqual(cardRect(DEFAULT_GEOMETRY, view));
  });

  it("goes under a composer that sits high, as on the home page, never over it", () => {
    // BB's home page in a 1280×633 window: the new-thread composer near the top, centred in the main pane.
    const home = { width: 1280, height: 633 };
    const composer = { left: 436, top: 64, width: 728, height: 128 };
    const rect = defaultRect(home, [composer]);
    expect(rect.top).toBeGreaterThanOrEqual(composer.top + composer.height + COMPOSER_GAP);
    expect(rect.top + rect.height).toBeLessThanOrEqual(home.height - MARGIN);
    expect(rect.left + rect.width).toBe(home.width - MARGIN);
    expect(rect.height).toBeGreaterThanOrEqual(MIN_HEIGHT);
    // A taller window: full size under it.
    const tall = defaultRect({ width: 1280, height: 900 }, [composer]);
    expect(tall).toMatchObject({ height: 630, top: 900 - MARGIN - 630 });
  });

  it("goes to the right of a composer when it fits neither above nor below", () => {
    const composer = { left: 400, top: 300, width: 600, height: 500 };
    const rect = defaultRect(view, [composer]);
    expect(rect.left).toBeGreaterThanOrEqual(composer.left + composer.width + COMPOSER_GAP);
    expect(rect.left + rect.width).toBe(view.width - MARGIN);
    expect(rect.height).toBe(700);
  });

  it("never touches a visible composer wherever it is", () => {
    const touches = (a: { left: number; top: number; width: number; height: number }, b: typeof a) => a.left < b.left + b.width + COMPOSER_GAP && a.left + a.width + COMPOSER_GAP > b.left && a.top < b.top + b.height + COMPOSER_GAP && a.top + a.height + COMPOSER_GAP > b.top;
    for (const size of [{ width: 1600, height: 1000 }, { width: 1280, height: 633 }, { width: 760, height: 900 }]) {
      for (let top = 0; top <= size.height - 100; top += 37) {
        for (const [left, width] of [[size.width * 0.2, size.width * 0.6], [size.width * 0.5, size.width * 0.45], [16, size.width - 32]]) {
          const composer = { left: Math.round(left!), top, width: Math.round(width!), height: 120 };
          const rect = defaultRect(size, [composer]);
          expect(touches(rect, composer), JSON.stringify({ size, composer, rect })).toBe(false);
          expect(rect.top).toBeGreaterThanOrEqual(MARGIN);
          expect(rect.top + rect.height).toBeLessThanOrEqual(size.height - MARGIN);
        }
      }
    }
  });

  it("keeps a safe bottom margin with no composer on screen, and where the user put it wins", () => {
    const rect = defaultRect(view, []);
    expect(rect.top + rect.height).toBe(view.height - SAFE_BOTTOM);
    expect(rect.left + rect.width).toBe(view.width - MARGIN);
    const composer = { left: 596, top: 730, width: 720, height: 226 };
    expect(placeCard(null, view, [composer])).toEqual(defaultRect(view, [composer]));
    // Dragged to the bottom right corner by hand: it stays there, composer or not.
    const saved = { x: 1, y: 1, width: null, height: null };
    expect(placeCard(saved, view, [composer])).toEqual(cardRect(saved, view));
    expect(placeCard(saved, view, [composer]).top + 700).toBe(view.height - MARGIN);
  });

  it("keeps its corner and stays on screen when the window resizes", () => {
    const moved = movedRect(cardRect(DEFAULT_GEOMETRY, view), -2000, -2000, view);
    expect(moved).toMatchObject({ left: MARGIN, top: MARGIN });
    const kept = geometryOf(moved, view, false);
    expect(kept).toMatchObject({ x: 0, y: 0, width: null, height: null });
    // Resized by hand, then the window narrows below the card: it shrinks to fit.
    const big = geometryOf(resizedRect(cardRect(DEFAULT_GEOMETRY, view), { x: -1, y: -1 }, -300, -200, view), view, true);
    expect(big).toMatchObject({ width: 940, height: 900 });
    const narrow = cardRect(big, { width: 700, height: 600 });
    expect(narrow.left).toBeGreaterThanOrEqual(MARGIN);
    expect(narrow.left + narrow.width).toBeLessThanOrEqual(700 - MARGIN);
    expect(narrow.top + narrow.height).toBeLessThanOrEqual(600 - MARGIN);
  });

  it("never resizes below its minimum or past the window", () => {
    const start = cardRect(DEFAULT_GEOMETRY, view);
    expect(resizedRect(start, { x: -1, y: -1 }, 5000, 5000, view)).toMatchObject({ width: MIN_WIDTH, height: MIN_HEIGHT, left: start.left + start.width - MIN_WIDTH });
    const grown = resizedRect(start, { x: 1, y: 1 }, 5000, 5000, view);
    expect(grown.left + grown.width).toBe(view.width - MARGIN);
    expect(grown.top + grown.height).toBe(view.height - MARGIN);
  });

  it("remembers its position and size, this window's first, then the last one saved anywhere", () => {
    const session = memory();
    const local = memory();
    // Never moved or resized: null, the default place.
    expect(loadGeometry([session, local])).toBeNull();
    saveGeometry({ x: 0.25, y: 0.5, width: 500, height: 600 }, [session, local]);
    expect(loadGeometry([session, local])).toEqual({ x: 0.25, y: 0.5, width: 500, height: 600 });
    // A new window has no session entry yet: it starts where the last one was.
    expect(loadGeometry([memory(), local])).toEqual({ x: 0.25, y: 0.5, width: 500, height: 600 });
    // A corrupt or partial entry falls back.
    local.setItem(QUICK_GEOMETRY_KEY, "{nope");
    expect(loadGeometry([memory(), local])).toBeNull();
    local.setItem(QUICK_GEOMETRY_KEY, JSON.stringify({ x: 3, y: -1, width: 500 }));
    expect(loadGeometry([memory(), local])).toEqual({ x: 1, y: 0, width: null, height: null });
  });

  it("uses the browser's storages by default", () => {
    const session = memory();
    const local = memory();
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("localStorage", local);
    saveGeometry({ x: 0, y: 1, width: null, height: null });
    expect(JSON.parse(session.map.get(QUICK_GEOMETRY_KEY)!)).toEqual({ x: 0, y: 1, width: null, height: null });
    expect(local.map.has(QUICK_GEOMETRY_KEY)).toBe(true);
    expect(loadGeometry()).toEqual({ x: 0, y: 1, width: null, height: null });
  });
});

describe("the card's steps between chats", () => {
  const list = [
    { threadId: "thr_old", title: "Old", updatedAt: 1 },
    { threadId: "thr_new", title: "New", updatedAt: 3 },
    { threadId: "thr_mid", title: "Mid", updatedAt: 2 },
  ];
  it("steps back from a fresh chat to the latest one, and forward past the newest to a new chat", () => {
    expect(neighborChats(list, null)).toEqual({ older: list[1], newer: null });
    expect(neighborChats(list, "thr_new")).toEqual({ older: list[2], newer: "new" });
    expect(neighborChats(list, "thr_mid")).toEqual({ older: list[0], newer: list[1] });
    expect(neighborChats(list, "thr_old")).toEqual({ older: null, newer: list[2] });
    // Just made, not listed yet: it's the newest.
    expect(neighborChats(list, "thr_made")).toEqual({ older: list[1], newer: "new" });
    expect(neighborChats([], null)).toEqual({ older: null, newer: null });
  });
});
