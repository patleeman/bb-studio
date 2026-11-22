// Studio's settings as the CLI and the `settings.get`/`settings.set` RPCs show
// them: string values with their secrets redacted (a home server URL with a
// user and password, the custom Jev endpoint's query token, an Authorization
// header). Studio's own code reads the store, never this view.
import { holdsRedactedSecret, redactSecrets } from "../redact-secrets";

export function redactedValues<T extends Record<string, unknown>>(values: T): T {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === "string" ? redactSecrets(value) : value])) as T;
}

/**
 * A change that holds a redaction label: the redacted value sent back as it
 * was shown keeps the stored value (the key is dropped); any other value
 * holding the label is refused, so the label never replaces a secret.
 */
export function withoutRedactedEcho<T extends Record<string, unknown>>(patch: T, current: Record<string, unknown>): T {
  const refused: string[] = [];
  const kept = Object.fromEntries(Object.entries(patch).filter(([key, value]) => {
    if (!holdsRedactedSecret(value)) return true;
    const stored = current[key];
    if (typeof stored !== "string" || redactSecrets(stored) !== value) refused.push(key);
    return false;
  }));
  if (refused.length) throw new Error(`${refused.join(", ")} holds a redacted secret; enter the whole value to replace it.`);
  return kept as T;
}
