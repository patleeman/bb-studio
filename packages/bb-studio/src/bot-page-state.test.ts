import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { BotPageState, groupRenameKey, registerGroupTool } from "./bot-page-state";
import { groupKey } from "./calendar-group-key";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  return { bb, harness, state: new BotPageState(db) };
}

const JOBS = [{ id: "auto_systems", name: "Systems" }, { id: "auto_comms", name: "Comms" }, { id: "auto_home", name: "Home & Family" }, { id: "auto_staff", name: "Staff" }];
const SWEEP = groupKey(300, 315, ["auto_systems", "auto_comms", "auto_home", "auto_staff"]);

it("saves a group name per Bot under its key; an empty name goes back to the automatic one", () => {
  const { state } = setup();
  expect(state.groupNames("bot_main")).toEqual({});
  expect(state.renameGroup("bot_main", SWEEP, "  Area   sweep ", "user")).toEqual({ [SWEEP]: "Area sweep" });
  // Renaming again replaces it; another Bot's names are its own.
  state.renameGroup("bot_main", SWEEP, "Morning sweep", "bot");
  expect(state.groupNames("bot_main")[SWEEP]).toBe("Morning sweep");
  expect(state.groupNames("bot_other")).toEqual({});
  expect(state.renameGroup("bot_main", SWEEP, "", "user")).toEqual({});
  expect(() => state.renameGroup("bot_main", "not a key", "x", "user")).toThrow("That isn't a calendar group.");
});

it("keeps a dismissed failed run, one run at a time", () => {
  const { state } = setup();
  expect(state.dismissed("bot_main")).toEqual([]);
  state.dismiss("bot_main", "auto_security", "run_2", 1000);
  state.dismiss("bot_main", "auto_security", "run_2", 2000);
  expect(state.dismiss("bot_main", "auto_security", "run_5", 3000)).toEqual(["auto_security:run_5", "auto_security:run_2"]);
  expect(state.dismissed("bot_other")).toEqual([]);
});

it("the Bot's tool finds the group from its window and job names, the same key the page computes", async () => {
  expect(groupRenameKey({ start: "05:00", end: "05:15", jobs: ["Staff", "comms", "Home & Family", "auto_systems"], name: "Area sweep" }, JOBS)).toEqual({ key: SWEEP });
  expect(groupRenameKey({ start: "5:00", end: "04:00", jobs: ["Staff", "Comms"], name: "x" }, JOBS)).toEqual({ error: expect.stringContaining("end not before start") });
  expect(groupRenameKey({ start: "05:00", end: "05:15", jobs: ["Staff", "Garden"], name: "x" }, JOBS)).toEqual({ error: expect.stringContaining('No job named "Garden"') });

  const { bb, harness, state } = setup();
  let acting: { botId: string; via: "own" | "runner" | "started" } | null = { botId: "bot_main", via: "own" };
  registerGroupTool(bb, { state, acting: async () => acting, jobs: async () => JOBS });
  const tool = { execute: (input: unknown, ctx: { threadId: string }) => harness.callAgentTool("bot_calendar_group_rename", input as never, ctx) };
  const ctx = { threadId: "thr_bot" };
  expect(await tool.execute({ start: "05:00", end: "05:15", jobs: ["Systems", "Comms", "Home & Family", "Staff"], name: "Area sweep" }, ctx)).toBe('The 05:00–05:15 block is now "Area sweep".');
  expect(state.groupNames("bot_main")).toEqual({ [SWEEP]: "Area sweep" });
  acting = { botId: "bot_main", via: "runner" };
  expect(await tool.execute({ start: "05:00", end: "05:15", jobs: ["Systems", "Comms"], name: "x" }, ctx)).toMatch(/^Only a Bot/);
});
