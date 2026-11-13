import { claudeAiHostEntry } from "./ai/host-entry.fork.js";
import os from "node:os";
import {
  experimental_defineHostEntry,
  experimental_nativeRootsHostContract,
} from "@get-bb/plugin-sdk/host";
import { resolveClaudeNativeRoots } from "./native-roots.js";

export { experimental_providerBridge } from "./bridge/bridge.js";

export default experimental_defineHostEntry({
  contract: claudeAiHostEntry.contract(experimental_nativeRootsHostContract),
  handlers: {
    ...claudeAiHostEntry.handlers,
    resolveNativeRoots: (input) =>
      resolveClaudeNativeRoots({
        cwd: input.cwd,
        homeDir: os.homedir(),
        env: process.env,
      }),
  },
});
