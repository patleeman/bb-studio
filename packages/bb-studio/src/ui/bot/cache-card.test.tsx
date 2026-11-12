// @vitest-environment jsdom
// The prompt cache on a BB whose context popover takes plugin rows: the
// "Prompt cache" row, and the footer chip that only opens that card. On a BB
// without the slot the chip keeps Studio's own popover.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BotCacheStateView } from "../../contract";
import type { ContextCardRow, ContextCardRowRegistration } from "../../kit/app/host-sdk";

const now = Date.now();
const warm: BotCacheStateView = {
  botId: "bot_main", threadId: "thr_bot", state: "warm", label: "Warm · 58m", warmUntil: now + 58 * 60_000,
  model: "model", contextTokens: 120_000,
  warming: { active: true, nextPingAt: null, reason: null, lastPingAt: null, lastCompactAt: null, compactAt: null },
  costs: { warmingPerHour: 0.08, coldSend: 0.42, warmSend: 0.04 }, banner: false,
  settings: { enabled: true, thresholdTokens: 100_000, idleHours: 3, compactBeforeExpiry: true },
};
const cold: BotCacheStateView = { ...warm, state: "cold", label: "Cold", warmUntil: null, warming: { ...warm.warming, active: false } };
const warming: BotCacheStateView = { ...cold, warming: { ...warm.warming, active: true } };
const off: BotCacheStateView = { ...cold, state: "off", label: "Warming off", settings: { ...warm.settings, enabled: false }, warming: { ...cold.warming, reason: "The Bot is stopped" } };

