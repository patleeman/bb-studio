import { expect, it, vi } from "vitest";
import { BOT_ID, checkSelfEdit } from "./bot";
import { registerBotProfileTools } from "./bot-profile-tools";
import { twoBots } from "./test/bot-fixture";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function withTools() {
  const x = await twoBots();
  const generate = vi.fn(async () => ({ data: PNG, mime: "image/png", model: "m" }));
  registerBotProfileTools(x.bb, { bots: x.bots, acting: (threadId) => x.bots.actingFor(threadId), imageProvider: () => ({ id: "test", label: "Test", generate }) });
  return x;
}

it("records each field a Bot changes about itself, with who and where, and nothing for unchanged ones", async () => {
  const { bots } = await twoBots();
  const { view, changed } = await bots.selfEdit("bot_scout", { name: "Scout", role: "I watch releases.", shape: "star", color: "#46a758" }, { botId: "bot_scout", threadId: "thr_scout" });
  expect(changed).toEqual(["role", "shape", "color"]);
  expect(view.bot).toMatchObject({ name: "Scout", role: "I watch releases.", shape: "star", color: "#46a758" });
  const changes = bots.profileChanges("bot_scout");
  expect(changes.map((each) => [each.field, each.oldValue, each.newValue])).toEqual([["color", null, "#46a758"], ["shape", null, "star"], ["role", null, "I watch releases."]]);
  expect(changes[0]).toMatchObject({ actorBotId: "bot_scout", actorName: "Scout", threadId: "thr_scout", reverts: null, revertedAt: null });
  expect(bots.profileChanges()).toEqual([]);
});

it("reverts a Bot's edit to the old value, records the revert, and won't revert twice", async () => {
  const { bots } = await twoBots();
  await bots.selfEdit(undefined, { name: "Penny", avatar: "🦉" }, { botId: BOT_ID, threadId: "thr_main" });
  const rename = bots.profileChanges().find((each) => each.field === "name")!;
  expect((await bots.revertChange(undefined, rename.id)).bot).toMatchObject({ name: "Dot", avatar: "🦉" });
  const [revert, ...rest] = bots.profileChanges();
  expect(revert).toMatchObject({ field: "name", oldValue: "Penny", newValue: "Dot", reverts: rename.id, actorBotId: null, actorName: null });
  expect(rest.find((each) => each.id === rename.id)?.revertedAt).toEqual(expect.any(Number));
  await expect(bots.revertChange(undefined, rename.id)).rejects.toThrow(/already reverted/);
  await expect(bots.revertChange(undefined, revert!.id)).rejects.toThrow(/That's a revert/);
  await expect(bots.revertChange("bot_scout", rename.id)).rejects.toThrow(/No such change/);
});

it("keeps the change log append-only", async () => {
  const { bots, db } = await twoBots();
  await bots.selfEdit(undefined, { role: "Chief of staff" }, { botId: BOT_ID });
  expect(() => db.prepare("UPDATE bot_profile_changes SET new_value = 'x'").run()).toThrow(/append-only/);
  expect(() => db.prepare("DELETE FROM bot_profile_changes").run()).toThrow(/append-only/);
});

it("refuses the user's fields: state, model, provider, permissions, check-ins", async () => {
  for (const key of ["state", "model", "providerId", "permissionMode", "reasoning", "enabled", "deleted", "threadId"]) {
    expect(() => checkSelfEdit({ [key]: "x" }), key).toThrow(/^Only the user can /);
  }
  expect(() => checkSelfEdit({ name: "Ok", state: "paused" })).toThrow(/pause, resume or stop/);
  expect(() => checkSelfEdit({ shape: "octagon" })).toThrow(/shape is one of/);
  expect(() => checkSelfEdit({ color: "red" })).toThrow(/#rrggbb/);
  expect(checkSelfEdit({ name: " Dot ", shape: null })).toEqual({ name: "Dot", shape: null });
  const { bots } = await twoBots();
  await expect(bots.selfEdit(undefined, { state: "stopped" }, { botId: BOT_ID })).rejects.toThrow(/Only the user/);
  expect(bots.stored()?.state).toBe("active");
  expect(bots.profileChanges()).toEqual([]);
});

it("bot_profile_update edits the calling Bot from its own thread only, and its schema takes no other fields", async () => {
  const { harness, bots } = await withTools();
  expect(await harness.callAgentTool("bot_profile_update", { name: "Scouty", avatar: "🛰️", shape: "star" }, { threadId: "thr_scout" })).toMatch(/^Changed your name, avatar, shape\. You are now 🛰️ Scouty/);
  expect(bots.stored("bot_scout")).toMatchObject({ name: "Scouty", avatar: "🛰️", shape: "star" });
  expect(bots.stored()?.name).toBe("Dot");
  // A thread the Bot started, or no Bot's thread, can't.
  expect(await harness.callAgentTool("bot_profile_update", { name: "Worker" }, { threadId: "thr_child" })).toMatch(/^Only a Bot's own thread/);
  expect(await harness.callAgentTool("bot_profile_update", { name: "Worker" }, { threadId: "thr_loose" })).toMatch(/^Only a Bot's own thread/);
  // The user's fields don't parse.
  await expect(harness.callAgentTool("bot_profile_update", { state: "paused" }, { threadId: "thr_scout" })).rejects.toThrow();
  await expect(harness.callAgentTool("bot_profile_update", { name: "X", model: "gpt" }, { threadId: "thr_scout" })).rejects.toThrow();
  expect(bots.stored("bot_scout")).toMatchObject({ name: "Scouty", state: "active" });
  expect(bots.profileChanges("bot_scout").map((each) => each.field)).toEqual(["shape", "avatar", "name"]);
});

it("records a generated avatar as the Bot's change, and Revert goes back to the drawn one", async () => {
  const { harness, bots } = await withTools();
  await harness.callAgentTool("bot_avatar_generate", { prompt: "an owl" }, { threadId: "thr_main" });
  const [change] = bots.profileChanges();
  expect(change).toMatchObject({ field: "avatarImage", oldValue: "", oldImageUrl: null, newImageUrl: expect.stringMatching(/bot=bot_main&image=bai_/), actorName: "Dot" });
  expect((await bots.revertChange(undefined, change!.id)).bot?.avatarImageUrl).toBeNull();
  expect(bots.profileChanges()[0]).toMatchObject({ field: "avatarImage", reverts: change!.id, newValue: "" });
});
