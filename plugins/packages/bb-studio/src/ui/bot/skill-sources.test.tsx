// @vitest-environment jsdom
// Each Bot's skills on BB's Skills page, one source per Bot.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ skills: {} as Record<string, unknown[]>, inputs: [] as unknown[], open: vi.fn() }));
vi.mock("../live", () => ({ useLive: (_method: string, input: { botId?: string }) => { state.inputs.push(input); return { data: { skills: state.skills[input.botId ?? "primary"] ?? [] } }; } }));
vi.mock("../../kit/app/nav", () => ({ openAppPath: state.open }));

import { knownBots, registerBotSkillSources, rememberBots } from "./skill-sources";

afterEach(() => { localStorage.clear(); state.open.mockClear(); state.inputs.length = 0; });

type Source = { id: string; label: string; useSkills(): readonly { id: string; name: string; description?: string; onOpen(): void }[] };
const slots = () => { const sources: Source[] = []; return { sources, slots: { experimental_skillSource: (source: Source) => { sources.push(source); } } }; };

function run(source: Source) {
  let out: ReturnType<Source["useSkills"]> = [];
  function Probe() { out = source.useSkills(); return null; }
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  act(() => root.unmount());
  vi.unstubAllGlobals();
  return out;
}

it("registers one source per Bot this browser last saw, named for it, and nothing on a BB without the slot", () => {
  rememberBots([{ id: "bot_main", name: "Chief of Staff" }, { id: "bot.ops", name: "Ops" }]);
  expect(knownBots()).toEqual([{ id: "bot_main", name: "Chief of Staff" }, { id: "bot.ops", name: "Ops" }]);
  const { sources, slots: withSlot } = slots();
  expect(registerBotSkillSources(withSlot)).toBe(true);
  expect(sources.map(({ id, label }) => [id, label])).toEqual([["bot-bot_main", "Chief of Staff"], ["bot-bot_ops", "Ops"]]);
  expect(registerBotSkillSources({})).toBe(false);
});

it("lists a Bot's skills, archived ones aside, each opening its Controls at Skills", () => {
  state.skills.bot_main = [{ name: "weekly-review", description: "Sunday review", state: "active" }, { name: "old", description: "", state: "archived" }];
  const { sources, slots: withSlot } = slots();
  registerBotSkillSources(withSlot, [{ id: "bot_main", name: "Chief of Staff" }]);
  const listed = run(sources[0]!);
  expect(state.inputs).toContainEqual({ botId: "bot_main" });
  expect(listed.map(({ id, name, description }) => ({ id, name, description }))).toEqual([{ id: "weekly-review", name: "weekly-review", description: "Sunday review" }]);
  listed[0]!.onOpen();
  expect(state.open).toHaveBeenCalledWith("/plugins/studio/studio/bot/bot_main/controls#skills");
});

it("with no Bot seen yet, lists the primary Bot's under one source", () => {
  state.skills.primary = [{ name: "triage", description: "", state: "active" }];
  const { sources, slots: withSlot } = slots();
  registerBotSkillSources(withSlot);
  expect(sources.map(({ id, label }) => [id, label])).toEqual([["bot", "Bot"]]);
  const listed = run(sources[0]!);
  expect(listed.map((skill) => skill.name)).toEqual(["triage"]);
  expect(listed[0]!.description).toBeUndefined();
  listed[0]!.onOpen();
  expect(state.open).toHaveBeenCalledWith("/plugins/studio/studio/bot");
});
