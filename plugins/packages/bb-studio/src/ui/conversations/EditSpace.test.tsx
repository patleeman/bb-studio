// @vitest-environment jsdom
// Edit space: the name, presence, appearance and default model of a Bot's space
// in one view, built from bb's own controls, saved together.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  call: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => ({ bot: null, run: null })),
  history: null as unknown,
  /** bot_get: the Bot as stored, with its default model. */
  stored: null as unknown,
}));
vi.mock("../live", () => ({
  useCall: () => state.call,
  useLive: (method: string) => ({ data: method === "bot_get" ? state.stored : state.history, error: null, loading: false, refresh: () => {} }),
}));
// bb's model picker: shows its value; its button picks Sonnet.
vi.mock("../bot/DefaultModel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bot/DefaultModel")>()),
  DefaultModelPicker: ({ value, onChange }: { value: { providerId: string; model: string } | null; onChange(next: unknown): void }) => (
    <span data-testid="default-model-picker" data-value={value ? `${value.providerId}/${value.model}` : ""}>
      <button type="button" onClick={() => onChange({ providerId: "claude", model: "sonnet", reasoningLevel: "medium" })}>pick sonnet</button>
    </span>
  ),
}));
vi.mock("../../kit/ui/icon", () => ({ Icon: () => null }));
import { EditSpace } from "./EditSpace";
import { presenceDraft, resetPresenceState } from "../../presence/ui/state";
import { defaultAppearance } from "../../theme/appearance";
import { GRID } from "../../theme/builtin/grid";
import { appearanceDraft, appearanceOverrides, forgetSavedAppearance, setAppearanceDraft, shownAppearance } from "../../theme/ui/state";
import { STAGE_ATTRIBUTE, useMainViewRect, type StageRect } from "./EditSpaceStage";

const bot = { id: "cos", name: "Chief of Staff", avatar: "🤖", shape: null as string | null, color: "#22c55e", avatarImageUrl: null as string | null, primary: true, mainThreadId: "main", needsYou: false, appearance: null };
let root: Root;
let host: HTMLDivElement;
const $ = (selector: string) => document.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const onClose = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Radix's slider measures its thumb.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.call.mockClear();
  state.call.mockImplementation(async () => ({ bot: null, run: null }));
  state.history = null;
  state.stored = null;
  onClose.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); resetPresenceState(); });

const mount = async (over: Partial<typeof bot> = {}) => {
  await act(async () => { root.render(<EditSpace bot={{ ...bot, ...over } as never} onClose={onClose} />); });
};
const click = async (element: HTMLElement | null | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => { element!.click(); });
};
const change = async (element: HTMLElement | null, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(element, value); element!.dispatchEvent(new Event("input", { bubbles: true })); });
};
const button = (label: string) => $$("button").find((each) => each.textContent === label);

it("starts from the presence the Bot shows: its saved one, else its default form", async () => {
  await mount();
  expect($('[data-testid="presence-tile"][aria-checked="true"]')!.dataset.form).toBe("tesseract");
  expect(presenceDraft()).toEqual({ botId: "cos", presence: { form: "tesseract", color: { source: "theme" }, motion: 1 } });
  await act(async () => { root.unmount(); });
  expect(presenceDraft()).toBeNull();
  root = createRoot(host);
  await mount({ presence: { form: "knot", color: { source: "custom", hex: "#00aaff" }, motion: 0.5 } } as never);
  expect($('[data-testid="presence-tile"][aria-checked="true"]')!.dataset.form).toBe("knot");
  expect($('[data-testid="presence-motion"]')!.textContent).toBe("0.5×");
});

