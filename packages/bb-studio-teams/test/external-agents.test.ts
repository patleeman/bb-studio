import { test } from "vitest";
import assert from "node:assert/strict";
import plugin from "../server";
import type { Bot } from "../contract";
import { externalAgent, fitProfileToProvider, permissionModeFor, reasoningLevelFor } from "../external-agents";
import { setup } from "./bots-fixture";

test("outside agents get a permission mode they accept", () => {
  assert.equal(permissionModeFor("dot", "auto"), "full");
  assert.equal(permissionModeFor("dot", "accept-edits"), "full");
  assert.equal(permissionModeFor("dot", "full"), "full");
  for (const provider of ["hermes", "openclaw"]) {
    assert.equal(permissionModeFor(provider, "auto"), "accept-edits");
    assert.equal(permissionModeFor(provider, "accept-edits"), "accept-edits");
    assert.equal(permissionModeFor(provider, "full"), "full");
  }
  // BB's own providers keep whatever was chosen.
  for (const mode of ["auto", "accept-edits", "full"] as const)
    assert.equal(permissionModeFor("codex", mode), mode);
  assert.equal(permissionModeFor("", "auto"), "auto");
  // Names on Object.prototype aren't providers.
  assert.equal(externalAgent("toString"), null);
});

test("outside agents take no reasoning level", () => {
  assert.equal(reasoningLevelFor("dot", "medium"), "none");
  assert.equal(reasoningLevelFor("codex", "high"), "high");
  assert.deepEqual(
    fitProfileToProvider({ providerId: "hermes", permissionMode: "auto", reasoningLevel: "medium", fallbackProviderId: "codex", fallbackReasoningLevel: "high" }),
    { providerId: "hermes", permissionMode: "accept-edits", reasoningLevel: "none", fallbackProviderId: "codex", fallbackReasoningLevel: "high" },
  );
});

test("the server fits permission mode to an outside agent on update and when starting its threads", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    const dot = await x.harness.behavior.callRpc("update", { id: x.a.id, providerId: "dot", model: "dot", permissionMode: "auto" }) as Bot;
    assert.equal(dot.permissionMode, "full");
    assert.equal(dot.reasoningLevel, "none");
    const hermes = await x.harness.behavior.callRpc("update", { id: x.a.id, providerId: "hermes", model: "hermes-agent", permissionMode: "auto" }) as Bot;
    assert.equal(hermes.permissionMode, "accept-edits");
    const full = await x.harness.behavior.callRpc("update", { id: x.a.id, permissionMode: "full" }) as Bot;
    assert.equal(full.permissionMode, "full");
    // A stored mode the provider refuses is fitted again when a thread starts.
    const stale: Bot = { ...full, providerId: "dot", permissionMode: "auto" };
    await x.runtime.conversation(stale, "mission", "mission", "Mission", "Say hello", [], "accept-edits");
    const spawned = x.harness.inspection.sdk.callsTo("threads.spawn").at(-1)?.[0] as { providerId?: string; permissionMode?: string };
    assert.equal(spawned.providerId, "dot");
    assert.equal(spawned.permissionMode, "full");
    assert.equal(await x.runtime.permissionMode(stale), "full");
  } finally {
    await x.close();
  }
});
