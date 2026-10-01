import type { StudioSchemas } from "../contract";
import { createStudioNotifier } from "./index";

type Realtime = { publish(channel: string, data: unknown): void };

/** Publish a local event and notify the Studio collection. Both are best effort. */
export function createChangeBus<T extends unknown[]>(options: {
  bb: { realtime: Realtime; sdk: { plugins: Parameters<typeof createStudioNotifier>[0]["plugins"] } };
  channel: string;
  pluginId: string;
  schemas: StudioSchemas;
  event(id: string, ...details: T): unknown;
  delayMs?: number;
}): { changed(id: string, ...details: T): void; dispose(): void } {
  const notifier = createStudioNotifier({
    plugins: options.bb.sdk.plugins,
    pluginId: options.pluginId,
    schemas: options.schemas,
    delayMs: options.delayMs,
  });
  return {
    changed(id, ...details) {
      try {
        options.bb.realtime.publish(options.channel, options.event(id, ...details));
      } catch {
        // An open view can still catch up by refetching.
      }
      notifier.changed();
    },
    dispose: () => notifier.dispose(),
  };
}
