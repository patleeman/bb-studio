import type { PluginProviderOptionsContext } from "@get-bb/plugin-sdk";
import type { JsonValue } from "./generated/codex-app-server/schema/serde_json/JsonValue.js";
import { CODEX_COMPUTER_USE_SERVER_NAME } from "./mcp-elicitation.js";

export const COMPUTER_USE_METADATA_KEY = "experimental_computerUse";

const COMPUTER_USE_PLUGIN = "unified-computer-use@openai-bundled";

export const CODEX_COMPUTER_USE_OFF_CONFIG: {
  readonly [key: string]: JsonValue;
} = {
  [`plugins.${COMPUTER_USE_PLUGIN}.enabled`]: false,
  [`mcp_servers.${CODEX_COMPUTER_USE_SERVER_NAME}.command`]: "/usr/bin/false",
  [`mcp_servers.${CODEX_COMPUTER_USE_SERVER_NAME}.enabled`]: false,
};

export function forkCodexProviderOptions(
  context: Pick<PluginProviderOptionsContext, "experimental_pluginMetadata">,
): { computerUseEnabled?: false } {
  return context.experimental_pluginMetadata?.[COMPUTER_USE_METADATA_KEY] ===
    false
    ? { computerUseEnabled: false }
    : {};
}

export function forkCodexSessionOptions(providerOptions: unknown): {
  computerUseEnabled?: false;
} {
  return typeof providerOptions === "object" &&
    providerOptions !== null &&
    Reflect.get(providerOptions, "computerUseEnabled") === false
    ? { computerUseEnabled: false }
    : {};
}

export function applyForkCodexConfig(
  config: { [key in string]?: JsonValue },
  options: { computerUseEnabled?: boolean } | undefined,
): void {
  if (options?.computerUseEnabled === false) {
    Object.assign(config, CODEX_COMPUTER_USE_OFF_CONFIG);
  }
}
