import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BotNudges, nudgeNote, nudgeReason, type NudgeOwner } from "./bot-nudge";
import { MIGRATIONS } from "./migrations";
import { approvalDecisions, approvalDirective, approvalLines, approvalReason, approvalResolution, approvalState, waitingOn, workerApprovalRpc, type Interaction } from "./worker-approvals";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const command: Interaction = {
  id: "int_push",
  status: "pending",
  payload: {
    kind: "approval", reason: null, availableDecisions: ["allow_once", "allow_for_session", "deny"],
    subject: { kind: "command", itemId: "item_1", command: "git push --force origin exp/studio-native", cwd: "/repo", actions: [{ type: "unknown", command: "git push --force origin exp/studio-native" }], sessionGrant: { network: { enabled: true }, fileSystem: null } },
  },
};
const question: Interaction = { id: "int_q", status: "pending", payload: { kind: "user_question" } };
const plan: Interaction = { id: "int_plan", status: "pending", payload: { kind: "approval", availableDecisions: ["allow_once", "deny"], subject: { kind: "plan", itemId: "p" } } };

describe("a worker's approval", () => {
  it("reads like BB's own prompt: the command and its details, and the choices BB offers, Deny first", () => {
    expect(approvalLines(command)).toEqual(["Command: git push --force origin exp/studio-native", "Cwd: /repo", "Action: git push --force origin exp/studio-native", "Session grant: Network access"]);
    expect(approvalDecisions(command)).toEqual(["deny", "allow_for_session", "allow_once"]);
    expect(approvalDecisions({ ...command, payload: { ...command.payload, availableDecisions: ["deny", "allow_once"] } })).toEqual(["deny", "allow_once"]);
    expect(approvalReason(command)).toBe("Approve: git push --force origin exp/studio-native");
    expect(approvalReason({ ...command, payload: { ...command.payload, subject: { kind: "command", command: "x".repeat(200) } } })).toHaveLength("Approve: ".length + 60);
  });

  it("sends the resolution BB's buttons send: a session grant only for the always-allow variant", () => {
    expect(approvalResolution(command, "deny")).toEqual({ decision: "deny" });
    expect(approvalResolution(command, "allow_once")).toEqual({ decision: "allow_once", grantedPermissions: null });
    expect(approvalResolution(command, "allow_for_session")).toEqual({ decision: "allow_for_session", grantedPermissions: { network: { enabled: true }, fileSystem: null } });
  });

  it("knows an approval from a question; a plan review stays BB's", () => {
    expect(waitingOn([command])).toBe("approval");
    expect(waitingOn([question])).toBe("question");
    expect(waitingOn([plan])).toBe("question");
    expect(waitingOn([{ ...command, status: "resolved" }])).toBeNull();
    expect(approvalState({ ...command, status: "resolved", resolution: { decision: "deny" } })).toBe("denied");
    expect(approvalState({ ...command, status: "resolved", resolution: { decision: "allow_for_session" } })).toBe("approved-session");
    expect(approvalState(null)).toBe("gone");
  });
});

describe("the card in the conversation that owns the worker", () => {
  function setup(owner: NudgeOwner = { botId: "bot_main", botThreadId: "conv_redesign", active: true, self: false }) {
    const send = vi.fn(async () => ({ ok: true }));
    const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: { threads: { send: send as never, interactions: { list: (async () => []) as never } as never } } });
    dispose.push(() => harness.lifecycle.dispose());
    const db = bb.storage.database();
    bb.storage.migrate(db, MIGRATIONS);
    const raised: [string, string][] = [];
    const nudges = new BotNudges({ db, sdk: bb.sdk, owner: async () => owner, raised: (thread, by, interaction) => raised.push([by.botThreadId, nudgeReason(thread, interaction)]) });
    return { nudges, send, raised };
  }
  const worker = { id: "thr_lead", title: "Fable lead: sidebar rewrite", projectId: "proj" };

  it("asks the Bot there to post the card, and marks that conversation 'Approve: <command>'", async () => {
    const x = setup();
    expect(await x.nudges.pending(worker, command)).toBe(true);
    const sent = (x.send.mock.calls[0] as unknown[])[0] as { threadId: string; input: { text: string; visibility?: string }[] };
    expect(sent.threadId).toBe("conv_redesign");
    expect(sent.input[0]!.visibility).toBe("agent-only");
    expect(sent.input[0]!.text).toBe(nudgeNote(worker, command));
    expect(sent.input[0]!.text.endsWith(`\n${approvalDirective("thr_lead", "int_push")}`)).toBe(true);
    expect(sent.input[0]!.text).toContain("Only the user can approve it");
    expect(x.raised).toEqual([["conv_redesign", "Approve: git push --force origin exp/studio-native"]]);
  });

  it("still marks the conversation for a paused Bot, which posts nothing", async () => {
    const x = setup({ botId: "bot_main", botThreadId: "main", active: false, self: false });
    expect(await x.nudges.pending(worker, command)).toBe(false);
    expect(x.send).not.toHaveBeenCalled();
    expect(x.raised).toEqual([["main", "Approve: git push --force origin exp/studio-native"]]);
  });

  it("a question is not a card: the Bot is asked to handle it or ask the user", async () => {
    const x = setup();
    const ask: Interaction = { id: "int_q", status: "pending", payload: { kind: "user_question", questions: [{ question: "Which vault?" }] } as never };
    await x.nudges.pending(worker, ask as never);
    const text = ((x.send.mock.calls[0] as unknown[])[0] as { input: { text: string }[] }).input[0]!.text;
    expect(text).not.toContain("::approval");
    expect(text).toContain("If you can handle it");
  });
});

