import { readServerImportFile } from "@bb/server-archive";
import type { Hono } from "hono";
import { runForkPluginSync } from "./plugin-sync.js";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { defineSingleItemSweep } from "../system/item-sweep.js";
import {
  getMirroredThread,
  hasForkImport,
  isMirroredReadOnly,
  openForkImportDatabase,
  readCursor,
  readForkImportState,
  writeCursor,
} from "./state.js";
import {
  copyMissingThreadStorage,
  runForkImportSync,
  type ForkSyncSummary,
} from "./sync.js";
import {
  readHostId,
  readSourceThreadActivity,
  takeOverMirroredThread,
  TakeOverRefusedError,
} from "./takeover.js";
import { startForkSweeps, type ForkSweepJob } from "./sweeps.js";
import {
  registerForkThreadWriteGuard,
  type ForkThreadWriteGuard,
} from "../threads/thread-write-guards.fork.js";
import {
  registerForkHostStandIn,
  type ForkHostStandIn,
} from "../threads/thread-fork-hosts.fork.js";

const SYNC_CADENCE_MS = 60_000;
const PLUGIN_SYNC_CADENCE_MS = 5 * 60_000;

let activeDataDir: string | null = null;
let sweepsStarted = false;

export function setForkImportDataDir(dataDir: string | null): void {
  activeDataDir = dataDir;
  if (dataDir !== null) {
    registerForkThreadWriteGuard(refuseMirroredThread);
    registerForkHostStandIn(forkMirroredThreadHere);
  }
}

function requireDataDir(): string {
  if (activeDataDir === null) {
    throw new ApiError(409, "invalid_request", "Nothing was imported here");
  }
  return activeDataDir;
}

export const MIRRORED_THREAD_MESSAGE =
  "This thread is mirrored from bb and is read-only here. Take it over to continue it in BB Studio.";

const refuseMirroredThread: ForkThreadWriteGuard = (thread) =>
  activeDataDir !== null && isMirroredReadOnly(activeDataDir, thread.id)
    ? { reason: "mirrored", message: MIRRORED_THREAD_MESSAGE }
    : null;

const forkMirroredThreadHere: ForkHostStandIn = ({
  sourceThread,
  sourceHostId,
  childHostId,
}) => {
  if (activeDataDir === null) return false;
  if (!isMirroredReadOnly(activeDataDir, sourceThread.id)) return false;
  const state = readForkImportState(activeDataDir);
  return (
    state?.sourceServerHostId === sourceHostId &&
    readHostId(activeDataDir) === childHostId
  );
};

const FORK_SWEEP_JOBS: readonly ForkSweepJob[] = [
  {
    cadenceMs: SYNC_CADENCE_MS,
    category: "maintenance",
    name: "fork-import-sync",
    background: true,
    sweep: (deps, now) =>
      defineSingleItemSweep({
        name: "fork-import-sync",
        process: () => {
          if (activeDataDir === null || !hasForkImport(activeDataDir)) return;
          runForkImportSync({
            dataDir: activeDataDir,
            database: deps.db.$client,
            logger: deps.logger,
            now,
          });
        },
      }),
  },
  {
    cadenceMs: SYNC_CADENCE_MS,
    category: "maintenance",
    name: "fork-import-thread-storage",
    background: true,
    sweep: (deps) =>
      defineSingleItemSweep({
        name: "fork-import-thread-storage",
        process: async () => {
          if (activeDataDir === null || !hasForkImport(activeDataDir)) return;
          await copyMissingThreadStorage({
            dataDir: activeDataDir,
            logger: deps.logger,
          });
        },
      }),
  },
  {
    cadenceMs: PLUGIN_SYNC_CADENCE_MS,
    category: "maintenance",
    name: "fork-import-plugin-sync",
    background: true,
    sweep: () =>
      defineSingleItemSweep({
        name: "fork-import-plugin-sync",
        process: () => {
          if (activeDataDir === null || !hasForkImport(activeDataDir)) return;
          runForkPluginSync({ dataDir: activeDataDir });
        },
      }),
  },
];

