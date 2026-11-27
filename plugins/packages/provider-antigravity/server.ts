import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { antigravityProviderDeclaration } from "./src/declaration.js";
import { registerUsageSource } from "./src/usage-source.js";

export default async function antigravityProviderPlugin(
  bb: BbPluginApi,
): Promise<void> {
  registerUsageSource(bb);
  const { dispose } = bb.providers.register(antigravityProviderDeclaration());
  bb.onDispose(() => {
    dispose();
  });
}
