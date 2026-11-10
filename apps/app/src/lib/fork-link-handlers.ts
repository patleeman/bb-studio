import { getPluginSlotSnapshot } from "./plugin-slots";

export function openUrlWithPlugin(url: string): boolean {
  const handlers = [...getPluginSlotSnapshot().linkHandlers].sort((a, b) =>
    a.pluginId.localeCompare(b.pluginId),
  );
  for (const handler of handlers) {
    try {
      if (handler.handle(url) === true) return true;
    } catch (error) {
      console.warn(
        `[plugin:${handler.pluginId}] link handler "${handler.id}" failed`,
        error,
      );
    }
  }
  return false;
}
