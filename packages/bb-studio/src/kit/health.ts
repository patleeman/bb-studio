// Plugin health: the check a plugin publishes so Studio can tell the user when
// its setup is incomplete or it has stopped working, and how to fix it.
// Studio discovers every plugin that publishes `studio_health`, so plugins
// outside the suite can report too.
//
// Nothing here imports zod at runtime, for the reason in contract.ts.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z as Zod } from "zod";

export const HEALTH_METHOD = "studio_health";
/** Studio's realtime channel; payload is the new health summary. */
export const HEALTH_REALTIME_CHANNEL = "studio-health";

/** The settings page BB shows for a plugin. */
export function pluginSettingsPath(pluginId: string): string {
  return `/settings/plugins/${pluginId}`;
}

export function healthSchemas(z: typeof Zod) {
  const check = z.object({
    /** Stable within the plugin. Hiding a problem lasts while its id, status and title stay the same. */
    id: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,79}$/),
    status: z.enum(["ok", "degraded", "broken"]),
    /** One line the user reads first, e.g. "No Jev provider is set up". */
    title: z.string().min(1).max(200),
    /** What it costs the user and what to do. */
    detail: z.string().max(1000).optional(),
    /** Where Fix goes, an in-app path. Omitted: the plugin's settings page. */
    fix: z.object({ label: z.string().min(1).max(60), path: z.string().max(500).regex(/^\/(?![/\\])[^\\\s]*$/) }).optional(),
  });
  return {
    check,
    contract: {
      [HEALTH_METHOD]: {
        input: z.object({}).strict(),
        output: z.object({ checks: z.array(check).max(20) }),
      },
    },
  };
}

export type HealthSchemas = ReturnType<typeof healthSchemas>;
export type HealthCheck = Zod.output<HealthSchemas["check"]>;

/**
 * Publishes this plugin's health check. `run` should answer in a few seconds
 * from state the plugin already has; Studio gives up after ten.
 */
export function registerHealth(bb: Pick<BbPluginApi, "rpc">, schemas: HealthSchemas, run: () => HealthCheck[] | Promise<HealthCheck[]>): void {
  bb.rpc.register(schemas.contract, {
    [HEALTH_METHOD]: async () => ({ checks: await run() }),
  }, {
    experimental_discoverable: true,
    experimental_description: "BB Studio health: whether this plugin is set up and working, and how to fix it.",
  });
}
