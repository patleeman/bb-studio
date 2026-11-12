// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceLiveState } from "../contract";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
const nav = vi.hoisted(() => ({ openAppPath: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_Icon: () => null, useRpc: () => rpc }));
vi.mock("../../../kit/app/nav", () => nav);
vi.mock("../../../kit/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../kit/ui")>()),
  Icon: ({ name, className }: { name: string; className?: string }) => <span data-icon={name} className={className} />,
}));

import { HandsFreeQuickSettings, VOICE_SETTINGS_PATH } from "./QuickSettings";
import { takeVoiceSectionRequest } from "../../../settings/ui/voice-anchor";

const STATE: VoiceLiveState = { ready: true, problem: null, cosName: "Dot", monthUsd: 3.42, capUsd: 20, model: "gpt-live-1", voice: "marin", backendModel: "gpt-5.6-luna" };

let root: Root;
let host: HTMLDivElement;
let state: VoiceLiveState;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView ??= () => {};
  state = { ...STATE };
  rpc.call.mockReset().mockImplementation(async (method: string, input: Record<string, unknown>) => {
    if (method === "voiceLive.configure") {
      state = { ...state, ...input } as VoiceLiveState;
      if (input.model === "gpt-realtime-2.1" && state.voice === "quartz") state.voice = "marin";
    }
    return state;
  });
  nav.openAppPath.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const $ = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

async function rightClick(live = false) {
  act(() => root.render(<HandsFreeQuickSettings live={live}><button type="button" data-testid="waveform">wave</button></HandsFreeQuickSettings>));
  await act(async () => { $("waveform")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })); });
  await flush();
}

/** Opens a submenu the way the keyboard does. */
async function openSub(testId: string) {
  const trigger = $(testId)!;
  await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  await flush();
}

async function pick(testId: string) {
  await act(async () => { $(testId)!.click(); });
  await flush();
}

describe("the waveform button's right-click menu", () => {
  it("shows the next session's model, voice and backend, this month's spend against the cap, and says when changes apply", async () => {
    await rightClick();
    expect(rpc.call).toHaveBeenCalledWith("voiceLive.state", {});
    expect($("handsfree-menu")).not.toBeNull();
    expect($("handsfree-menu-next")!.textContent).toBe("Changes apply to the next session.");
    expect($("handsfree-menu-model")!.textContent).toContain("gpt-live-1");
    expect($("handsfree-menu-voice")!.textContent).toContain("marin");
    expect($("handsfree-menu-backend")!.textContent).toContain("gpt-5.6-luna");
    expect($("handsfree-menu-spend")!.textContent).toBe("This month$3.42 of $20.00");
    // The spend is read only: not a menu item.
    expect($("handsfree-menu-spend")!.getAttribute("role")).not.toBe("menuitem");
  });

  it("while a session runs, it keeps its own settings", async () => {
    await rightClick(true);
    expect($("handsfree-menu-next")!.textContent).toBe("This session keeps its settings. Changes apply to the next one.");
  });

  it("the model submenu checks the current one and saves a pick", async () => {
    await rightClick();
    await openSub("handsfree-menu-model");
    expect($("handsfree-model-gpt-live-1")!.getAttribute("aria-checked")).toBe("true");
    expect($("handsfree-model-gpt-realtime-2.1")!.getAttribute("aria-checked")).toBe("false");
    await pick("handsfree-model-gpt-realtime-2.1");
    expect(rpc.call).toHaveBeenCalledWith("voiceLive.configure", { model: "gpt-realtime-2.1" });
  });

  it("the voice submenu lists the chosen model's own voices and saves a pick", async () => {
    await rightClick();
    await openSub("handsfree-menu-voice");
    const voices = [...$("handsfree-voices")!.querySelectorAll("[role=menuitemradio]")].map((item) => item.textContent);
    expect(voices).toHaveLength(22);
    expect(voices).toEqual(expect.arrayContaining(["marin", "quartz", "vesper"]));
    expect(voices).not.toContain("cedar");
    expect($("handsfree-voice-marin")!.getAttribute("aria-checked")).toBe("true");
    await pick("handsfree-voice-quartz");
    expect(rpc.call).toHaveBeenCalledWith("voiceLive.configure", { voice: "quartz" });

    // Realtime's list instead, after switching models.
    state = { ...state, model: "gpt-realtime-2.1", voice: "marin" };
    await rightClick();
    await openSub("handsfree-menu-voice");
    const realtime = [...$("handsfree-voices")!.querySelectorAll("[role=menuitemradio]")].map((item) => item.textContent);
    expect(realtime).toEqual(["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"]);
  });

  it("the backend submenu saves a pick; Realtime has no backend", async () => {
    await rightClick();
    await openSub("handsfree-menu-backend");
    expect($("handsfree-backend-gpt-5.6-luna")!.getAttribute("aria-checked")).toBe("true");
    await pick("handsfree-backend-gpt-5.6-terra");
    expect(rpc.call).toHaveBeenCalledWith("voiceLive.configure", { backendModel: "gpt-5.6-terra" });

    state = { ...state, model: "gpt-realtime-2.1" };
    await rightClick();
    expect($("handsfree-menu-backend")!.hasAttribute("data-disabled")).toBe(true);
    expect($("handsfree-menu-backend")!.textContent).toContain("None");
  });

  it("Voice settings… opens Studio's settings and asks its Voice section to scroll into view, once", async () => {
    await rightClick();
    await pick("handsfree-menu-settings");
    expect(nav.openAppPath).toHaveBeenCalledWith(VOICE_SETTINGS_PATH);
    expect(VOICE_SETTINGS_PATH).toBe("/settings/plugins/studio");
    // The section (src/settings/ui/sections.tsx) takes the request when it mounts.
    expect(takeVoiceSectionRequest()).toBe(true);
    expect(takeVoiceSectionRequest()).toBe(false);
  });
});
