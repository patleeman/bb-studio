import { describe, expect, it, vi } from "vitest";
import { BACKOFF_MS, BEAT_MS, CHECK_MS, DeskPresence, deskState, IDLE_MS, INPUT_MS, presenceClientId, realInput, reportsPresence, type SystemActivity } from "./desk-presence";
import { deskWords } from "./PushSection";

function setup(options: { system?: SystemActivity | null; answer?: { enabled: boolean } | null } = {}) {
  let now = 1_000_000;
  let system = options.system ?? null;
  const beats: Array<[string, string]> = [];
  const presence = new DeskPresence({
    now: () => now,
    bridge: system ? { experimental_systemActivity: async () => system! } : null,
    send: async (state, source) => { beats.push([state, source]); return options.answer === undefined ? { enabled: true } : options.answer; },
  });
  return { presence, beats, advance: (ms: number) => { now += ms; }, setSystem: (next: SystemActivity) => { system = next; } };
}

/** Lets a beat that input() started finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("deskState", () => {
  it("is away when the Mac is locked, whatever else", () => {
    expect(deskState({ now: 10, lastInputAt: 10, system: { idleSeconds: 0, locked: true } })).toBe("away");
  });
  it("is active with a key, click or scroll in a Studio window lately and the Mac in use", () => {
    expect(deskState({ now: INPUT_MS - 1, lastInputAt: 0, system: { idleSeconds: 30, locked: false } })).toBe("active");
  });
  it("is away when the Mac looks busy but nobody touched Studio (a mouse that sends events by itself)", () => {
    expect(deskState({ now: INPUT_MS, lastInputAt: 0, system: { idleSeconds: 0, locked: false } })).toBe("away");
    expect(deskState({ now: 10, lastInputAt: -Infinity, system: { idleSeconds: 0, locked: false } })).toBe("away");
  });
  it("is away after two idle minutes, whatever the window saw", () => {
    expect(deskState({ now: 10, lastInputAt: 10, system: { idleSeconds: 121, locked: false } })).toBe("away");
  });
  it("without the system reading, uses this window's input", () => {
    expect(deskState({ now: IDLE_MS - 1, lastInputAt: 0, system: null })).toBe("active");
    expect(deskState({ now: IDLE_MS, lastInputAt: 0, system: null })).toBe("away");
  });
});

describe("DeskPresence", () => {
  it("beats while active and says away once", async () => {
    const { presence, beats, advance, setSystem } = setup({ system: { idleSeconds: 0, locked: false } });
    presence.input();
    await vi.waitFor(() => expect(beats).toHaveLength(1));
    await settle();
    beats.length = 0;
    await presence.tick();
    advance(15_000); await presence.tick();
    advance(BEAT_MS); await presence.tick();
    expect(beats).toEqual([["active", "system"]]);
    setSystem({ idleSeconds: 200, locked: false });
    advance(15_000); await presence.tick();
    advance(15_000); await presence.tick();
    expect(beats.at(-1)).toEqual(["away", "system"]);
    expect(beats.filter(([state]) => state === "away")).toHaveLength(1);
  });

  it("a lock says away at once, and input brings it back", async () => {
    const { presence, beats } = setup({ system: { idleSeconds: 0, locked: false } });
    presence.input();
    await vi.waitFor(() => expect(beats.at(-1)).toEqual(["active", "system"]));
    presence.systemChanged({ idleSeconds: 0, locked: true });
    await vi.waitFor(() => expect(beats.at(-1)).toEqual(["away", "system"]));
  });

  it("a jittery mouse with nobody at Studio stays away all night", async () => {
    const { presence, beats, advance } = setup({ system: { idleSeconds: 0, locked: false } });
    for (let i = 0; i < 40; i++) { await presence.tick(); advance(CHECK_MS); }
    expect(beats).toEqual([["away", "system"]]);
  });

  it("goes away ten minutes after the last real input, though the Mac still looks busy", async () => {
    const { presence, beats, advance } = setup({ system: { idleSeconds: 0, locked: false } });
    presence.input();
    await vi.waitFor(() => expect(beats).toEqual([["active", "system"]]));
    await settle();
    advance(INPUT_MS); await presence.tick();
    expect(beats.at(-1)).toEqual(["away", "system"]);
  });

  it("an old desktop app or a web tab reports its window", async () => {
    const { presence, beats, advance } = setup();
    presence.input();
    await vi.waitFor(() => expect(beats).toEqual([["active", "window"]]));
    await settle();
    advance(IDLE_MS); await presence.tick();
    expect(beats.at(-1)).toEqual(["away", "window"]);
    presence.input();
    await vi.waitFor(() => expect(beats.at(-1)).toEqual(["active", "window"]));
  });

  it("a window that opens or reloads with focus is not input", async () => {
    const { presence, beats } = setup();
    await presence.tick();
    expect(beats).toEqual([["away", "window"]]);
  });

  it("backs off when the switch is off", async () => {
    const { presence, beats, advance } = setup({ answer: { enabled: false } });
    presence.input();
    await vi.waitFor(() => expect(beats).toHaveLength(1));
    await settle();
    presence.input(); advance(BEAT_MS); await presence.tick();
    expect(beats).toHaveLength(1);
    presence.input(); advance(BACKOFF_MS); await presence.tick();
    expect(beats).toHaveLength(2);
  });

  it("retries at the next check when a beat doesn't arrive (Studio reloading), so the hold doesn't lapse", async () => {
    let up = false;
    let now = 0;
    const beats: string[] = [];
    const presence = new DeskPresence({ now: () => now, bridge: null, send: async (state) => { beats.push(state); return up ? { enabled: true } : null; } });
    presence.input();
    await vi.waitFor(() => expect(beats).toEqual(["active"]));
    await settle();
    up = true;
    now += CHECK_MS; await presence.tick();
    expect(beats).toEqual(["active", "active"]);
  });
});

describe("which clients report", () => {
  const win = (extra: Record<string, unknown>, coarse = false) => ({ matchMedia: () => ({ matches: coarse }), ...extra }) as never;
  it("the desktop app and a computer's browser do; the phone app and touch devices don't", () => {
    expect(reportsPresence(win({ bbDesktop: {} }))).toBe(true);
    expect(reportsPresence(win({}))).toBe(true);
    expect(reportsPresence(win({ bb: { native: {} } }))).toBe(false);
    expect(reportsPresence(win({}, true))).toBe(false);
    expect(reportsPresence(win({ navigator: { webdriver: true } }))).toBe(false);
  });

  it("counts only events a person made", () => {
    expect(realInput({ isTrusted: true })).toBe(true);
    expect(realInput({ isTrusted: false })).toBe(false);
  });
});

describe("presenceClientId", () => {
  it("keeps one id per window", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    const id = presenceClientId(storage, () => "4f1c-22aa-9b9b-1234");
    expect(id).toMatch(/^[A-Za-z0-9]{8,32}$/);
    expect(presenceClientId(storage, () => "other-random-value")).toBe(id);
  });
});

describe("deskWords", () => {
  it("states the switch and where the user is", () => {
    expect(deskWords({ enabled: false, atDesk: true, held: 0 })).toBe("Off");
    expect(deskWords({ enabled: true, atDesk: true, held: 0 })).toBe("At your Mac");
    expect(deskWords({ enabled: true, atDesk: false, held: 1 })).toBe("Away from your Mac · 1 waiting");
    expect(deskWords({ enabled: true, atDesk: null, held: 0 })).toBe("No signal from your Mac");
  });
});