describe("Approve and Deny", () => {
  function rpc(initial: Interaction[]) {
    let list = initial;
    const resolve = vi.fn(async ({ interactionId, resolution }: { interactionId: string; resolution: { decision: string } }) => {
      list = list.map((each) => each.id === interactionId ? { ...each, status: "resolved", resolution } : each);
      return {};
    });
    const resolved = vi.fn();
    const methods = workerApprovalRpc({
      sdk: { threads: { get: async () => ({ title: "Fable lead", projectId: "proj" }), interactions: { list: async () => list, resolve: resolve as never } } },
      title: (_id, thread) => thread?.title ?? "A worker",
      resolved,
    });
    return { methods, resolve, resolved };
  }

  it("resolves the worker's own pending approval and clears the mark once nothing waits", async () => {
    const x = rpc([command]);
    const before = await x.methods.bot_worker_approval({ threadId: "thr_lead", interactionId: "int_push" });
    expect(before.worker).toEqual({ threadId: "thr_lead", title: "Fable lead", projectId: "proj" });
    expect(before.approval).toMatchObject({ state: "pending", title: "Run a command", short: "git push --force origin exp/studio-native" });
    const after = await x.methods.bot_worker_approval_resolve({ threadId: "thr_lead", interactionId: "int_push", decision: "allow_for_session" });
    expect(x.resolve).toHaveBeenCalledWith({ threadId: "thr_lead", interactionId: "int_push", resolution: { decision: "allow_for_session", grantedPermissions: { network: { enabled: true }, fileSystem: null } } });
    expect(after.approval?.state).toBe("approved-session");
    expect(x.resolved).toHaveBeenCalledWith("thr_lead");
  });

  it("denies; keeps the mark while another question still waits; never resolves twice", async () => {
    const x = rpc([command, question]);
    const after = await x.methods.bot_worker_approval_resolve({ threadId: "thr_lead", interactionId: "int_push", decision: "deny" });
    expect(after.approval?.state).toBe("denied");
    expect(x.resolve).toHaveBeenCalledWith(expect.objectContaining({ resolution: { decision: "deny" } }));
    expect(x.resolved).not.toHaveBeenCalled();
    const again = await x.methods.bot_worker_approval_resolve({ threadId: "thr_lead", interactionId: "int_push", decision: "allow_once" });
    expect(again.approval?.state).toBe("denied");
    expect(x.resolve).toHaveBeenCalledTimes(1);
  });

  it("refuses a question, a plan review, or a choice BB doesn't offer", async () => {
    const x = rpc([question, plan, { ...command, payload: { ...command.payload, availableDecisions: ["allow_once", "deny"] } }]);
    await expect(x.methods.bot_worker_approval_resolve({ threadId: "thr_lead", interactionId: "int_q", decision: "allow_once" })).rejects.toThrow(/isn't waiting/);
    await expect(x.methods.bot_worker_approval_resolve({ threadId: "thr_lead", interactionId: "int_plan", decision: "allow_once" })).rejects.toThrow(/isn't waiting/);
    await expect(x.methods.bot_worker_approval_resolve({ threadId: "thr_lead", interactionId: "int_push", decision: "allow_for_session" })).rejects.toThrow(/doesn't offer/);
    expect((await x.methods.bot_worker_approval({ threadId: "thr_lead", interactionId: "int_q" })).approval).toBeNull();
    expect(x.resolve).not.toHaveBeenCalled();
  });
});
