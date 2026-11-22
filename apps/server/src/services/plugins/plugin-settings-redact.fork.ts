import type { PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import { PluginSettingsValidationError } from "./plugin-settings.js";
import { holdsRedactedSecret, redactSecrets } from "./redact-secrets.fork.js";

export function forkKeepRedactedSettings(
  descriptors: PluginSettingDescriptors,
  values: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];
  const kept = Object.fromEntries(
    Object.entries(values).filter(([key, value]) => {
      const descriptor = Object.hasOwn(descriptors, key)
        ? descriptors[key]
        : undefined;
      if (descriptor?.type !== "string" || !holdsRedactedSecret(value)) {
        return true;
      }
      const stored = current[key];
      if (typeof stored !== "string" || redactSecrets(stored) !== value) {
        errors.push(
          `${key} holds a redacted secret; enter the whole value to replace it`,
        );
      }
      return false;
    }),
  );
  if (errors.length > 0) {
    throw new PluginSettingsValidationError(errors.join("; "));
  }
  return kept;
}
