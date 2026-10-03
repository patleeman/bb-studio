/** Add an id only when its implementation moves into Studio. */
export const absorbedPluginIds = ["studio-tables", "studio-chat", "feed", "studio-tasks", "bot-teams", "artifacts", "talk"] as const;

export const legacyReferencePluginIds = [...absorbedPluginIds, "explore"] as const;

export function rewriteLegacyText(text: string, ids: readonly string[] = legacyReferencePluginIds): string {
  for (const id of ids) {
    const owner = id === "explore" ? "pages" : "studio";
    text = text.replace(new RegExp(`(^|https?://[^/\\s]+|[\\s(\"'=<>])((?:/api(?:/v1)?)?/plugins/)${id}/`, "g"), "$1$2" + owner + "/");
    text = text.replace(new RegExp(`(^|[^a-zA-Z0-9_-])${id}:`, "g"), "$1" + owner + ":");
  }
  return text;
}

/** Rewrite structured references without changing arbitrary plain labels. */
export function rewriteLegacyValue(value: unknown, ids: readonly string[] = legacyReferencePluginIds, key = ""): unknown {
  if (typeof value === "string") {
    if (["pluginId", "plugin_id", "from_plugin", "to_plugin"].includes(key) && ids.includes(value)) return value === "explore" ? "pages" : "studio";
    return rewriteLegacyText(value, ids);
  }
  if (Array.isArray(value)) return value.map(item => rewriteLegacyValue(item, ids));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [rewriteLegacyText(key, ids), rewriteLegacyValue(child, ids, key)]));
  return value;
}