async function startForkImportSweeps(
  deps: AppDeps,
  dataDir: string,
): Promise<void> {
  if (sweepsStarted) return;
  sweepsStarted = true;
  const marker = await readServerImportFile(dataDir).catch(() => null);
  if (marker?.kind === "move") return;
  startForkSweeps(deps, FORK_SWEEP_JOBS);
}

function lastSummary(dataDir: string): ForkSyncSummary | null {
  const raw = readCursor(openForkImportDatabase(dataDir), "lastSummary");
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as ForkSyncSummary;
  } catch {
    return null;
  }
}

function importStatus(deps: AppDeps) {
  const state = readForkImportState(requireDataDir());
  if (state === null || !hasForkImport(requireDataDir())) {
    return { imported: false as const };
  }
  const fork = openForkImportDatabase(requireDataDir());
  const counts = fork
    .prepare<[], { mirrored: number; takenOver: number }>(
      `SELECT
         SUM(CASE WHEN taken_over_at IS NULL THEN 1 ELSE 0 END) AS mirrored,
         SUM(CASE WHEN taken_over_at IS NOT NULL THEN 1 ELSE 0 END) AS takenOver
       FROM mirrored_threads`,
    )
    .get();
  const lastSyncAt = readCursor(fork, "lastSyncAt");
  return {
    imported: true as const,
    sourceDataDir: state.sourceDataDir,
    importedAt: state.importedAt,
    paused: readCursor(fork, "paused") === "true",
    lastSyncAt: lastSyncAt === null ? null : Number(lastSyncAt),
    mirroredThreads: counts?.mirrored ?? 0,
    takenOverThreads: counts?.takenOver ?? 0,
    lastSummary: lastSummary(requireDataDir()),
  };
}

export function registerForkImportRoutes(app: Hono, deps: AppDeps): void {
  if (activeDataDir !== null) void startForkImportSweeps(deps, activeDataDir);
  app.get("/fork/import", (context) => context.json(importStatus(deps)));

  app.post("/fork/import/sync", (context) => {
    const summary = runForkImportSync({
      dataDir: requireDataDir(),
      database: deps.db.$client,
      logger: deps.logger,
      now: Date.now(),
    });
    if (summary === null) {
      throw new ApiError(409, "invalid_request", "Nothing was imported here");
    }
    return context.json({
      ...summary,
      plugins: runForkPluginSync({ dataDir: requireDataDir() }),
    });
  });

  app.post("/fork/import/pause", (context) => {
    writeCursor(openForkImportDatabase(requireDataDir()), "paused", "true");
    return context.json(importStatus(deps));
  });

  app.post("/fork/import/resume", (context) => {
    writeCursor(openForkImportDatabase(requireDataDir()), "paused", "false");
    return context.json(importStatus(deps));
  });

  app.get("/fork/import/threads/:threadId", (context) => {
    const threadId = context.req.param("threadId");
    const mirrored = getMirroredThread(requireDataDir(), threadId);
    if (mirrored === null) return context.json({ mirrored: false });
    const state = readForkImportState(requireDataDir());
    const activity =
      state === null || mirrored.takenOverAt !== null
        ? null
        : readSourceThreadActivity(state.sourceDataDir, threadId);
    return context.json({
      mirrored: true,
      readOnly: mirrored.takenOverAt === null,
      takenOverAt: mirrored.takenOverAt,
      sourceStatus: activity?.status ?? mirrored.sourceStatus,
      sourceQueuedMessages: activity?.queuedMessages ?? 0,
    });
  });

  app.post("/fork/import/threads/:threadId/take-over", (context) => {
    try {
      return context.json(
        takeOverMirroredThread({
          dataDir: requireDataDir(),
          database: deps.db.$client,
          logger: deps.logger,
          threadId: context.req.param("threadId"),
          now: Date.now(),
        }),
      );
    } catch (error) {
      if (error instanceof TakeOverRefusedError) {
        throw new ApiError(409, "invalid_request", error.message, {
          details: { reason: error.reason },
        });
      }
      throw error;
    }
  });
}
