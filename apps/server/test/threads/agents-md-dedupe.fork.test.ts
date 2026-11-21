import { describe, expect, it } from "vitest";
import { forkProviderReadsDataDirAgentsMd } from "../../src/services/threads/agents-md-dedupe.fork.js";

describe("<dataDir>/AGENTS.md once (agents-md-dedupe.fork.ts)", () => {
  const dataDir = "/tmp/data/bb-studio";
  const personal = `${dataDir}/plugins/environment-personal-workspace/host-data/workspaces/thr_1`;

  it("leaves bb's copy out for Pi when the workspace is inside the data dir, where Pi finds the file itself", () => {
    expect(forkProviderReadsDataDirAgentsMd({ providerId: "pi", workspacePath: personal, dataDir })).toBe(true);
    expect(forkProviderReadsDataDirAgentsMd({ providerId: "pi", workspacePath: dataDir, dataDir: `${dataDir}/` })).toBe(true);
  });

  it("keeps it for a workspace outside the data dir, and for providers that don't read parent folders", () => {
    expect(forkProviderReadsDataDirAgentsMd({ providerId: "pi", workspacePath: "/tmp/code/app", dataDir })).toBe(false);
    expect(forkProviderReadsDataDirAgentsMd({ providerId: "pi", workspacePath: `${dataDir}-other/x`, dataDir })).toBe(false);
    for (const providerId of ["claude-code", "codex", "acp-opencode"]) expect(forkProviderReadsDataDirAgentsMd({ providerId, workspacePath: personal, dataDir })).toBe(false);
  });
});