it("is one view with no tabs: Name, Presence, the Appearance picker with its sliders and effects, then Default model, then Reset, Cancel and Save", async () => {
  state.stored = { bot: { id: "cos", defaultModel: { providerId: "claude", model: "opus", reasoningLevel: "high", modelName: "Opus 5.5" } }, run: null };
  await mount();
  const view = $('[data-testid="edit-space"]')!;
  expect(view.querySelector('[role="radiogroup"][aria-label="Edit space"]')).toBeNull();
  expect($$('[data-testid^="edit-space-tab-"]')).toEqual([]);
  const order = ['input[aria-label="Name"]', '[role="radiogroup"][aria-label="Form"]', '[role="radiogroup"][aria-label="Scene"], [aria-label="Scene"]', '[data-theme-id="none"]', '[aria-label="Intensity"]', '[role="switch"][aria-label="Use on every Bot"]', '[data-testid="default-model-picker"]', '[data-testid="theme-picker-actions"]'].map((selector) => {
    const element = view.querySelector(selector);
    expect(element, selector).not.toBeNull();
    return element!;
  });
  for (let index = 1; index < order.length; index += 1) expect(order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING, String(index)).toBeTruthy();
  expect(view.querySelector('[data-testid="theme-picker"]')!.closest("[hidden]")).toBeNull();
  expect([...view.querySelectorAll('[data-testid="theme-picker-actions"] button')].map((each) => each.textContent)).toEqual(["Reset", "Cancel", "Save"]);
});

it("has none of the old tint controls: no color swatches or hex, no Gradient, no System/Light/Dark, no Grain", async () => {
  await mount();
  expect($$('[data-testid="space-preset"], [data-testid="edit-space-custom"], [data-testid="custom-color"]')).toEqual([]);
  expect($('[role="switch"][aria-label="Gradient"]')).toBeNull();
  expect($('[role="radiogroup"][aria-label="Theme"]')).toBeNull();
  expect($('[aria-label="Grain"]')).toBeNull();
  const labels = $$('[data-testid="edit-space"] label, [data-testid="edit-space"] [data-settings-label]').map((each) => each.textContent ?? "");
  for (const word of ["Color", "Gradient", "Grain"]) expect(labels.some((label) => label.trim() === word), word).toBe(false);
});

