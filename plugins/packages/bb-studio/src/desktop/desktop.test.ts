import { describe, expect, it, vi } from "vitest";
import { decodePinMention, encodePinMention, pinChipLabel, pinFacts, pinMentionContext, type PinLike } from "./pins";
import { desktopCallerOf, registerDesktopTools, toolResult } from "./server";
import { allGranted, threadIdFromPath, type DesktopPin, type DesktopState } from "./host";


const pinLike: PinLike = {
  number: 2,
  app: "Safari",
  bundleId: "com.apple.Safari",
  windowTitle: "Pricing",
  windowBounds: { x: 70, y: 58 },
  url: "https://www.acme.dev/pricing",
  role: "button",
  label: "Start free trial",
  pid: 41,
  windowId: 7,
  x: 480.4,
  y: 320.6,
  secure: false,
  imagePath: "/tmp/pin.png",
};

function pin(overrides: Partial<DesktopPin> = {}): DesktopPin {
  return {
    id: "p1",
    number: 1,
    threadId: "thr_1",
    createdAt: 0,
    x: 10,
    y: 10,
    app: "Safari",
    bundleId: null,
    pid: 1,
    windowId: 2,
    windowTitle: null,
    windowBounds: null,
    url: null,
    role: null,
    label: null,
    elementFrame: null,
    secure: false,
    imagePath: null,
    thumbnail: null,
    placed: true,
    taken: false,
    ...overrides,
  };
}

function state(overrides: Partial<DesktopState> = {}): DesktopState {
  return {
    supported: true,
    driver: { status: "ready", version: "0.47.24", error: null },
    helper: true,
    permissions: { accessibility: true, screenRecording: true, inputMonitoring: true, checked: true },
    restartAdvised: false,
    hud: { shown: true, threadId: "thr_1" },
    pointing: false,
    talkKey: "fn",
    talking: false,
    pins: [],
    activity: null,
    grant: { kind: "none", threadId: null },
    ask: null,
    ...overrides,
  };
}

describe("pin chips", () => {
  it("round-trips a pin's facts through the mention id", () => {
    const facts = pinFacts(pinLike);
    expect(facts).toMatchObject({ x: 480, y: 321, windowX: 410, windowY: 263, image: true });
    expect(decodePinMention(encodePinMention(facts))).toEqual(facts);
    expect(decodePinMention("p1.not-json")).toBeNull();
    expect(decodePinMention("other")).toBeNull();
  });

  it("keeps long ids short and readable", () => {
    const facts = pinFacts({ ...pinLike, url: `https://example.com/${"x".repeat(3000)}` });
    const id = encodePinMention(facts);
    expect(id.length).toBeLessThan(1800);
    expect(decodePinMention(id)?.number).toBe(2);
  });

  it("labels the chip with the number, app, element and page", () => {
    expect(pinChipLabel(pinFacts(pinLike))).toBe("2 · Safari · “Start free trial” · acme.dev/pricing");
    expect(pinChipLabel({ number: 3, app: null, label: null, role: null, url: null, windowTitle: null })).toBe("3 · Screen");
  });

  it("tells the agent where the pin is, and that password fields are off-limits", () => {
    const text = pinMentionContext(pinFacts(pinLike));
    expect(text).toContain("pid 41, window_id 7");
    expect(text).toContain("URL: https://www.acme.dev/pricing");
    expect(text).toContain("screenshot");
    const secure = pinMentionContext(pinFacts({ ...pinLike, secure: true, label: "secret" }));
    expect(secure).toContain("Off-limits");
    expect(secure).not.toContain("secret");
  });
});

