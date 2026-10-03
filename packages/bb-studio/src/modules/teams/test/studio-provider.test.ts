import { test } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";
import { studioSchemas } from "@bb-studio/kit/contract";
import { threadViewSchema } from "../view-contract";
import type { Bot } from "../contract";
import { botsSignature, registerStudio, type BotActivity } from "../studio-provider";

const bot = (patch: Partial<Bot> = {}): Bot =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    name: "Scout",
    description: "Finds flaky tests.",
    avatar: "🦉",
    providerId: "codex",
    model: "gpt-5",
    handle: "scout",
    home: "/tmp/scout",
    projectId: "proj_scout",
    hostId: "local",
    createdAt: 1,
    updatedAt: 2,
    lastWakeAt: 0,
    error: null,
    ...patch,
  }) as Bot;

const view = threadViewSchema.parse({ id: "33333333-3333-4333-8333-333333333333", name: "Launch room", members: [], createdAt: 1, updatedAt: 2 });
function setup(bots: Bot[], activity = new Map<string, BotActivity>(), views = [] as typeof view[]) {
  let handlers: Record<string, (input: unknown) => unknown> = {};
  const bb = { rpc: { register: (_contract: unknown, registered: typeof handlers) => (handlers = registered) } };
  const retired: string[] = [];
  registerStudio(bb as never, studioSchemas(z), {
    bots: () => bots,
    views: () => views,
    createView: async () => { const created = { ...view, name: "New view" }; views.push(created); return created; },
    archiveView: async (id, archived) => { views.find(view => view.id === id)!.archived = archived; },
    deleteView: async (id) => { views.splice(views.findIndex(view => view.id === id), 1); },
    readView: async () => "# Launch room\n\nYou: Ready?\n\nReply: Ready.",
    activity: () => activity,
    retire: async (id, value) => void retired.push(`${id}:${value}`),
  });
  const call = async (method: string, input: unknown): Promise<any> => handlers[method]!(input);
  return { call, retired };
}

test("teammates and conversations do not enter the Work collection", async () => {
  const scout = bot();
  const { call } = setup([scout], new Map(), [{ ...view }]);
  const info = await call("studio_describe", null);
  assert.ok(studioSchemas(z).info.parse(info));
  assert.deepEqual(info.kinds, []);
  assert.deepEqual((await call("studio_list", null)).items, []);
  assert.deepEqual((await call("studio_get", { ids: [scout.id, view.id] })).items, []);
  assert.deepEqual((await call("studio_search", { query: "scout" })).ids, []);
  await assert.rejects(call("studio_create", { kind: "view" }), /from Team/);
});

test("saved links remain readable and preserve lifecycle operations", async () => {
  const scout = bot();
  const { call, retired } = setup([scout], new Map(), [{ ...view }]);
  assert.match((await call("studio_read", { id: scout.id })).content, /Finds flaky tests/);
  assert.match((await call("studio_read", { id: view.id })).content, /Reply: Ready/);
  assert.deepEqual(await call("studio_archive", { ids: [scout.id], archived: true }), { done: [scout.id], failed: [] });
  assert.deepEqual(retired, [`${scout.id}:true`]);
  assert.deepEqual(await call("studio_delete", { ids: [view.id] }), { done: [view.id], failed: [] });
});

test("the change signature ignores activity Studio doesn't show", () => {
  const scout = bot();
  const quiet = botsSignature([scout], new Map([[scout.id, { working: false, lastActivityAt: 1 }]]));
  assert.equal(quiet, botsSignature([scout], new Map([[scout.id, { working: false, lastActivityAt: 9 }]])));
  assert.notEqual(quiet, botsSignature([scout], new Map([[scout.id, { working: true, lastActivityAt: 9 }]])));
  assert.notEqual(quiet, botsSignature([bot({ name: "Scout 2" })], new Map()));
});
