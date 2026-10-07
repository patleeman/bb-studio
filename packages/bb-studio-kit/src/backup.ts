// The Studio backup contract: two optional RPC methods an add-on registers so
// `bb studio backup` can save its items and `bb studio restore` can put them
// back on another BB. See docs/backup.md for the file format.
//
// Files never travel through RPC. Studio makes a session folder under its own
// plugin data directory and passes the session id; each add-on reads or writes
// its own `<session>/<pluginId>/` folder there (server/backup.ts). Plugins run
// on the same BB server, so both can reach it.
//
// No runtime zod import, for the reason in contract.ts.
import type { z as Zod } from "zod";

/** `manifest.json`'s `format`. */
export const BACKUP_FORMAT = "bb-studio-backup";
/** The archive layout version. A reader refuses a newer one. */
export const BACKUP_VERSION = 1;
export const STUDIO_BACKUP_METHOD = "studio_backup";
export const STUDIO_RESTORE_METHOD = "studio_restore";
/** A session id: Studio picks it, add-ons only ever join it to a known root. */
export const BACKUP_SESSION_PATTERN = /^bk_[a-z0-9]{8,40}$/;
/** At most this many per-item problems are reported back. */
export const MAX_RESTORE_PROBLEMS = 200;

/**
 * What restoring one item did.
 * - created: it wasn't here, now it is.
 * - updated: the backup was newer, so it replaced the copy here.
 * - unchanged: the copy here is the same age; nothing to do (a re-run).
 * - kept: the copy here is newer, so it stayed as it is.
 * - failed: it couldn't be restored; see problems.
 */
export type RestoreOutcome = "created" | "updated" | "unchanged" | "kept" | "failed";

export interface RestoreProblem {
  id: string;
  title: string;
  reason: string;
}

export interface RestoreReport {
  created: number;
  updated: number;
  unchanged: number;
  kept: number;
  failed: number;
  /** Items whose BB project isn't on this BB; they were restored as global items. */
  unmapped: number;
  problems: RestoreProblem[];
  notes: string[];
}

export function studioBackupSchemas(z: typeof Zod) {
  const session = z.string().regex(BACKUP_SESSION_PATTERN);
  const count = z.number().int().min(0);
  const projectId = z.string().min(1).max(200);
  const problem = z.object({ id: z.string(), title: z.string(), reason: z.string() });
  const report = z.object({
    created: count,
    updated: count,
    unchanged: count,
    kept: count,
    failed: count,
    unmapped: count,
    problems: z.array(problem).max(MAX_RESTORE_PROBLEMS),
    notes: z.array(z.string()).max(50),
  });
  return {
    report,
    /** Register with `registerStudioBackup` from the kit's server module. */
    provider: {
      /** Writes the add-on's items into `<session>/<pluginId>/`. */
      studio_backup: {
        input: z.object({ session }),
        output: z.object({
          /** The add-on's own section layout version. */
          version: z.number().int().min(1),
          /** What was saved, by name, e.g. `{ pages: 12, versions: 40 }`. */
          counts: z.record(z.string(), count),
          files: count,
          bytes: count,
          notes: z.array(z.string()).max(50),
        }),
      },
      /**
       * Restores `<session>/<pluginId>/`, keyed by the original item ids, so a
       * second run changes nothing. With `dryRun`, it only reports what it
       * would do. `projects` maps the backup's project ids to this BB's, or to
       * null when the project isn't here.
       */
      studio_restore: {
        input: z.object({
          session,
          dryRun: z.boolean(),
          version: z.number().int().min(1),
          projects: z.record(projectId, projectId.nullable()),
        }),
        output: report,
      },
    },
  };
}

export type StudioBackupSchemas = ReturnType<typeof studioBackupSchemas>;

/**
 * What to do with a backed-up item, given the `updatedAt` of the copy here
 * (null when there isn't one). Equal times are a re-run; a newer copy here is
 * never overwritten.
 */
export function restoreDecision(local: number | null | undefined, incoming: number): "create" | "update" | "unchanged" | "keep" {
  if (local == null) return "create";
  if (incoming > local) return "update";
  return incoming === local ? "unchanged" : "keep";
}

/** This BB's project for a backed-up item's project; unknown projects become global. */
export function mapProject(projects: Readonly<Record<string, string | null>>, projectId: string | null | undefined): { projectId: string | null; unmapped: boolean } {
  if (!projectId) return { projectId: null, unmapped: false };
  const mapped = projects[projectId];
  return mapped ? { projectId: mapped, unmapped: false } : { projectId: null, unmapped: true };
}

/** Counts a restore's outcomes and keeps the first problems. */
export class RestoreTally {
  private readonly report: RestoreReport = { created: 0, updated: 0, unchanged: 0, kept: 0, failed: 0, unmapped: 0, problems: [], notes: [] };

  constructor(private readonly dryRun = false) {}

  /** Records one item. `kept` and `failed` need a reason. */
  record(outcome: RestoreOutcome, item?: { id: string; title?: string | null }, reason?: string): void {
    this.report[outcome] += 1;
    if (item && reason) this.problem(item, reason);
  }

  /** Records the outcome `restoreDecision` chose. */
  decided(decision: "create" | "update" | "unchanged" | "keep", item: { id: string; title?: string | null }): void {
    if (decision === "keep") this.record("kept", item, this.dryRun ? "The copy here is newer; it would be kept." : "The copy here is newer; it was kept.");
    else this.record(decision === "create" ? "created" : decision === "update" ? "updated" : "unchanged");
  }

  /** An item whose project isn't on this BB, restored as a global item. */
  unmapped(item: { id: string; title?: string | null }): void {
    this.report.unmapped += 1;
    this.problem(item, "Its project isn't on this BB; it is a global item now.");
  }

  note(text: string): void {
    if (this.report.notes.length < 50 && !this.report.notes.includes(text)) this.report.notes.push(text);
  }

  private problem(item: { id: string; title?: string | null }, reason: string): void {
    if (this.report.problems.length < MAX_RESTORE_PROBLEMS) this.report.problems.push({ id: item.id, title: item.title?.trim() || "Untitled", reason });
  }

  result(): RestoreReport {
    return { ...this.report, problems: [...this.report.problems], notes: [...this.report.notes] };
  }
}
