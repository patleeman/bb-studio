import type { BbPluginApi, PluginAiServiceStatus } from "@get-bb/plugin-sdk";
import {
  claudeAiHostContract,
  type ClaudeAiTextResult,
} from "./ai/host-contract.fork.js";

const COMPLETE_TIMEOUT_MS = 7_000;
const HOST_CALL_GRACE_MS = 1_000;

export function registerClaudeAiService(bb: BbPluginApi): void {
  const host = bb.hosts.experimental_client({ contract: claudeAiHostContract });

  async function primaryHostId(): Promise<string | null> {
    return (await bb.sdk.system.config()).primaryHostId;
  }

  function textOrThrow(result: ClaudeAiTextResult): string {
    if (result.ok) return result.text;
    throw new Error(result.message);
  }

  bb.experimental_aiServices.register({
    id: "claude-code",
    displayName: "Claude Code",
    async complete(prompt, { signal }) {
      const hostId = await primaryHostId();
      if (hostId === null) throw new Error("No primary machine is connected");
      return textOrThrow(
        await host.call(
          "claude-code.ai.complete",
          { prompt, timeoutMs: COMPLETE_TIMEOUT_MS },
          { hostId, signal, timeoutMs: COMPLETE_TIMEOUT_MS + HOST_CALL_GRACE_MS },
        ),
      );
    },
    async status(): Promise<PluginAiServiceStatus> {
      const hostId = await primaryHostId();
      if (hostId === null) {
        return { ready: false, message: "No primary machine is connected" };
      }
      return host.call("claude-code.ai.status", {}, { hostId, timeoutMs: 5_000 });
    },
  });
}