it("saves the name and a picked form together, then closes", async () => {
  await mount();
  await change($('input[aria-label="Name"]'), "Chief");
  await click($('[data-testid="presence-tile"][data-form="orb"]'));
  expect(presenceDraft()?.presence.form).toBe("orb");
  await click($('[data-testid="edit-space-save"]'));
  expect(state.call.mock.calls).toEqual([
    ["bot_set", { botId: "cos", name: "Chief" }],
    ["bot_set_presence", { botId: "cos", presence: { form: "orb", color: { source: "theme" }, motion: 1 } }],
  ]);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("has no Avatar, Emoji or Image control, and writes nothing for a Bot's old avatar fields", async () => {
  await mount({ avatarImageUrl: "/img1.png", shape: "blob" });
  expect($('[role="radiogroup"][aria-label="Icon"]')).toBeNull();
  expect($$('[data-testid="edit-space-emoji"], [data-testid="edit-space-image"], input[type="file"]')).toEqual([]);
  expect($$('[data-testid="edit-space"] img')).toEqual([]);
  await click($('[data-testid="presence-tile"][data-form="klein"]'));
  await click($('[data-testid="edit-space-save"]'));
  expect(state.call.mock.calls.map((each) => each[0])).toEqual(["bot_set_presence"]);
});

it("Create sends the description to the Bot", async () => {
  state.call.mockImplementation(async (method: string) => (method === "presence_ask" ? { sent: true } : { bot: null, run: null }));
  await mount();
  expect($('[data-testid="presence-create-form"]')).toBeNull();
  await click($('[data-testid="presence-create"]'));
  await change($('input[aria-label="Presence description"]'), "a lava lamp");
  await act(async () => { $('[data-testid="presence-create-form"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(state.call.mock.calls).toEqual([["presence_ask", { botId: "cos", prompt: "a lava lamp" }]]);
  expect($('[data-testid="presence-asked"]')!.textContent).toBe("Sent to Chief of Staff");
});

it("writes nothing when nothing changed, never the old tint, and says so when a save fails", async () => {
  await mount();
  await click($('[data-testid="edit-space-save"]'));
  expect(state.call).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
  onClose.mockClear();
  state.call.mockRejectedValueOnce(new Error("Bot not found."));
  await mount();
  await change($('input[aria-label="Name"]'), "Chief");
  await click($('[data-testid="edit-space-save"]'));
  expect(state.call.mock.calls.map((each) => each[0])).toEqual(["bot_set"]);
  expect($('[role="alert"]')?.textContent).toBe("Bot not found.");
  expect(onClose).not.toHaveBeenCalled();
});

it("Cancel and Esc close without saving", async () => {
  await mount();
  await click(button("Cancel"));
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(state.call).not.toHaveBeenCalled();
});

it("shows the Bot's default model and saves a new one with the rest; unchanged, it isn't written", async () => {
  state.stored = { bot: { id: "cos", defaultModel: { providerId: "claude", model: "opus", reasoningLevel: "high", modelName: "Opus 5.5" } }, run: null };
  await mount();
  expect($('[data-testid="default-model-picker"]')?.dataset.value).toBe("claude/opus");
  await click($('[data-testid="edit-space-save"]'));
  expect(state.call.mock.calls.map((each) => each[0])).toEqual([]);
  state.call.mockClear();
  await mount();
  await click(button("pick sonnet"));
  expect($('[data-testid="default-model-picker"]')?.dataset.value).toBe("claude/sonnet");
  await click($('[data-testid="edit-space-save"]'));
  expect(state.call.mock.calls).toEqual([
    ["bot_set_default_model", { botId: "cos", providerId: "claude", model: "sonnet", reasoning: "medium" }],
  ]);
});

describe("Appearance (round 8)", () => {
  afterEach(() => setAppearanceDraft("cos", null, false));
  const calls = (method: string) => state.call.mock.calls.filter(([name]) => name === method).map(([, input]) => input);

  it("picks a theme with no tab to switch, previews it while open, and saves it on the Bot", async () => {
    await mount();
    expect($('[data-testid="theme-picker"]')?.textContent).not.toContain("Chief of Staff");
    await click($('[data-theme-id="grid"]'));
    expect(appearanceDraft()).toEqual({ botId: "cos", appearance: defaultAppearance(GRID) });
    await click($('[data-testid="edit-space-save"]'));
    expect(calls("bot_set_appearance")).toEqual([{ botId: "cos", appearance: defaultAppearance(GRID) }]);
    expect(onClose).toHaveBeenCalled();
  });

  it("saves nothing for an unchanged appearance, and puts it on every Bot with Use on every Bot", async () => {
    await mount({ appearance: defaultAppearance(GRID) } as never);
    await click($('[data-testid="edit-space-save"]'));
    expect(calls("bot_set_appearance")).toEqual([]);
    state.call.mockClear();
    const bots = [{ ...bot, appearance: defaultAppearance(GRID) }, { ...bot, id: "home", appearance: null }, { ...bot, id: "lab", appearance: defaultAppearance(GRID) }];
    await act(async () => { root.render(<EditSpace key="every" bot={bots[0] as never} bots={bots as never} onClose={onClose} />); });
    await click($('[role="switch"][aria-label="Use on every Bot"]'));
    await click($('[data-testid="edit-space-save"]'));
    expect(calls("bot_set_appearance")).toEqual([{ botId: "home", appearance: defaultAppearance(GRID) }]);
  });

  it("takes the theme off with None", async () => {
    await mount({ appearance: defaultAppearance(GRID) } as never);
    await click($('[data-theme-id="none"]'));
    await click($('[data-testid="edit-space-save"]'));
    expect(calls("bot_set_appearance")).toEqual([{ botId: "cos", appearance: null }]);
  });
});

describe("in the main view (round 8, 8f)", () => {
  afterEach(() => { setAppearanceDraft("cos", null, false); forgetSavedAppearance(["cos"]); });
  const calls = (method: string) => state.call.mock.calls.filter(([name]) => name === method).map(([, input]) => input);
  const stage: StageRect = { top: 38, left: 260, width: 900, height: 640 };
  const mountStaged = async (over: Record<string, unknown> = {}) => {
    await act(async () => { root.render(<EditSpace bot={{ ...bot, ...over } as never} onClose={onClose} stage={stage} />); });
  };

  it("covers BB's main view with the one view and Close, keeps Reset, Cancel and Save stuck to the pane's bottom, and hides what was there until it closes", async () => {
    await mountStaged();
    const staged = $('[data-testid="edit-space-stage"]')!;
    expect(staged.parentElement).toBe(document.body);
    expect(host.contains(staged)).toBe(false);
    expect(staged.hasAttribute("data-bb-plugin-root")).toBe(true);
    expect([staged.style.top, staged.style.left, staged.style.width, staged.style.height]).toEqual(["38px", "260px", "900px", "640px"]);
    expect(document.documentElement.hasAttribute(STAGE_ATTRIBUTE)).toBe(true);
    expect(document.getElementById("studio-edit-space-style")!.textContent).toContain('main[data-sidebar="inset"] { visibility: hidden; }');
    expect(staged.querySelector('[data-testid="edit-space-pane"] [data-testid="theme-picker"]')).not.toBeNull();
    expect([...staged.querySelectorAll('[data-testid="theme-picker-actions"] button')].map((each) => each.textContent)).toEqual(["Reset", "Cancel", "Save"]);
    expect(staged.querySelector('[data-testid="theme-picker-actions"]')!.className.split(" ")).toEqual(expect.arrayContaining(["sticky", "-bottom-5", "-mb-5", "z-20"]));
    expect(staged.querySelector('[data-testid="edit-space-pane"]')!.className.split(" ")).toContain("pb-5");
    const pane = staged.querySelector<HTMLElement>('[data-testid="edit-space-pane"]')!;
    expect(pane.className.split(" ")).toEqual(expect.arrayContaining(["max-h-full", "overflow-x-hidden", "overflow-y-auto"]));
    expect(staged.querySelector('[data-testid="edit-space-scroll"]')!.className.split(" ")).toContain("overflow-hidden");
    expect(pane.firstElementChild!.getAttribute("data-testid")).toBe("edit-space-title-row");
    expect(pane.firstElementChild!.className.split(" ")).toEqual(expect.arrayContaining(["sticky", "top-0", "-mx-5"]));
    expect(pane.firstElementChild!.querySelector('[data-testid="edit-space-close"]')).not.toBeNull();
    expect(pane.lastElementChild!.querySelector('[data-testid="theme-picker-actions"]') ?? pane.querySelector('[data-testid="theme-picker-actions"]')).not.toBeNull();
    expect(staged.querySelector("section > header")).toBeNull();
    expect(staged.querySelector('[data-testid="theme-picker-actions"]')!.className.split(" ")).toEqual(expect.arrayContaining(["-mx-5", "-mb-5"]));
    expect(staged.innerHTML).not.toMatch(/overflow-x-(auto|scroll)/);
    expect(staged.querySelector('[data-testid="edit-space-pane"] input[aria-label="Name"]')).not.toBeNull();
    expect(staged.querySelector('[data-testid="edit-space-pane"] [data-testid="edit-space-model"]')).not.toBeNull();
    expect(staged.querySelector('[role="radiogroup"][aria-label="Edit space"]')).toBeNull();
    await click($('[data-testid="edit-space-close"]'));
    expect(onClose).toHaveBeenCalled();
    act(() => root.render(<span />));
    expect(document.documentElement.hasAttribute(STAGE_ATTRIBUTE)).toBe(false);
  });

  it("under a scene theme its title row is bare above the pane, in the pane's own column, and the pane has no border", async () => {
    document.documentElement.setAttribute("data-studio-glass", "");
    try {
      await mountStaged();
      const pane = $('[data-testid="edit-space-pane"]')!;
      const row = $('[data-testid="edit-space-title-row"]')!;
      expect(row.nextElementSibling).toBe(pane);
      expect(row.parentElement).toBe(pane.parentElement);
      expect(pane.querySelector('[data-testid="edit-space-title-row"]')).toBeNull();
      for (const each of ["mx-auto", "w-full", "max-w-[900px]", "px-5"]) {
        expect(row.className.split(" ")).toContain(each);
        expect(pane.className.split(" ")).toContain(each);
      }
      expect(row.className.split(" ")).toContain("h-(--bb-window-title-bar-height,2.75rem)");
      expect(row.className).not.toMatch(/sticky|bg-|fixed|absolute/);
      expect(pane.className).not.toMatch(/border/);
      expect($('[data-testid="edit-space-scroll"]')!.className).not.toMatch(/pt-/);
      expect(row.querySelector('[data-testid="edit-space-close"]')).not.toBeNull();
    } finally {
      document.documentElement.removeAttribute("data-studio-glass");
    }
  });

  it("shows the scene through the stage for a scene theme, and a solid stage otherwise", async () => {
    await mountStaged({ appearance: defaultAppearance(GRID) });
    expect($('[data-testid="edit-space-stage"]')!.className).not.toContain("bg-background");
    await click($('[data-theme-id="nord"]'));
    expect($('[data-testid="edit-space-stage"]')!.className).toContain("bg-background");
  });

  it("applies a saved theme at once: the new one shows before the Bot list catches up, with no flash of the old one", async () => {
    let finish: () => void = () => {};
    state.call.mockImplementation(async (method: string) => {
      if (method === "bot_set_appearance") await new Promise<void>((resolve) => { finish = resolve; });
      return { bot: null, run: null };
    });
    const stale = { ...bot, appearance: null };
    await mountStaged();
    await click($('[data-theme-id="grid"]'));
    await click($('[data-testid="edit-space-save"]'));
    expect(calls("bot_set_appearance")).toEqual([{ botId: "cos", appearance: defaultAppearance(GRID) }]);
    expect(shownAppearance(stale, appearanceOverrides())).toEqual(defaultAppearance(GRID));
    await act(async () => { finish(); });
    expect(onClose).toHaveBeenCalled();
    act(() => root.render(<span />));
    expect(appearanceOverrides().draft).toBeNull();
    expect(shownAppearance(stale, appearanceOverrides())).toEqual(defaultAppearance(GRID));
  });

  it("drops the saved theme when the save fails, and says so", async () => {
    state.call.mockImplementation(async (method: string) => { if (method === "bot_set_appearance") throw new Error("No theme grid."); return { bot: null, run: null }; });
    await mountStaged();
    await click($('[data-theme-id="grid"]'));
    await click($('[data-testid="edit-space-save"]'));
    expect($('[role="alert"]')!.textContent).toBe("No theme grid.");
    expect(appearanceOverrides().saved.has("cos")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("in the sidebar, where BB has no main view to cover", () => {
  it("keeps Reset, Cancel and Save on a row stuck to the sidebar's bottom, last in the view", async () => {
    await mount();
    const pickerActions = $('[data-testid="theme-picker-actions"]')!;
    expect(pickerActions.className.split(" ")).toEqual(expect.arrayContaining(["sticky", "bottom-0", "z-20"]));
    expect([...pickerActions.querySelectorAll("button")].map((each) => each.textContent)).toEqual(["Reset", "Cancel", "Save"]);
    expect($('[data-testid="theme-picker"]')!.lastElementChild).toBe(pickerActions);
    expect($('[data-testid="edit-space-stage"]')).toBeNull();
  });
});

describe("useMainViewRect", () => {
  function Probe({ enabled }: { enabled: boolean }) {
    const rect = useMainViewRect(enabled);
    return <output data-testid="rect">{rect ? `${rect.left},${rect.top},${rect.width},${rect.height}` : "none"}</output>;
  }

  it("finds BB's main view and its box, and nothing without one or while off", async () => {
    await act(async () => { root.render(<Probe enabled />); });
    expect($('[data-testid="rect"]')!.textContent).toBe("none");
    const main = document.createElement("main");
    main.dataset.sidebar = "inset";
    main.getBoundingClientRect = () => ({ top: 40, left: 280, width: 1000, height: 700 }) as DOMRect;
    document.body.append(main);
    try {
      await act(async () => { root.render(<Probe enabled={false} />); });
      expect($('[data-testid="rect"]')!.textContent).toBe("none");
      await act(async () => { root.render(<Probe enabled />); });
      expect($('[data-testid="rect"]')!.textContent).toBe("280,40,1000,700");
    } finally {
      main.remove();
    }
  });
});
