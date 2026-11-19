import type { Context, Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../../../errors.js";
import type { AppDeps } from "../../../types.js";
import { readHostId } from "../sync.js";
import { BringOverError, errorDetail } from "./files.js";
import {
  bringOverJobFinished,
  cancelBringOverJob,
  currentBringOverJob,
  startBringOverJob,
} from "./job.js";
import { listProjects, listThreads } from "./listing.js";
import { addPlugin, listPlugins, type PluginInstaller } from "./plugins.js";
import { listSettings } from "./settings.js";
import {
  registerUiToken,
  UI_TOKEN_HEADER,
  uiTokenMatches,
} from "./ui-token.js";
import { bringOverStudioData, studioDataState } from "./studio-data.js";
import {
  bringOverSource,
  existingSourceSnapshot,
  openSnapshot,
  takeSourceSnapshot,
  type SourceSnapshot,
} from "./source.js";

const requestSchema = z.object({
  picks: z
    .array(
      z.object({
        kind: z.enum(["project", "thread"]),
        id: z.string().min(1),
      }),
    )
    .default([]),
  attachments: z.boolean().default(true),
  settings: z
    .array(
      z.object({
        id: z.enum([
          "preferences",
          "app-settings",
          "theme",
          "instructions",
          "skills",
          "custom-models",
          "env",
        ]),
        replace: z.boolean().default(false),
      }),
    )
    .default([]),
});

export { bringOverJobFinished };

export function registerBringOverRoutes(
  app: Hono,
  deps: AppDeps,
  dataDir: () => string,
  installer: PluginInstaller | null,
): void {
  let snapshotting: Promise<SourceSnapshot> | null = null;

  function requireUi(context: Context, route: string): void {
    const callerThread = context.req.header("x-bb-caller-thread") ?? null;
    const cli = context.req.header("x-bb-cli") !== undefined;
    const allowed =
      callerThread === null &&
      !cli &&
      uiTokenMatches(context.req.header(UI_TOKEN_HEADER));
    deps.logger.info(
      {
        route,
        callerThread,
        cli,
        origin: context.req.header("origin") ?? null,
        allowed,
      },
      "Bring-over request",
    );
    if (!allowed) {
      throw new ApiError(
        403,
        "forbidden",
        "Bringing things over works only in the BB Studio app on this Mac",
      );
    }
  }

  app.post("/fork/bring-over/ui-token", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      token?: unknown;
    } | null;
    if (!registerUiToken(body?.token)) {
      throw new ApiError(
        409,
        "invalid_request",
        "The app's token is already set",
      );
    }
    return context.body(null, 204);
  });

  async function source(): Promise<string> {
    const found = await bringOverSource(dataDir(), process.env);
    if (found === null) {
      throw new ApiError(
        404,
        "not_found",
        "There is no bb install to bring things over from",
      );
    }
    return found;
  }

  async function snapshot(): Promise<SourceSnapshot> {
    const sourceDataDir = await source();
    const existing = await existingSourceSnapshot(dataDir(), sourceDataDir);
    if (existing === null) {
      throw new ApiError(
        409,
        "invalid_request",
        "Read bb first (POST /fork/bring-over/snapshot)",
      );
    }
    return existing;
  }

  function hosts(snap: SourceSnapshot) {
    return {
      sourceHostId: snap.sourceHostId,
      ourHostId: readHostId(dataDir()),
    };
  }

  async function listing(snap: SourceSnapshot) {
    const db = openSnapshot(snap);
    try {
      return {
        available: true as const,
        sourceDataDir: snap.sourceDataDir,
        readAt: snap.takenAt,
        projects: listProjects(db, deps.db.$client, hosts(snap)),
        settings: await listSettings(db, snap.sourceDataDir),
        plugins: await listPlugins(
          db,
          deps.db.$client,
          snap.sourceDataDir,
          deps.config.appVersion,
        ),
        studioData: await studioDataState(dataDir(), snap.sourceDataDir),
        job: currentBringOverJob(dataDir()),
      };
    } finally {
      db.close();
    }
  }

  app.get("/fork/bring-over", async (context) => {
    const sourceDataDir = await bringOverSource(dataDir(), process.env);
    if (sourceDataDir === null) return context.json({ available: false });
    if (context.req.query("summary") !== undefined) {
      return context.json({
        available: true,
        sourceDataDir,
        job: currentBringOverJob(dataDir()),
      });
    }
    const existing = await existingSourceSnapshot(dataDir(), sourceDataDir);
    if (existing === null) {
      return context.json({
        available: true,
        sourceDataDir,
        readAt: null,
        job: currentBringOverJob(dataDir()),
      });
    }
    return context.json(await listing(existing));
  });

  app.post("/fork/bring-over/snapshot", async (context) => {
    const sourceDataDir = await source();
    snapshotting ??= takeSourceSnapshot({
      dataDir: dataDir(),
      sourceDataDir,
      now: Date.now(),
    }).finally(() => {
      snapshotting = null;
    });
    try {
      return context.json(await listing(await snapshotting));
    } catch (error) {
      throw new ApiError(
        500,
        "internal_error",
        `bb could not be read: ${errorDetail(error)}`,
      );
    }
  });

  app.get("/fork/bring-over/projects/:projectId/threads", async (context) => {
    const snap = await snapshot();
    const db = openSnapshot(snap);
    try {
      return context.json(
        listThreads(db, deps.db.$client, context.req.param("projectId")),
      );
    } finally {
      db.close();
    }
  });

  app.post("/fork/bring-over/jobs", async (context) => {
    requireUi(context, "jobs");
    const parsed = requestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        "Expected { picks, attachments, settings }",
      );
    }
    const job = startBringOverJob({
      dataDir: dataDir(),
      snapshot: await snapshot(),
      target: deps.db.$client,
      request: parsed.data,
      logger: deps.logger,
      now: Date.now(),
    });
    if (job === null) {
      throw new ApiError(
        409,
        "invalid_request",
        "A bring-over is already running",
      );
    }
    return context.json(job, 202);
  });

  app.get("/fork/bring-over/jobs/current", (context) =>
    context.json({ job: currentBringOverJob(dataDir()) }),
  );

  app.post("/fork/bring-over/jobs/current/cancel", (context) =>
    context.json({ job: cancelBringOverJob(dataDir()) }),
  );

  let studioDataRunning = false;
  app.post("/fork/bring-over/studio-data", async (context) => {
    requireUi(context, "studio-data");
    if (installer === null) {
      throw new ApiError(
        409,
        "invalid_request",
        "BB Studio data can't be brought over on this server",
      );
    }
    if (studioDataRunning) {
      throw new ApiError(
        409,
        "invalid_request",
        "BB Studio data is already being brought over",
      );
    }
    studioDataRunning = true;
    try {
      return context.json(
        await bringOverStudioData({
          dataDir: dataDir(),
          snapshot: await snapshot(),
          target: deps.db.$client,
          ourHostId: readHostId(dataDir()),
          controller: {
            setEnabled: (id, enabled) => installer.setEnabled(id, enabled),
            databaseOpen: (id) =>
              installer
                .listOpenPluginDatabases()
                .some((open) => open.pluginId === id),
          },
          now: Date.now(),
        }),
      );
    } catch (error) {
      if (error instanceof BringOverError) {
        throw new ApiError(422, "invalid_request", error.message);
      }
      throw error;
    } finally {
      studioDataRunning = false;
    }
  });

  app.post("/fork/bring-over/plugins/:pluginId/add", async (context) => {
    requireUi(context, "plugins/add");
    if (installer === null) {
      throw new ApiError(
        409,
        "invalid_request",
        "Plugins can't be added on this server",
      );
    }
    const snap = await snapshot();
    const db = openSnapshot(snap);
    try {
      return context.json(
        await addPlugin({
          id: context.req.param("pluginId"),
          source: db,
          target: deps.db.$client,
          sourceDataDir: snap.sourceDataDir,
          dataDir: dataDir(),
          installer,
          appVersion: deps.config.appVersion,
        }),
      );
    } catch (error) {
      if (error instanceof BringOverError) {
        throw new ApiError(422, "invalid_request", error.message);
      }
      throw error;
    } finally {
      db.close();
    }
  });
}
