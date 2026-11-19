import { describe, expect, it, vi } from "vitest";
import { BACKOFF_MS, BEAT_MS, DeskPresence, deskState, IDLE_MS, presenceClientId, reportsPresence, type SystemActivity } from "./desk-presence";
import { deskWords } from "./PushSection";

function setup(options: { system?: SystemActivity | null; focused?: boolean; answer?: { enabled: boolean } | null } = {}) {
  let now = 1_000_000;
  let system = options.system ?? null;
  const beats: Array<[string, string]> = [];
  const presence = new DeskPresence({
    now: () => now,
    bridge: system ? { experimental_systemActivity: async () => system! } : null,
    windowActive: () => options.focused ?? false,
    send: async (state, source) => { beats.push([state, source]); return options.answer === undefined ? { enabled: true } : options.answer; },
  });
  return { presence, beats, advance: (ms: number) => { now += ms; }, setSystem: (next: SystemActivity) => { system = next; } };
}

describe("deskState", () => {
  it("is away when the Mac is locked, whatever else", () => {
    expect(deskState({ now: 10, lastInputAt: 10, system: { idleSeconds: 0, locked: true } })).toBe("away");
  });
  it("is active with recent input anywhere on the Mac", () => {
    expect(deskState({ now: 10 * IDLE_MS, lastInputAt: 0, system: { idleSeconds: 30, locked: false } })).toBe("active");
  });
  it("is away after two idle minutes", () => {
    expect(deskState({ now: 10 * IDLE_MS, lastInputAt: 0, system: { idleSeconds: 121, locked: false } })).toBe("away");
  });
  it("without the system reading, uses this window's input", () => {
    expect(deskState({ now: IDLE_MS - 1, lastInputAt: 0, system: null })).toBe("active");
    expect(deskState({ now: IDLE_MS, lastInputAt: 0, system: null })).toBe("away");
  });
});

describe("DeskPresence", () => {
  it("beats while active and says away once", async () => {
    const { presence, beats, advance, setSystem } = setup({ system: { idleSeconds: 0, locked: false } });
    await presence.tick();
    advance(15_000); await presence.tick();
    advance(BEAT_MS); await presence.tick();
    expect(beats).toEqual([["active", "system"], ["active", "system"]]);
    setSystem({ idleSeconds: 200, locked: false });
    advance(15_000); await presence.tick();
    advance(15_000); await presence.tick();
    expect(beats.at(-1)).toEqual(["away", "system"]);
    expect(beats.filter(([state]) => state === "away")).toHaveLength(1);
  });

  it("a lock says away at once, and input brings it back", async () => {
    const { presence, beats } = setup({ system: { idleSeconds: 0, locked: false } });
    await presence.tick();
    presence.systemChanged({ idleSeconds: 0, locked: true });
    await vi.waitFor(() => expect(beats.at(-1)).toEqual(["away", "system"]));
  });

  it("an old desktop app or a web tab reports its window", async () => {
    const { presence, beats, advance } = setup({ focused: true });
    await presence.tick();
    expect(beats).toEqual([["active", "window"]]);
    advance(IDLE_MS); await presence.tick();
    expect(beats.at(-1)).toEqual(["away", "window"]);
    presence.input();
    await vi.waitFor(() => expect(beats.at(-1)).toEqual(["active", "window"]));
  });

  it("an unfocused window that never had input says away", async () => {
    const { presence, beats } = setup({ focused: false });
    await presence.tick();
    expect(beats).toEqual([["away", "window"]]);
  });

  it("backs off when the switch is off or the Mobile plugin can't take it", async () => {
    for (const answer of [{ enabled: false }, null]) {
      const { presence, beats, advance } = setup({ focused: true, answer });
      await presence.tick();
      presence.input(); advance(BEAT_MS); await presence.tick();
      expect(beats).toHaveLength(1);
      presence.input(); advance(BACKOFF_MS); await presence.tick();
      expect(beats).toHaveLength(2);
    }
  });
});

describe("which clients report", () => {
  const win = (extra: Record<string, unknown>, coarse = false) => ({ matchMedia: () => ({ matches: coarse }), ...extra }) as never;
  it("the desktop app and a computer's browser do; the phone app and touch devices don't", () => {
    expect(reportsPresence(win({ bbDesktop: {} }))).toBe(true);
    expect(reportsPresence(win({}))).toBe(true);
    expect(reportsPresence(win({ bb: { native: {} } }))).toBe(false);
    expect(reportsPresence(win({}, true))).toBe(false);
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
