import type { Command } from "commander";
import { action, CliExitError } from "../action.js";
import { cliFetch } from "../client.js";
import { reportCommandResult } from "../command-result.js";

interface MirrorOptions {
  json?: boolean;
}

async function call(
  getUrl: () => string,
  method: "GET" | "POST",
  path: string,
): Promise<Record<string, unknown>> {
  const response = await cliFetch(
    `${getUrl().replace(/\/$/u, "")}/api/v1/fork/import${path}`,
    { method },
  );
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const message =
      typeof body.message === "string"
        ? body.message
        : `The server answered ${String(response.status)}`;
    throw new CliExitError(message, 1);
  }
  return body;
}

function when(value: unknown): string {
  return typeof value === "number" ? new Date(value).toLocaleString() : "never";
}

function printStatus(status: Record<string, unknown>): void {
  if (status.imported !== true) {
    const job = status.bringOver as
      | {
          state?: unknown;
          threadsImported?: unknown;
          threadsSkipped?: unknown;
          failures?: unknown[];
        }
      | null
      | undefined;
    if (job === null || job === undefined) {
      console.log("Nothing was brought over from bb yet.");
      return;
    }
    console.log(
      `Last bring-over: ${String(job.state)}, ${String(job.threadsImported)} threads brought over, ${String(job.threadsSkipped)} already here, ${String(job.failures?.length ?? 0)} failed`,
    );
    return;
  }
  console.log(`Imported from  ${String(status.sourceDataDir)}`);
  console.log(`Imported       ${when(status.importedAt)}`);
  console.log(
    `Sync           ${status.paused === true ? "paused" : "on"}, last run ${when(status.lastSyncAt)}`,
  );
  console.log(
    `Threads        ${String(status.mirroredThreads)} mirrored (read-only), ${String(status.takenOverThreads)} taken over`,
  );
}

export function registerForkImportCommands(
  server: Command,
  getUrl: () => string,
): void {
  const mirror = server
    .command("mirror")
    .description(
      "The one-way mirror of another bb install: status, sync now, pause, take a thread over",
    );

  mirror
    .command("status")
    .description("Show where this server was imported from and the sync state")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: MirrorOptions) => {
        const status = await call(getUrl, "GET", "");
        reportCommandResult(opts, status, {
          text: () => printStatus(status),
          failure: null,
        });
      }),
    );

  mirror
    .command("sync")
    .description("Copy what changed at the source now")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: MirrorOptions) => {
        const summary = await call(getUrl, "POST", "/sync");
        reportCommandResult(opts, summary, {
          text: [
            typeof summary.skipped === "string"
              ? `Skipped: ${summary.skipped}`
              : `Synced ${String(summary.threads)} threads, ${String(summary.eventsAdded)} new events, ${String(summary.eventReloads)} threads reloaded, ${String(summary.threadsDeleted)} removed.`,
          ],
          failure: null,
        });
      }),
    );

  for (const [name, description] of [
    ["pause", "Stop copying changes from the source"],
    ["resume", "Copy changes from the source again"],
  ] as const) {
    mirror
      .command(name)
      .description(description)
      .option("--json", "Print machine-readable JSON output")
      .action(
        action(async (opts: MirrorOptions) => {
          const status = await call(getUrl, "POST", `/${name}`);
          reportCommandResult(opts, status, {
            text: () => printStatus(status),
            failure: null,
          });
        }),
      );
  }

  mirror
    .command("thread <threadId>")
    .description(
      "Show whether a thread is mirrored and what it is doing at the source",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, opts: MirrorOptions) => {
        const thread = await call(
          getUrl,
          "GET",
          `/threads/${encodeURIComponent(threadId)}`,
        );
        reportCommandResult(opts, thread, {
          text: [
            thread.mirrored !== true
              ? "Not mirrored: this thread belongs to this server."
              : thread.readOnly === true
                ? `Mirrored, read-only. At the source: ${String(thread.sourceStatus)}, ${String(thread.sourceQueuedMessages)} queued messages.`
                : `Taken over ${when(thread.takenOverAt)}.`,
          ],
          failure: null,
        });
      }),
    );

  mirror
    .command("take-over <threadId>")
    .description(
      "Make a mirrored thread writable here. Refused while it runs or has queued messages at the source",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, opts: MirrorOptions) => {
        const result = await call(
          getUrl,
          "POST",
          `/threads/${encodeURIComponent(threadId)}/take-over`,
        );
        reportCommandResult(opts, result, {
          text: [String(result.note)],
          failure: null,
        });
      }),
    );
}