const state = vi.hoisted(() => ({
  cache: null as unknown,
  threadId: "thr_bot" as string | null,
  card: { available: true, open: vi.fn() },
  call: vi.fn(async (_method: string, _input: unknown) => ({})),
  inputs: [] as { enabled: boolean | undefined }[],
  fork: true,
}));
// Read again after each vi.resetModules(): the fork's SDK has the context card hook, stable BB's doesn't.
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbContext: () => ({ threadId: state.threadId, projectId: null }),
  useComposer: () => ({ scope: { kind: "thread", threadId: state.threadId } }),
  ...(state.fork ? { experimental_useContextCard: () => state.card } : {}),
}));
vi.mock("../live", () => ({
  useCall: () => state.call,
  useLive: (_method: string, _input: unknown, options: { enabled?: boolean } = {}) => { state.inputs.push({ enabled: options.enabled }); return { data: options.enabled === false ? undefined : state.cache, refresh() {} }; },
}));
vi.mock("../../kit/app/index", () => ({ GHOST_BUTTON: "" }));
vi.mock("../../kit/ui/index", () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
  Popover: ({ children }: { children: ReactNode }) => <div data-popover="">{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div data-testid="bot-cache-popover">{children}</div>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

/** BotCache as it loads on a BB with (or without) the context card, and the row it registered. */
async function load(fork: boolean) {
  state.fork = fork;
  vi.resetModules();
  const module = await import("./BotCache");
  let registered: ContextCardRowRegistration | null = null;
  const slots = fork ? { experimental_contextCardRow: (registration: ContextCardRowRegistration) => { registered = registration; } } : {};
  const has = module.registerCacheCardRow(slots);
  return { module, has, registration: registered as ContextCardRowRegistration | null };
}

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  state.cache = warm; state.threadId = "thr_bot"; state.card = { available: true, open: vi.fn() }; state.call.mockClear(); state.inputs.length = 0;
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

/** What the registered hook returns for the thread on screen. */
async function rowOf(registration: ContextCardRowRegistration): Promise<ContextCardRow | null> {
  let row: ContextCardRow | null = null;
  function Card() { row = registration.useRow(); return null; }
  await act(async () => root.render(<Card />));
  return row;
}

it("says the state in a couple of words, with the costs as one quiet line", async () => {
  const { module } = await load(true);
  expect(module.cacheRowValue(warm, now)).toBe("warm 58m");
  expect(module.cacheRowValue({ ...warm, warmUntil: now }, now)).toBe("warming");
  expect(module.cacheRowValue(cold, now)).toBe("cold");
  expect(module.cacheRowValue(warming, now)).toBe("warming");
  expect(module.cacheRowValue(off, now)).toBe("off");
  expect(module.cacheRowNote(warm)).toBe("120k tokens · cold send ≈ $0.42 · warming ≈ $0.08/h");
  // The Bot's state only when that is why nothing is warmed.
  expect(module.cacheRowNote(off)).toBe("Bot stopped · 120k tokens · cold send ≈ $0.42 · warming ≈ $0.08/h");
  expect(module.cacheRowNote({ ...cold, warming: { ...cold.warming, reason: "The chat is below the size threshold" } })).toBe("120k tokens · cold send ≈ $0.42 · warming ≈ $0.08/h");
  expect(module.cacheRowNote({ ...cold, contextTokens: null, costs: { warmingPerHour: null, coldSend: null, warmSend: null } })).toBeUndefined();
});

it("registers one Prompt cache row whose actions call the same RPCs the popover did", async () => {
  const { has, registration } = await load(true);
  expect(has).toBe(true);
  expect(registration!.id).toBe("prompt-cache");
  const row = (await rowOf(registration!))!;
  expect(row).toMatchObject({ label: "Prompt cache", value: "warm 58m", note: "120k tokens · cold send ≈ $0.42 · warming ≈ $0.08/h" });
  expect(row.actions!.map((action) => action.label)).toEqual(["Turn warming off", "Compact now"]);
  await act(async () => { await row.actions![0]!.run(); });
  expect(state.call).toHaveBeenCalledWith("bot_cache_set", { botId: "bot_main", enabled: false });
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  await act(async () => { await row.actions![1]!.run(); });
  expect(state.call).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);
  await act(async () => { await row.actions![1]!.run(); });
  expect(state.call).toHaveBeenLastCalledWith("bot_cache_compact", { threadId: "thr_bot" });

  state.cache = off;
  const offRow = (await rowOf(registration!))!;
  expect(offRow.value).toBe("off");
  expect(offRow.actions![0]!.label).toBe("Turn warming on");
  await act(async () => { await offRow.actions![0]!.run(); });
  expect(state.call).toHaveBeenLastCalledWith("bot_cache_set", { botId: "bot_main", enabled: true });
});

it("adds no row where the cache chip doesn't apply: not a Bot's chat, or no thread", async () => {
  const { registration } = await load(true);
  state.cache = { ...warm, botId: null, label: "" };
  expect(await rowOf(registration!)).toBeNull();
  state.cache = warm;
  state.threadId = null;
  state.inputs.length = 0;
  expect(await rowOf(registration!)).toBeNull();
  expect(state.inputs.every((input) => input.enabled === false)).toBe(true);
});

it("the chip is the clock and the time, and a click or Enter opens BB's card", async () => {
  const { module } = await load(true);
  await act(async () => root.render(<module.BotCacheChip threadId="thr_bot" />));
  const chip = container.querySelector<HTMLButtonElement>('button[data-testid="bot-cache-chip"]')!;
  expect(chip.textContent).toBe("cache 58m");
  expect(chip.querySelector('[data-icon="Clock"]')).not.toBeNull();
  expect(chip.type).toBe("button");
  expect(container.querySelector("[data-popover], [data-testid=bot-cache-popover]")).toBeNull();
  await act(async () => chip.click());
  expect(state.card.open).toHaveBeenCalledTimes(1);
});

it("before the thread has a context ring, the chip is plain text with the state as its tooltip", async () => {
  const { module } = await load(true);
  state.card = { available: false, open: vi.fn() };
  state.cache = cold;
  await act(async () => root.render(<module.BotCacheChip threadId="thr_bot" />));
  const chip = container.querySelector<HTMLElement>('[data-testid="bot-cache-chip"]')!;
  expect(chip.tagName).toBe("SPAN");
  expect(chip.textContent).toBe("cache cold");
  expect(chip.title).toBe("Prompt cache: cold");
  expect(container.querySelector("button, [data-popover]")).toBeNull();
});

it("on a BB without the row slot the chip keeps Studio's own popover", async () => {
  const { module, has, registration } = await load(false);
  expect(has).toBe(false);
  expect(registration).toBeNull();
  await act(async () => root.render(<module.BotCacheChip threadId="thr_bot" />));
  expect(container.querySelector("[data-popover]")).not.toBeNull();
  const popover = container.querySelector('[data-testid="bot-cache-popover"]')!;
  expect(popover.textContent).toContain("Turn warming off");
  expect(popover.textContent).toContain("Compact now…");
  expect(container.querySelector('[data-testid="bot-cache-chip"]')!.textContent).toBe("cache 58m");
});
