// @vitest-environment happy-dom
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { effectiveSettings, type StudioSettingValues } from "../schema";

const state = vi.hoisted(() => ({
  values: null as Record<string, unknown> | null,
  set: vi.fn(async (_patch: Record<string, unknown>) => {}),
  rpc: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => null),
  open: vi.fn(),
  client: null as unknown,
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => (state.client ??= { call: (method: string, input: unknown) => state.rpc(method, input) }),
  useRealtime: () => {},
  experimental_Icon: () => null,
  experimental_ProviderModelPicker: () => <button type="button">Pick model</button>,
}));
vi.mock("./use-settings", () => ({
  useStudioSettings: () => ({ values: state.values, changed: [], timeZone: "America/New_York", defaultTimeZone: "America/New_York", isLoading: !state.values, error: null, set: state.set }),
  readStudioSettingsNow: () => state.values,
}));
vi.mock("../../ui/live", () => ({ useLive: () => ({ data: { bot: { id: "bot_cos", name: "Chief of Staff" } }, loading: false, error: null, refresh: () => {} }) }));
vi.mock("../../kit/app/nav", () => ({ openAppPath: state.open }));
vi.mock("../../talk/ui/model-settings", () => ({ ModelSettings: () => <div data-testid="talk-models" /> }));

import { registerSettingsApp } from "./sections";
import { requestVoiceSection } from "./voice-anchor";
import { BotAttention } from "../../ui/bot/BotAttention";

let root: Root;
let host: HTMLDivElement;
const sections = new Map<string, { title?: string; experimental_page?: string; component: ComponentType }>();
const order: string[] = [];
registerSettingsApp({ slots: { settingsSection: (section: { id: string; title?: string; experimental_page?: string; component: ComponentType }) => { sections.set(section.id, section); order.push(section.id); } } } as unknown as PluginAppBuilder);

