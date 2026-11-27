import { redactSecrets } from "./redact-secrets.fork.js";

export function forkRedactSettingValue(
  descriptor: { type: string },
  value: unknown,
): unknown {
  return descriptor.type === "string" && typeof value === "string"
    ? redactSecrets(value)
    : value;
}

export function forkRedactSettingDescriptor<
  T extends { type: string; default?: unknown },
>(descriptor: T): T {
  return descriptor.type === "string" && typeof descriptor.default === "string"
    ? { ...descriptor, default: redactSecrets(descriptor.default) }
    : descriptor;
}
