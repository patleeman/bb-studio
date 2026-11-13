import { defineRpcContract } from "@get-bb/plugin-sdk";
import type { experimental_nativeRootsHostContract } from "@get-bb/plugin-sdk/host";
import { claudeTextStatus, completeClaudeText } from "./claude-text.fork.js";
import {
  claudeAiHostContract,
  type ClaudeAiCompleteInput,
} from "./host-contract.fork.js";

export const claudeAiHostEntry = {
  contract(base: typeof experimental_nativeRootsHostContract) {
    return defineRpcContract({ ...claudeAiHostContract, ...base });
  },
  handlers: {
    "claude-code.ai.complete": (
      input: ClaudeAiCompleteInput,
      context: { signal: AbortSignal },
    ) => completeClaudeText(input, context.signal),
    "claude-code.ai.status": () => claudeTextStatus(),
  },
};