const values = (patch: Partial<StudioSettingValues> = {}) => ({ ...effectiveSettings({}), ...patch });
const $ = (testId: string) => host.querySelector(`[data-testid="${testId}"]`);
const text = () => host.textContent ?? "";
async function render(id: string) {
  const Component = sections.get(id)!.component;
  await act(async () => { root.render(<Component />); });
}
async function click(element: Element | null | undefined) {
  await act(async () => { (element as HTMLElement).click(); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  state.values = values();
  state.set.mockReset().mockResolvedValue(undefined);
  state.rpc.mockReset().mockImplementation(async (method: string) => {
    if (method === "voiceLive.state") return { ready: true, problem: null, cosName: "Dot", monthUsd: 4.1, capUsd: 20, model: "gpt-live-1", voice: "marin", backendModel: "gpt-5.6-luna" };
    if (method === "decisions.jev.status") return { provider: "auto", routes: [{ name: "TypeSafe", model: "jev-latest" }], problems: [] };
    if (method === "decisions.fallback.get") return { mode: "thread" };
    if (method === "mobile.push.status") return { installed: true, ready: true, problem: null, devices: 2, lastDelivery: { at: Date.now() - 4 * 60_000, sent: 2 } };
    if (method === "mobile.push.test") return { ok: true, sent: 2, message: "Sent to 2 phones." };
    return null;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Studio's settings sections", () => {
  it("registers Voice, Recordings and calls, Agent replies, Threads, Smart Queue model and Advanced in order, then Model router, Skill registry, Phone notifications, API keys, Tool Gateway, Agent context and Bring things over from bb last", () => {
    expect(order).toEqual(["settings-voice", "settings-recordings", "settings-replies", "settings-threads", "settings-jev", "settings-advanced", "model-router", "skills-registry", "mobile-push", "api-keys", "tool-gateway", "agent-context", "bring-over"]);
    expect(sections.get("model-router")).toMatchObject({ title: "Model router" });
    expect(sections.get("api-keys")).toMatchObject({ title: "API keys" });
    expect(sections.get("tool-gateway")).toMatchObject({ title: "Tool Gateway" });
    expect(sections.get("agent-context")).toMatchObject({ title: "Agent context" });
    expect(sections.get("bring-over")).toMatchObject({ title: "Bring things over from bb" });
    expect([...sections.values()].slice(0, 6).map((section) => section.title)).toEqual(["Voice", "Recordings and calls", "Agent replies", "Threads", "Smart Queue model", "Advanced"]);
    // Stable BB draws experimental_page "mobile" sections only for the machine-access plugin, so it's on Studio's page.
    expect(sections.get("mobile-push")).toMatchObject({ title: "Phone notifications" });
    expect(sections.get("mobile-push")!.experimental_page).toBeUndefined();
  });

  it("Windows: only on a BB with plugin windows, after Threads: the launcher's shortcut", async () => {
    expect(order).not.toContain("settings-windows");
    const withWindows: string[] = [];
    registerSettingsApp({ slots: { settingsSection: (section: { id: string; component: ComponentType }) => { withWindows.push(section.id); sections.set(section.id, section); } } } as unknown as PluginAppBuilder, true);
    expect(withWindows.slice(3, 5)).toEqual(["settings-threads", "settings-windows"]);
    expect(values().launcherHotkey).toBe("Alt+Space");
    expect(values()).not.toHaveProperty("hudHotkey");
    expect(values()).not.toHaveProperty("hudEnabled");
    await render("settings-windows");
    expect($("setting-launcherHotkey")).not.toBeNull();
    expect($("setting-launcher-show")).not.toBeNull();
    expect($("setting-launcherHotkey-status")).toBeNull();
    expect($("setting-hudEnabled")).toBeNull();
    expect($("setting-hudHotkey")).toBeNull();
    expect($("setting-hud-show")).toBeNull();
  });

  it("Windows: says whether the system accepted the launcher's shortcut, and offers others in one click when it didn't", async () => {
    registerSettingsApp({ slots: { settingsSection: (section: { id: string; component: ComponentType }) => { sections.set(section.id, section); } } } as unknown as PluginAppBuilder, true);
    const windows = await import("../../kit/app/windows");
    const native = vi.spyOn(windows, "useHostWindows").mockReturnValue({ ...windows.NO_HOST_WINDOWS, native: true });
    const { noteWindowHotkey } = await import("../../windows/hotkey");
    try {
      await render("settings-windows");
      await act(async () => { noteWindowHotkey("launcher", { wanted: "Alt+Space", inUse: "Alt+Space", status: "ok" }); });
      expect($("setting-launcherHotkey-status")?.textContent).toBe("The system accepted Option+Space.");
      expect($("setting-launcherHotkey-note")).toBeNull();
      // Another app holds it: the alternate is in use, and three others are a click away.
      await act(async () => { noteWindowHotkey("launcher", { wanted: "Alt+Space", inUse: "Control+Alt+Space", status: "alternate" }); });
      expect($("setting-launcherHotkey-note")?.textContent).toBe("Option+Space is taken by another app. Using Control+Option+Space.");
      expect([...$("setting-launcherHotkey-status")!.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["⌃⌥Space", "⌥⇧Space", "⌘⇧Space"]);
      await click($("setting-launcherHotkey-use-Alt+Shift+Space"));
      expect(state.set).toHaveBeenCalledWith({ launcherHotkey: "Alt+Shift+Space" });
      // The alternate taken too: it says so, and still offers the others.
      await act(async () => { noteWindowHotkey("launcher", { wanted: "Alt+Space", inUse: "", status: "taken" }); });
      expect($("setting-launcherHotkey-note")?.textContent).toBe("Option+Space is taken by another app. Pick another shortcut.");
      expect($("setting-launcher-show")?.textContent).toContain("It has no shortcut");
    } finally {
      await act(async () => { noteWindowHotkey("launcher", null); });
      native.mockRestore();
    }
  });

  it("Voice: dictation and the hands-free settings, with this month's spend; switches save", async () => {
    await render("settings-voice");
    for (const key of ["holdToTalkKey", "replaceBuiltInDictation", "voiceLiveModel", "voiceLiveVoice", "voiceLiveBackendModel", "voiceLiveMonthlyCapUsd"]) expect($(`setting-${key}`)).not.toBeNull();
    expect($("setting-voiceLiveMonthlyCapUsd")!.textContent).toContain("$4.10 used in");
    await click($("setting-replaceBuiltInDictation")!.querySelector('[role="switch"]'));
    expect(state.set).toHaveBeenCalledWith({ replaceBuiltInDictation: false });
  });

  it("Voice: gpt-realtime-2.1 has no backend model", async () => {
    state.values = values({ voiceLiveModel: "gpt-realtime-2.1" });
    await render("settings-voice");
    expect($("setting-voiceLiveBackendModel")!.textContent).toContain("Only gpt-live-1 uses a backend model.");
    expect($("setting-voiceLiveBackendModel")!.querySelector("button[disabled]")).not.toBeNull();
  });

  it("Voice: “Voice settings…” scrolls the section into view, once", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.useFakeTimers();
    requestVoiceSection();
    await render("settings-voice");
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(scroll).toHaveBeenCalledTimes(4);
    act(() => root.unmount());
    root = createRoot(host);
    await render("settings-voice");
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(scroll).toHaveBeenCalledTimes(4);
  });

  it("Recordings: the home server's URL shows only for Home server, and the choice saves", async () => {
    await render("settings-recordings");
    expect($("setting-callServerUrl")).toBeNull();
    await click([...host.querySelectorAll('[role="radio"]')].find((button) => button.textContent === "Home server"));
    expect(state.set).toHaveBeenCalledWith({ callTranscription: "Home server" });
    state.values = values({ callTranscription: "Home server" });
    await render("settings-recordings");
    expect($("setting-callServerUrl")).not.toBeNull();
  });

  it("Agent replies: one quote control sets both quote settings", async () => {
    await render("settings-replies");
    const radio = (label: string) => [...$("setting-quoteSelection")!.querySelectorAll('[role="radio"]')].find((button) => button.textContent === label);
    expect(radio("Before")!.getAttribute("aria-checked")).toBe("true");
    await click(radio("Off"));
    expect(state.set).toHaveBeenLastCalledWith({ quoteSelection: false });
    await click(radio("After"));
    expect(state.set).toHaveBeenLastCalledWith({ quoteSelection: true, quotePosition: "after" });
    for (const key of ["explore_next", "explore_explore", "explore_quickReplies", "explore_replyItems", "emojiItems", "showInSelectionMenu", "showInAssistantBar", "showInUserBar"]) expect($(`setting-${key}`)).not.toBeNull();
  });

  it("Threads: no to-do reminders switch", async () => {
    await render("settings-threads");
    for (const key of ["decisions_enabled", "autoResumeThreads", "snapshotsPerPage"]) expect($(`setting-${key}`)).not.toBeNull();
    expect($("setting-loopsEnabled")).toBeNull();
  });

  it("Smart Queue model: the provider, its order and check, the fallback model, and your own endpoint behind a disclosure, with no Jev in the text", async () => {
    await render("settings-jev");
    expect($("setting-decisions_jevProvider")).not.toBeNull();
    expect(text()).toContain("TypeSafe");
    expect(text()).toContain("If the decision model doesn’t answer, use");
    expect(text()).not.toMatch(/\bJev\b/);
    expect($("setting-decisions_customJevEndpoint")).toBeNull();
    await click($("settings-jev-endpoint")!.querySelector("button"));
    for (const key of ["decisions_customJevEndpoint", "decisions_customJevModel", "decisions_customJevHeaders", "decisions_customJevApiKeyCommand"]) expect($(`setting-${key}`)).not.toBeNull();
  });

  it("API keys: says which are set, saves a typed key, removes one, and never shows a key", async () => {
    let keys = [
      { key: "openaiApiKey", label: "OpenAI API key", description: "Hands-free voice.", set: true },
      { key: "decisions_typesafeApiKey", label: "TypeSafe API key", description: "Smart Queue’s decision model.", set: false },
    ];
    state.rpc.mockImplementation(async (method: string, input: unknown) => {
      if (method === "settings.keys.set") {
        const values = (input as { values: Record<string, string | null> }).values;
        keys = keys.map((entry) => Object.hasOwn(values, entry.key) ? { ...entry, set: !!values[entry.key] } : entry);
      }
      return { keys };
    });
    await render("api-keys");
    const openai = $("api-key-openaiApiKey")!.querySelector("input")!;
    const typesafe = $("api-key-decisions_typesafeApiKey")!.querySelector("input")!;
    expect(openai.type).toBe("password");
    expect(openai.placeholder).toBe("Set");
    expect(typesafe.placeholder).toBe("Not set");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(typesafe, " ts-key ");
      typesafe.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { typesafe.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(state.rpc).toHaveBeenCalledWith("settings.keys.set", { values: { decisions_typesafeApiKey: " ts-key " } });
    expect(typesafe.value).toBe("");
    expect(typesafe.placeholder).toBe("Set");
    await click($("api-key-openaiApiKey")!.querySelector("button"));
    expect(state.rpc).toHaveBeenCalledWith("settings.keys.set", { values: { openaiApiKey: null } });
    expect(openai.placeholder).toBe("Not set");
    expect(text()).not.toContain("ts-key");
  });

  it("Advanced: Smart Queue batch confidence is a number field", async () => {
    await render("settings-advanced");
    const input = $("setting-decisions_batchConfidence")!.querySelector("input")!;
    expect(input.value).toBe("0.5");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(state.set).toHaveBeenCalledWith({ decisions_batchConfidence: 1 });
  });

  it("Phone notifications: push status and a test push", async () => {
    await render("mobile-push");
    await act(async () => {});
    expect($("mobile-push-status")!.textContent).toContain("Sending to 2 phones");
    expect($("mobile-push-status")!.textContent).toContain("Last push 4 minutes ago, to 2 phones.");
    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "Send a test push"));
    expect(state.rpc).toHaveBeenCalledWith("mobile.push.test", null);
    expect(text()).toContain("Sent to 2 phones.");
    expect($("mobile-desk-hold")).toBeNull();
  });

  it("Phone notifications: the hold-while-at-my-Mac switch, on a Mobile plugin that has it", async () => {
    const base = { installed: true, ready: true, problem: null, devices: 1, lastDelivery: null };
    state.rpc.mockImplementation(async (method: string, input: unknown) => {
      if (method === "mobile.push.status") return { ...base, deskHold: { enabled: true, atDesk: true, held: 2 } };
      if (method === "mobile.desk.hold") return { enabled: (input as { enabled: boolean }).enabled, atDesk: true, held: 0 };
      return null;
    });
    await render("mobile-push");
    await act(async () => {});
    const row = $("mobile-desk-hold")!;
    expect(row.textContent).toContain("Hold phone notifications while I'm at my Mac");
    expect(row.textContent).toContain("At your Mac · 2 waiting");
    const toggle = row.querySelector('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await click(toggle);
    expect(state.rpc).toHaveBeenCalledWith("mobile.desk.hold", { enabled: false });
    expect($("mobile-desk-hold")!.textContent).toContain("Off");
    expect($("mobile-desk-hold")!.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
  });
});

describe("Bot ▸ Controls ▸ Attention", () => {
  it("is the time zone alone, this computer's by default", async () => {
    state.values = values({});
    await act(async () => { root.render(<BotAttention botName="Chief of Staff" />); });
    expect(host.querySelector('[role="switch"]')).toBeNull();
    expect($("attention-budget")).toBeNull();
    expect($("attention-quiet")).toBeNull();
    expect($("attention-zone")!.textContent).toContain("This computer · America/New York");
    expect($("attention-zone")!.textContent).not.toContain("STUDIO_LOOP_TIME_ZONE");
  });
});
