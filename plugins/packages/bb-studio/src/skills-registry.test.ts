import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import { createSkillsRegistryGate, SKILLS_REGISTRY_KV_KEY, type SkillsRegistryDecision, type SkillsRegistryOperation } from "./skills-registry";
import type { HostApprovalDecision, HostApprovalRequest } from "./kit/host-approval";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const OFF = "Installing skills from the public registry is off in BB Studio. A person can turn it on in Settings.";

function host() {
  const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
  dispose.push(() => harness.lifecycle.dispose());
  let policy: ((request: { operation: SkillsRegistryOperation }) => Promise<SkillsRegistryDecision>) | null = null;
  const hooks = { experimental_skillsRegistryPolicy(next: typeof policy) { policy = next; } };
  const asked: HostApprovalRequest[] = [];
  let answer: (decision: HostApprovalDecision) => void = () => {};
  const approval = (request: HostApprovalRequest) => { asked.push(request); return new Promise<HostApprovalDecision>((resolve) => { answer = resolve; }); };
  return { kv: bb.storage.kv, hooks, policy: () => policy!, asked, answer: (approved: boolean) => answer({ approved, picked: [] }), approval };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it("refuses search, reads and installs by default, with the message agents and the CLI see", async () => {
  const x = host();
  const gate = createSkillsRegistryGate({ hooks: x.hooks, kv: x.kv, approval: x.approval });
  expect(await gate.state()).toEqual({ enabled: false, pending: false, gated: true, error: null });
  expect(await x.policy()({ operation: "install" })).toEqual({ allowed: false, message: OFF });
  expect(await x.policy()({ operation: "search" })).toEqual({ allowed: false, message: "Searching the public skill registry is off in BB Studio. A person can turn it on in Settings." });
  expect(await x.policy()({ operation: "read" })).toMatchObject({ allowed: false });
});

it("turns on only after a person approves, and off at once", async () => {
  const x = host();
  const gate = createSkillsRegistryGate({ hooks: x.hooks, kv: x.kv, approval: x.approval });
  expect(await gate.set(true)).toMatchObject({ enabled: false, pending: true });
  expect(x.asked).toHaveLength(1);
  expect(await x.policy()({ operation: "install" })).toMatchObject({ allowed: false });
  x.answer(false);
  await settle();
  expect(await gate.state()).toMatchObject({ enabled: false, pending: false });
  expect(await x.kv.get(SKILLS_REGISTRY_KV_KEY)).toBeUndefined();

  await gate.set(true);
  x.answer(true);
  await settle();
  expect(await gate.state()).toMatchObject({ enabled: true, pending: false });
  expect(await x.policy()({ operation: "install" })).toEqual({ allowed: true });
  expect(await x.policy()({ operation: "search" })).toEqual({ allowed: true });

  expect(await gate.set(false)).toMatchObject({ enabled: false });
  expect(await x.policy()({ operation: "install" })).toEqual({ allowed: false, message: OFF });
});

it("can't be turned on without BB's approval dialog, and keeps the stored value across restarts", async () => {
  const x = host();
  const gate = createSkillsRegistryGate({ hooks: x.hooks, kv: x.kv, approval: null });
  expect(await gate.set(true)).toMatchObject({ enabled: false, error: expect.stringContaining("approval") });
  await x.kv.set(SKILLS_REGISTRY_KV_KEY, true);
  const again = createSkillsRegistryGate({ hooks: x.hooks, kv: x.kv, approval: null });
  expect(await again.state()).toMatchObject({ enabled: true });
  expect(await x.policy()({ operation: "install" })).toEqual({ allowed: true });
});

it("is not gated on a BB without the policy hook", async () => {
  const x = host();
  const gate = createSkillsRegistryGate({ hooks: {}, kv: x.kv, approval: x.approval });
  expect(await gate.state()).toMatchObject({ gated: false });
});
