import { describe, expect, it } from "vitest";
import { bbTheme, defaultBbTheme, type BbTheme } from "../theme";
import { createThemeStore } from "./bb-theme";
import { lookCss } from "./board-css";
import { frameSrcDoc, frameState, STATE_MESSAGE } from "./frame";
import { pageCss } from "./page-frame";

const NORD_DARK = bbTheme("dark", { colors: { background: "#2e3440", foreground: "#d8dee9", card: "#2e3440", primary: "#88c0d0", border: "#434c5e" } });

/** A theme source a test can change, as BB's palette switch would. */
function fakeSource(start: BbTheme) {
  let theme = start;
  let notify: (() => void) | null = null;
  return {
    read: () => theme,
    watch(changed: () => void) { notify = changed; return () => { notify = null; }; },
    set(next: BbTheme) { theme = next; notify?.(); },
    get watching() { return notify !== null; },
  };
}

/** Runs a frame document's boot script in a stand-in window: what the frame does with a state message. */
function bootFrame(doc: string) {
  const boot = /<script>(.*?)<\/script>/s.exec(doc)![1]!;
  const tokens = { textContent: /<style id="cv-tokens">(.*?)<\/style>/s.exec(doc)![1]! };
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const parent = { postMessage() {} };
  const win: Record<string, unknown> = { dispatchEvent() { return true; } };
  const document = { getElementById: (id: string) => (id === "cv-tokens" ? tokens : null) };
  const addEventListener = (type: string, listener: (event: unknown) => void) => { (listeners[type] ??= []).push(listener); };
  class CustomEvent { constructor(public type: string, public init: unknown) {} }
  new Function("window", "document", "parent", "addEventListener", "CustomEvent", boot)(win, document, parent, addEventListener, CustomEvent);
  return {
    tokens,
    receive(message: unknown) { for (const listener of listeners.message ?? []) listener({ source: parent, data: message }); },
  };
}

describe("BB's theme, live", () => {
  it("tells its readers when BB's theme changes, and only then", () => {
    const source = fakeSource(defaultBbTheme("light"));
    const store = createThemeStore(source);
    let heard = 0;
    const stop = store.subscribe(() => { heard += 1; });
    expect(store.get().colors.background).toBe("#ffffff");
    // The same theme read again (a class flip that changes nothing) isn't news.
    source.set(defaultBbTheme("light"));
    expect(heard).toBe(0);
    source.set(NORD_DARK);
    expect(heard).toBe(1);
    expect(store.get()).toBe(NORD_DARK);
    stop();
    expect(source.watching).toBe(false);
  });

  it("updates a frame's tokens when BB's theme changes, without reloading it", () => {
    const light = defaultBbTheme("light");
    const doc = frameSrcDoc(`<p class="cv-body">hi</p>`, "editorial", light);
    const frame = bootFrame(doc);
    expect(frame.tokens.textContent).toContain("--cv-paper:#ffffff");
    // BB switches to Nord dark: the next state message carries the new tokens.
    const state = frameState({ data: null, options: {}, mode: "dark", width: 400, height: 100, look: "editorial", theme: NORD_DARK });
    expect(state.type).toBe(STATE_MESSAGE);
    frame.receive(state);
    expect(frame.tokens.textContent).toContain("--cv-paper:#2e3440");
    expect(frame.tokens.textContent).toContain("--cv-ink:#d8dee9");
    expect(frame.tokens.textContent).toContain("color-scheme:dark");
    expect(frame.tokens.textContent).not.toContain("--cv-paper:#ffffff");
  });

  it("restyles the page and the board on the new theme", () => {
    expect(pageCss("instrument", defaultBbTheme("dark"))).toContain(`--cv-paper:${defaultBbTheme("dark").colors.background}`);
    expect(pageCss("instrument", NORD_DARK)).toContain("--cv-paper:#2e3440");
    const board = lookCss("field", NORD_DARK);
    expect(board).toContain(".cv-scope[data-cv-look=field]{--cv-paper:#2e3440");
    // One token set, the current theme's: no fixed dark copy that would win over it.
    expect(board).not.toContain("[data-cv-mode=dark]{");
  });
});
