// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ presences: null as unknown }));
vi.mock("../../ui/live", () => ({
  useCall: () => async () => ({}),
  useLive: (method: string) => ({ data: method === "presences_list" ? state.presences : null, error: null, loading: false, refresh: () => {} }),
}));
import { publishSceneSignals, resetSceneSignals } from "../../theme/signals";
import { BotPresence } from "./BotPresence";
import { PresenceSection } from "./PresenceSection";
import { failureKey, markPresenceFailed, resetPresenceState, setPresenceDraft, shownPresence, markPresenceSaved } from "./state";

let root: Root;
let host: HTMLDivElement;
const shown = () => { const element = host.querySelector<HTMLElement>('[data-testid="bot-presence"]')!; return { form: element.dataset.form, state: element.dataset.state, workers: element.dataset.workers }; };
const render = async (node: React.ReactNode) => { await act(async () => { root.render(node); }); };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.presences = null;
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); resetPresenceState(); resetSceneSignals(); });

it("shows the Bot's form and its live state: idle, thinking, working with its workers, needs you", async () => {
  const bot = { id: "cos", primary: true, needsYou: false };
  await render(<BotPresence bot={bot} size={36} />);
  expect(shown()).toEqual({ form: "tesseract", state: "idle", workers: "0" });
  await act(async () => { publishSceneSignals({ botId: "cos", workers: [], conversations: [{ threadId: "main", running: true, needsYou: false }] }); });
  expect(shown()).toMatchObject({ state: "thinking" });
  await act(async () => { publishSceneSignals({ botId: "cos", workers: [{ threadId: "w1", status: "running" }, { threadId: "w2", status: "running" }, { threadId: "w3", status: "done" }], conversations: [{ threadId: "main", running: true, needsYou: false }] }); });
  expect(shown()).toMatchObject({ state: "working", workers: "2" });
  await act(async () => { publishSceneSignals({ botId: "cos", workers: [{ threadId: "w1", status: "needs-you" }], conversations: [] }); });
  expect(shown()).toMatchObject({ state: "needs" });
  expect(host.querySelector('[data-testid="bot-presence"]')!.getAttribute("aria-label")).toBe("Needs you");
});

it("a Bot that isn't the shown one takes its state from the server, and its saved form", async () => {
  publishSceneSignals({ botId: "cos", workers: [{ threadId: "w1", status: "running" }], conversations: [] });
  await render(<BotPresence bot={{ id: "home", needsYou: false, activity: { turn: false, workers: 3 }, presence: { form: "knot", color: { source: "theme" }, motion: 1 } }} size={24} />);
  expect(shown()).toEqual({ form: "knot", state: "working", workers: "3" });
  await render(<BotPresence bot={{ id: "home", needsYou: true, presence: { form: "knot", color: { source: "theme" }, motion: 1 } }} size={24} />);
  expect(shown()).toMatchObject({ state: "needs" });
});

it("follows the picker's draft while Edit space is open, then the saved pick until the server catches up", () => {
  const bot = { id: "cos", primary: true };
  expect(shownPresence(bot).form).toBe("tesseract");
  setPresenceDraft("cos", { form: "orb", color: { source: "theme" }, motion: 1 });
  expect(shownPresence(bot).form).toBe("orb");
  expect(shownPresence({ id: "home" }).form).not.toBe(undefined);
  markPresenceSaved("cos", { form: "klein", color: { source: "theme" }, motion: 1 });
  setPresenceDraft("cos", null);
  expect(shownPresence(bot).form).toBe("klein");
  setPresenceDraft("home", null);
  expect(shownPresence(bot).form).toBe("klein");
});

it("lists stored presences in the picker with a Custom tag, and says when one was stopped", async () => {
  const crane = { id: "crane", name: "Origami crane", description: "A paper crane.", source: "stored" as const, creator: null, usedBy: [], code: "function draw() {}", updatedAt: 5 };
  state.presences = { presences: [{ ...crane, id: "orb", name: "Orb", source: "builtin", code: null }, crane] };
  const onChange = vi.fn();
  const value = { form: "crane", color: { source: "theme" as const }, motion: 1 };
  await render(<PresenceSection bot={{ id: "cos", name: "Chief of Staff" }} value={value} onChange={onChange} />);
  const tiles = [...host.querySelectorAll<HTMLElement>('[data-testid="presence-tile"]')];
  expect(tiles.map((tile) => tile.dataset.form)).toEqual(["orb", "tesseract", "knot", "swarm", "mobius", "poly", "attractor", "klein", "crane"]);
  expect(tiles.filter((tile) => tile.querySelector('[data-testid="presence-custom"]')).map((tile) => tile.dataset.form)).toEqual(["crane"]);
  expect(tiles.at(-1)!.getAttribute("aria-checked")).toBe("true");
  expect(host.querySelector('[data-testid="presence-create"]')).toBeNull();
  expect(host.querySelector('[data-testid="presence-failure"]')).toBeNull();
  await act(async () => { markPresenceFailed(failureKey(crane), "A frame took longer than 120 ms."); });
  expect(host.querySelector('[data-testid="presence-failure"]')!.textContent).toBe("Origami crane stopped: A frame took longer than 120 ms.");
  expect(host.querySelectorAll("[data-presence-custom]")).toHaveLength(0);
  expect(host.querySelectorAll("canvas[data-presence-canvas]").length).toBeGreaterThan(9);
  await act(async () => { host.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Color source"] button:last-child')!.click(); });
  expect(onChange).toHaveBeenLastCalledWith({ ...value, color: { source: "custom", hex: "#7c3aed" } });
});

it("moves through the forms with the arrow keys as one tab stop, and Reset puts the color and motion back while keeping the form", async () => {
  const onChange = vi.fn();
  const value = { form: "klein", color: { source: "custom" as const, hex: "#ff0000" }, motion: 2 };
  await render(<PresenceSection bot={{ id: "cos", name: "Chief of Staff" }} value={value} onChange={onChange} />);
  const tiles = [...host.querySelectorAll<HTMLElement>('[data-testid="presence-tile"]')];
  expect(tiles.filter((tile) => tile.tabIndex === 0).map((tile) => tile.dataset.form)).toEqual(["klein"]);
  const press = async (key: string) => { await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); }); };
  tiles.at(-1)!.focus();
  await press("ArrowRight");
  expect(document.activeElement).toBe(tiles[0]);
  expect(onChange).toHaveBeenLastCalledWith({ ...value, form: "orb" });
  await press("ArrowLeft");
  expect(onChange).toHaveBeenLastCalledWith({ ...value, form: "klein" });
  await press("Home");
  expect(document.activeElement).toBe(tiles[0]);
  await press("End");
  expect(document.activeElement).toBe(tiles.at(-1));
  await act(async () => { host.querySelector<HTMLElement>('[data-testid="presence-reset"]')!.click(); });
  expect(onChange).toHaveBeenLastCalledWith({ form: "klein", color: { source: "theme" }, motion: 1 });
  await render(<PresenceSection bot={{ id: "cos", name: "Chief of Staff" }} value={{ form: "klein", color: { source: "theme" }, motion: 1 }} onChange={onChange} />);
  expect(host.querySelector<HTMLButtonElement>('[data-testid="presence-reset"]')!.disabled).toBe(true);
});
