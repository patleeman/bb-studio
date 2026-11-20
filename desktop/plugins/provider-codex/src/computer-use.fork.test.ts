import { describe, expect, it } from "vitest";
import {
  CODEX_COMPUTER_USE_OFF_CONFIG,
  forkCodexProviderOptions,
  forkCodexSessionOptions,
} from "./computer-use.fork.js";
import { buildCodexConfig } from "./session-params.js";
import type { CodexSessionOptions } from "./session-params.js";

const OPTIONS: CodexSessionOptions = {
  permissionMode: "accept-edits",
  permissionScope: "workspace",
  approvalReviewer: "user",
  permissionEscalation: "ask",
  reasoningLevel: "high",
};

function config(options: CodexSessionOptions) {
  return buildCodexConfig({
    threadId: "bb-thread-1",
    additionalWorkspaceWriteRoots: [],
    gitWritableRoots: [],
    options,
    supportsAgentsEnabled: true,
  });
}

describe("Codex Computer Use per thread (BB Studio)", () => {
  it("keeps cua_repl out of the session config when the thread asks for it off", () => {
    const off = config({ ...OPTIONS, computerUseEnabled: false });
    expect(off).toMatchObject({
      "plugins.unified-computer-use@openai-bundled.enabled": false,
      "mcp_servers.cua_repl.command": "/usr/bin/false",
      "mcp_servers.cua_repl.enabled": false,
    });
    expect(off).toEqual({
      ...config(OPTIONS),
      ...CODEX_COMPUTER_USE_OFF_CONFIG,
    });
  });

  it("leaves the config unchanged without the flag or with it on", () => {
    const plain = config(OPTIONS);
    expect(
      Object.keys(plain ?? {}).some((key) => key.includes("cua_repl")),
    ).toBe(false);
    expect(
      Object.keys(plain ?? {}).some((key) => key.startsWith("plugins.")),
    ).toBe(false);
    expect(config({ ...OPTIONS, computerUseEnabled: true })).toEqual(plain);
  });

  it("reads the flag from the thread's provider-codex metadata, only when it is false", () => {
    expect(
      forkCodexProviderOptions({
        experimental_pluginMetadata: { experimental_computerUse: false },
      }),
    ).toEqual({ computerUseEnabled: false });
    for (const value of [true, "false", 0, null]) {
      expect(
        forkCodexProviderOptions({
          experimental_pluginMetadata: { experimental_computerUse: value },
        }),
      ).toEqual({});
    }
    expect(
      forkCodexProviderOptions({ experimental_pluginMetadata: {} }),
    ).toEqual({});
    expect(forkCodexProviderOptions({})).toEqual({});
  });

  it("carries the flag across the bridge's provider options", () => {
    expect(forkCodexSessionOptions({ computerUseEnabled: false })).toEqual({
      computerUseEnabled: false,
    });
    expect(forkCodexSessionOptions({ computerUseEnabled: true })).toEqual({});
    expect(forkCodexSessionOptions(undefined)).toEqual({});
  });
});