describe("the HUD's state", () => {
  it("needs all three permissions before pointing", () => {
    expect(allGranted(state())).toBe(true);
    expect(allGranted(state({ permissions: { accessibility: true, screenRecording: false, inputMonitoring: true, checked: true } }))).toBe(false);
    expect(allGranted(state({ permissions: { accessibility: true, screenRecording: true, inputMonitoring: true, checked: false } }))).toBe(false);
    expect(allGranted(null)).toBe(false);
  });

  it("takes the conversation from the route", () => {
    expect(threadIdFromPath("/projects/proj_1/threads/thr_abc-1")).toBe("thr_abc-1");
    expect(threadIdFromPath("/settings")).toBeNull();
  });

  it("inserts each placed pin of its own conversation once", async () => {
    const { pinsToInsert } = await import("./hud-model");
    const pins = [pin(), pin({ id: "p2", placed: false }), pin({ id: "p3", taken: true }), pin({ id: "p4", threadId: "thr_2" }), pin({ id: "p5" })];
    expect(pinsToInsert(state({ pins }), "thr_1", new Set(["p5"])).map((item) => item.id)).toEqual(["p1"]);
    expect(pinsToInsert(state({ pins }), null, new Set())).toEqual([]);
  });

  it("states what the agent is doing in its own conversation", async () => {
    const { activityLine } = await import("./hud-model");
    const activity = { threadId: "thr_1", agent: "Bot", caption: "clicking", app: "Safari", phase: "acting" as const, foreground: false, updatedAt: 0 };
    expect(activityLine(state({ activity }), "thr_1")).toBe("Acting in Safari · background · your cursor is free");
    expect(activityLine(state({ activity: { ...activity, phase: "paused" } }), "thr_1")).toBe("Paused · you are using Safari");
    expect(activityLine(state({ activity: { ...activity, foreground: true } }), "thr_1")).toBe("Using your cursor in Safari");
    expect(activityLine(state({ activity }), "thr_2")).toBeNull();
  });

  it("opens the HUD on top, on its conversation, with the shortcut", async () => {
    const { desktopHudWindowOptions } = await import("./hud-model");
    const options = desktopHudWindowOptions("thr_1", "Alt+Shift+Space", { availWidth: 1440, availHeight: 900 });
    expect(options).toMatchObject({ alwaysOnTop: true, transparent: true, hotkey: "Alt+Shift+Space", params: { thread: "thr_1" }, x: 996, y: 276 });
    expect(desktopHudWindowOptions(null, " ")).not.toHaveProperty("hotkey");
  });
});

describe("desktop tools", () => {
  it("is off on a BB without desktop control", () => {
    expect(desktopCallerOf({})).toBeNull();
    expect(registerDesktopTools({ experimental_hooks: {} } as never, async () => "Bot")).toBe(false);
  });

  it("registers studio-owned desktop_* tools that call the host and report refusals as errors", async () => {
    const calls: unknown[] = [];
    const tools = new Map<string, { execute(input: unknown, ctx: { threadId: string }): Promise<unknown> }>();
    const bb = {
      experimental_hooks: {
        experimental_desktopControl: async (call: { tool: string }) => {
          calls.push(call);
          return call.tool === "type" ? { ok: false, error: "Refused: password" } : { ok: true, text: "ok", images: [{ data: "AA", mimeType: "image/png" }] };
        },
      },
      ui: { registerMentionProvider: vi.fn() },
      agents: { registerTool: (tool: { name: string; execute(input: unknown, ctx: { threadId: string }): Promise<unknown> }) => tools.set(tool.name, tool) },
    };
    expect(registerDesktopTools(bb as never, async () => "Chief")).toBe(true);
    expect([...tools.keys()].every((name) => name.startsWith("desktop_"))).toBe(true);
    expect(tools.has("desktop_request_control")).toBe(true);
    await expect(tools.get("desktop_click")?.execute({ pid: 1, window_id: 2, element_token: "s1:1", foreground: true, caption: "opening" }, { threadId: "thr_1" })).resolves.toEqual({
      content: [{ type: "text", text: "ok" }, { type: "image", data: "AA", mimeType: "image/png" }],
    });
    expect(calls[0]).toEqual({ threadId: "thr_1", agent: "Chief", tool: "click", args: { pid: 1, window_id: 2, element_token: "s1:1", delivery_mode: "foreground" }, caption: "opening" });
    await expect(tools.get("desktop_type")?.execute({ pid: 1, window_id: 2, text: "hi" }, { threadId: "thr_1" })).resolves.toEqual({ content: [{ type: "text", text: "Refused: password" }], isError: true });
    expect((calls[1] as { args: Record<string, unknown> }).args).toEqual({ pid: 1, window_id: 2, text: "hi" });
  });

  it("formats results", () => {
    expect(toolResult({ ok: false })).toEqual({ content: [{ type: "text", text: "Desktop control refused." }], isError: true });
    expect(toolResult({ ok: true })).toEqual({ content: [{ type: "text", text: "Done." }] });
  });
});
