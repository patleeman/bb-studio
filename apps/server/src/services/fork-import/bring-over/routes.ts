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
  type BringOverJob,
} from "./job.js";
import { listProjects, listThreads } from "./listing.js";
import { addPlugin, listPlugins, type PluginInstaller } from "./plugins.js";
import { listSettings } from "./settings.js";
import {
  UI_TOKEN_HEADER,
  uiTokenConfigured,
  uiTokenMatches,
} from "./ui-token.js";
import {
  checkStudioJob,
  discardStudioData,
  finishStudioJob,
  forgetStudioData,
  requestStudioPutBack,
  stageStudioData,
  studioDataState,
} from "./studio-data.js";
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
  studioData: z
    .object({ required: z.array(z.string().min(1)).max(10_000) })
    .optional(),
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

  app.get("/fork/bring-over/gate", (context) =>
    context.json({
      fromApp: uiTokenConfigured(),
      matches: uiTokenMatches(context.req.header(UI_TOKEN_HEADER)),
    }),
  );

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
        settings: await listSettings(db, snap.sourceDataDir, dataDir()),
        plugins: await listPlugins(
          db,
          deps.db.$client,
          snap.sourceDataDir,
          deps.config.appVersion,
        ),
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
    requireUi(context, "snapshot");
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
    const snap = await snapshot();
    const { studioData, ...request } = parsed.data;
    if (studioData !== undefined) {
      if (studioDataStaging) {
        throw new ApiError(
          409,
          "invalid_request",
          "bb's Studio data is still being copied",
        );
      }
      const db = openSnapshot(snap);
      try {
        const { missing } = checkStudioJob({
          dataDir: dataDir(),
          snapshot: snap,
          source: db,
          required: studioData.required,
        });
        if (missing.length > 0) {
          throw new ApiError(
            422,
            "invalid_request",
            `${String(missing.length)} of the Bots' own threads are not in bb, so its Studio data can't come over`,
          );
        }
      } catch (error) {
        if (error instanceof BringOverError) {
          throw new ApiError(409, "invalid_request", error.message);
        }
        throw error;
      } finally {
        db.close();
      }
      const picked = new Set(
        request.picks
          .filter((pick) => pick.kind === "thread")
          .map((pick) => pick.id),
      );
      for (const id of studioData.required) {
        if (!picked.has(id)) request.picks.push({ kind: "thread", id });
      }
    }
    const job = startBringOverJob({
      dataDir: dataDir(),
      snapshot: snap,
      target: deps.db.$client,
      request,
      logger: deps.logger,
      now: Date.now(),
      ...(studioData === undefined
        ? {}
        : {
            onFinished: (finished: BringOverJob) =>
              finishStudioJob({
                dataDir: dataDir(),
                target: deps.db.$client,
                job: finished,
                required: studioData.required,
              }),
          }),
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

  app.post("/fork/bring-over/jobs/current/cancel", (context) => {
    requireUi(context, "cancel");
    return context.json({ job: cancelBringOverJob(dataDir()) });
  });

  let studioDataStaging = false;
  const studioError = (error: unknown): never => {
    if (error instanceof BringOverError) {
      throw new ApiError(409, "invalid_request", error.message);
    }
    throw error;
  };

  app.get("/fork/bring-over/studio-data", async (context) => {
    const sourceDataDir = await bringOverSource(dataDir(), process.env);
    return context.json(
      sourceDataDir === null
        ? { inBb: false, bots: 0, pages: 0, tasks: 0, journal: null }
        : await studioDataState(dataDir(), sourceDataDir),
    );
  });

  app.post("/fork/bring-over/studio-data", async (context) => {
    requireUi(context, "studio-data");
    const sourceDataDir = await source();
    if (currentBringOverJob(dataDir())?.state === "running") {
      throw new ApiError(
        409,
        "invalid_request",
        "Wait for the bring-over that is running to finish",
      );
    }
    if (studioDataStaging || snapshotting !== null) {
      throw new ApiError(409, "invalid_request", "bb is being read already");
    }
    studioDataStaging = true;
    try {
      const staged = await stageStudioData({
        dataDir: dataDir(),
        sourceDataDir,
        now: Date.now(),
      }).catch(studioError);
      return context.json({
        journal: staged.journal,
        studioData: await studioDataState(dataDir(), sourceDataDir),
      });
    } finally {
      studioDataStaging = false;
    }
  });

  app.post("/fork/bring-over/studio-data/discard", async (context) => {
    requireUi(context, "studio-data/discard");
    if (studioDataStaging) {
      throw new ApiError(409, "invalid_request", "bb is being read");
    }
    if (currentBringOverJob(dataDir())?.state === "running") {
      throw new ApiError(
        409,
        "invalid_request",
        "Wait for the bring-over that is running to finish",
      );
    }
    await discardStudioData(dataDir()).catch(studioError);
    return context.body(null, 204);
  });

  app.post("/fork/bring-over/studio-data/put-back", async (context) => {
    requireUi(context, "studio-data/put-back");
    await requestStudioPutBack(dataDir()).catch(studioError);
    return context.body(null, 204);
  });

  app.post("/fork/bring-over/studio-data/forget", async (context) => {
    requireUi(context, "studio-data/forget");
    await forgetStudioData(dataDir()).catch(studioError);
    return context.body(null, 204);
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
