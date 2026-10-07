// `bb studio backup` and `bb studio restore` (docs/backup.md). Studio makes a
// session folder, asks each add-on to write or read its own section there
// (the kit's studio_backup / studio_restore), adds its own data, and zips or
// unzips the whole folder. Files never travel through RPC.
import { randomBytes } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKUP_FORMAT, BACKUP_VERSION, STUDIO_BACKUP_METHOD, STUDIO_RESTORE_METHOD, studioBackupSchemas, type RestoreReport } from "@bb-studio/kit/backup";
import { backupSessionRoot, runBackup, runRestore, type BackupHandlers } from "@bb-studio/kit/server";
import { z } from "zod";
import { ADDONS } from "../setup-addons";
import { extractEntries, readEntry, readZip, zipDirectory, type ZipLimits, DEFAULT_LIMITS } from "./zip";

/** The add-ons whose items a backup holds, in restore order. */
export const BACKUP_ADDONS = ["pages", "talk", "excalidraw", "artifacts", "studio-tables", "design"] as const;

/** What a backup leaves out, on purpose. Written into every manifest. */
export const NOT_INCLUDED = [
  { what: "Studio Code workspaces", why: "A workspace is a folder on disk; back the folder up with your files." },
  { what: "Studio Mobile, Reactions, Decisions and Sidebar settings", why: "They're settings for this BB, not items; set them up again on the new BB." },
  { what: "BB threads, projects and their files", why: "They belong to BB itself. Items are matched to projects by path or name when restored." },
  { what: "Secrets and provider credentials", why: "They never leave the BB they were entered on." },
];

const studio = studioBackupSchemas(z);

const sectionSchema = z.object({
  pluginId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  name: z.string().max(200),
  status: z.enum(["included", "skipped", "failed"]),
  reason: z.string().max(2000).nullable(),
  pluginVersion: z.string().max(100).nullable(),
  version: z.number().int().min(1).nullable(),
  counts: z.record(z.string(), z.number()),
  files: z.number(),
  bytes: z.number(),
  notes: z.array(z.string().max(2000)).max(50),
});
export type BackupSection = z.infer<typeof sectionSchema>;

const projectSchema = z.object({ id: z.string().min(1).max(200), name: z.string().max(500), path: z.string().max(4000).nullable(), personal: z.boolean() });
export type BackupProject = z.infer<typeof projectSchema>;

export const manifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().min(1),
  createdAt: z.string(),
  bb: z.object({ version: z.string().nullable() }),
  projects: z.array(projectSchema).max(10_000),
  sections: z.array(sectionSchema).max(100),
  excluded: z.array(z.object({ what: z.string(), why: z.string() })),
});
export type BackupManifest = z.infer<typeof manifestSchema>;

export interface BackupSummary {
  file: string;
  bytes: number;
  manifest: BackupManifest;
}

export interface RestoreSection {
  pluginId: string;
  name: string;
  status: "restored" | "skipped" | "failed";
  reason: string | null;
  report: RestoreReport | null;
}

export interface RestoreSummary {
  dryRun: boolean;
  createdAt: string;
  sections: RestoreSection[];
  projects: { mapped: number; unmapped: { name: string; path: string | null }[] };
}

interface Plugin { id: string; name: string | null; enabled: boolean; version: string }
interface LocalProject { id: string; name: string; kind?: string; sources: readonly { path: string; isDefault?: boolean }[] }

export interface BackupDeps {
  /** BB's data directory (`bb.server.experimental_dataDir`). */
  dataDir: string;
  sdk: {
    plugins: {
      list(): Promise<{ plugins: readonly Plugin[] }>;
      experimental_discoverRpc(args: { method: string }): Promise<readonly { pluginId: string }[]>;
      callRpc(args: { pluginId: string; method: string; input?: unknown; outputSchema: unknown }): Promise<unknown>;
    };
    projects: { list(args: { includePersonal: boolean }): Promise<readonly LocalProject[]> };
  };
  bbVersion(): Promise<string | null>;
  /** Studio's own section. */
  studioData: BackupHandlers;
  limits?: ZipLimits;
}

const projectPath = (project: LocalProject) => (project.sources.find((source) => source.isDefault) ?? project.sources[0])?.path ?? null;
const nameOf = (pluginId: string, plugins: readonly Plugin[]) => ADDONS.find((addOn) => addOn.id === pluginId)?.displayName ?? plugins.find((plugin) => plugin.id === pluginId)?.name ?? pluginId;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * This BB's project for each backed-up project: the same id (restoring on the
 * same BB), else the Personal project, else the same folder path, else the
 * one project with the same name. Null when none matches.
 */
export function mapProjects(backup: readonly BackupProject[], local: readonly LocalProject[]): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const project of backup) {
    const byName = local.filter((each) => each.name.trim().toLowerCase() === project.name.trim().toLowerCase());
    const match =
      local.find((each) => each.id === project.id) ??
      (project.personal ? local.find((each) => each.kind === "personal") : undefined) ??
      (project.path ? local.find((each) => projectPath(each) === project.path) : undefined) ??
      (byName.length === 1 ? byName[0] : undefined);
    result[project.id] = match?.id ?? null;
  }
  return result;
}

export class BackupService {
  private running = false;

  constructor(private readonly deps: BackupDeps) {}

  /** One backup or restore at a time; a second one is refused, not queued. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.running) return Promise.reject(new Error("A Studio backup or restore is already running. Try again when it finishes."));
    this.running = true;
    return work().finally(() => { this.running = false; });
  }

  private async session(): Promise<{ id: string; dir: string }> {
    const id = `bk_${randomBytes(12).toString("hex")}`;
    const dir = join(backupSessionRoot(this.deps.dataDir), id);
    await mkdir(dir, { recursive: true });
    return { id, dir };
  }

  /** Clears session folders a crash left behind. */
  async cleanup(): Promise<void> {
    if (!this.running) await rm(backupSessionRoot(this.deps.dataDir), { recursive: true, force: true });
  }

  private async providers(method: string): Promise<{ plugins: readonly Plugin[]; able: Set<string>; discovered: boolean }> {
    const [{ plugins }, discovered] = await Promise.all([
      this.deps.sdk.plugins.list(),
      this.deps.sdk.plugins.experimental_discoverRpc({ method }).then((methods) => ({ ids: methods.map((each) => each.pluginId), ok: true }), () => ({ ids: [] as string[], ok: false })),
    ]);
    return { plugins, able: new Set(discovered.ids), discovered: discovered.ok };
  }

  backup(out: string): Promise<BackupSummary> {
    return this.exclusive(async () => {
      const session = await this.session();
      try {
        const { plugins, able, discovered } = await this.providers(STUDIO_BACKUP_METHOD);
        const extras = [...able].filter((id) => id !== "studio" && !(BACKUP_ADDONS as readonly string[]).includes(id)).sort();
        const sections: BackupSection[] = [];
        const empty = { version: null, counts: {}, files: 0, bytes: 0, notes: [] };
        for (const pluginId of [...BACKUP_ADDONS, ...extras]) {
          const plugin = plugins.find((each) => each.id === pluginId);
          const base = { pluginId, name: nameOf(pluginId, plugins), pluginVersion: plugin?.version ?? null };
          if (!plugin) sections.push({ ...base, ...empty, status: "skipped", reason: "Not installed on this BB." });
          else if (!plugin.enabled) sections.push({ ...base, ...empty, status: "skipped", reason: "Turned off on this BB." });
          else if (!able.has(pluginId))
            sections.push({ ...base, ...empty, status: "skipped", reason: discovered ? "This version can't make backups yet; update it and back up again." : "BB couldn't list which add-ons make backups." });
          else {
            try {
              const result = studio.provider.studio_backup.output.parse(
                await this.deps.sdk.plugins.callRpc({ pluginId, method: STUDIO_BACKUP_METHOD, input: { session: session.id }, outputSchema: studio.provider.studio_backup.output }),
              );
              sections.push({ ...base, status: "included", reason: null, ...result });
            } catch (error) {
              await rm(join(session.dir, pluginId), { recursive: true, force: true });
              sections.push({ ...base, ...empty, status: "failed", reason: message(error) });
            }
          }
        }
        const own = await runBackup(join(session.dir, "studio"), this.deps.studioData);
        const studioPlugin = plugins.find((each) => each.id === "studio");
        sections.push({ pluginId: "studio", name: "Studio", pluginVersion: studioPlugin?.version ?? null, status: "included", reason: null, ...own });
        const projects = (await this.deps.sdk.projects.list({ includePersonal: true })).map((project) => ({
          id: project.id, name: project.name, path: projectPath(project), personal: project.kind === "personal",
        }));
        const manifest: BackupManifest = {
          format: BACKUP_FORMAT,
          version: BACKUP_VERSION,
          createdAt: new Date().toISOString(),
          bb: { version: await this.deps.bbVersion().catch(() => null) },
          projects,
          sections,
          excluded: NOT_INCLUDED,
        };
        await writeFile(join(session.dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
        const { bytes } = await zipDirectory(session.dir, out, "manifest.json");
        return { file: out, bytes, manifest };
      } finally {
        await rm(session.dir, { recursive: true, force: true });
      }
    });
  }

  /** Reads and checks a backup's manifest without unpacking it. */
  async inspect(file: string): Promise<BackupManifest> {
    const entries = await readZip(file, this.deps.limits ?? DEFAULT_LIMITS);
    return this.manifest(file, entries);
  }

  private async manifest(file: string, entries: Awaited<ReturnType<typeof readZip>>): Promise<BackupManifest> {
    const entry = entries.find((each) => each.name === "manifest.json");
    if (!entry) throw new Error("This isn't a BB Studio backup: it has no manifest.json.");
    let raw: unknown;
    try {
      raw = JSON.parse((await readEntry(file, entry)).toString("utf8"));
    } catch (error) {
      throw new Error(`This backup's manifest.json can't be read: ${message(error)}`);
    }
    if ((raw as { format?: unknown })?.format !== BACKUP_FORMAT) throw new Error("This isn't a BB Studio backup.");
    const version = (raw as { version?: unknown }).version;
    if (typeof version === "number" && version > BACKUP_VERSION) throw new Error(`This backup was made by a newer Studio (format ${version}; this one reads up to ${BACKUP_VERSION}). Update Studio and try again.`);
    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`This backup's manifest.json isn't valid: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    return parsed.data;
  }

  restore(file: string, options: { dryRun: boolean }): Promise<RestoreSummary> {
    return this.exclusive(async () => {
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) throw new Error(`No backup file at ${file}.`);
      const entries = await readZip(file, this.deps.limits ?? DEFAULT_LIMITS);
      const manifest = await this.manifest(file, entries);
      const included = manifest.sections.filter((section) => section.status === "included");
      const sectionIds = new Set(included.map((section) => section.pluginId));
      const session = await this.session();
      try {
        // Only the sections the manifest lists are unpacked.
        await extractEntries(file, entries.filter((entry) => sectionIds.has(entry.name.split("/")[0]!)), session.dir);
        const projects = mapProjects(manifest.projects, await this.deps.sdk.projects.list({ includePersonal: true }));
        const { plugins, able, discovered } = await this.providers(STUDIO_RESTORE_METHOD);
        const sections: RestoreSection[] = [];
        // Add-ons first, so Studio's tags and links land on items that exist.
        const order = [...included.filter((section) => section.pluginId !== "studio"), ...included.filter((section) => section.pluginId === "studio")];
        for (const section of order) {
          const base = { pluginId: section.pluginId, name: section.name };
          const input = { session: session.id, dryRun: options.dryRun, version: section.version ?? 1, projects };
          if (section.pluginId === "studio") {
            try {
              sections.push({ ...base, status: "restored", reason: null, report: await runRestore(join(session.dir, "studio"), this.deps.studioData, input) });
            } catch (error) {
              sections.push({ ...base, status: "failed", reason: message(error), report: null });
            }
            continue;
          }
          const plugin = plugins.find((each) => each.id === section.pluginId);
          if (!plugin?.enabled) {
            sections.push({ ...base, status: "skipped", reason: `${section.name} isn't ${plugin ? "turned on" : "installed"} here. Install it, then restore again: items already restored are left as they are.`, report: null });
            continue;
          }
          if (!able.has(section.pluginId)) {
            sections.push({ ...base, status: "skipped", reason: discovered ? `This version of ${section.name} can't restore backups; update it and restore again.` : "BB couldn't list which add-ons restore backups.", report: null });
            continue;
          }
          try {
            const report = studio.report.parse(
              await this.deps.sdk.plugins.callRpc({ pluginId: section.pluginId, method: STUDIO_RESTORE_METHOD, input, outputSchema: studio.report }),
            );
            sections.push({ ...base, status: "restored", reason: null, report });
          } catch (error) {
            sections.push({ ...base, status: "failed", reason: message(error), report: null });
          }
        }
        for (const section of manifest.sections.filter((each) => each.status !== "included")) {
          sections.push({ pluginId: section.pluginId, name: section.name, status: "skipped", reason: `Not in this backup: ${section.reason ?? section.status}`, report: null });
        }
        const unmapped = manifest.projects.filter((project) => !projects[project.id]).map((project) => ({ name: project.name, path: project.path }));
        return { dryRun: options.dryRun, createdAt: manifest.createdAt, sections, projects: { mapped: manifest.projects.length - unmapped.length, unmapped } };
      } finally {
        await rm(session.dir, { recursive: true, force: true });
      }
    });
  }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const size = (bytes: number) => (bytes < 1024 ** 2 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`);

export function formatBackup(summary: BackupSummary): string {
  const lines = [`Saved ${summary.file} (${size(summary.bytes)}).`];
  for (const section of summary.manifest.sections) {
    const counts = Object.entries(section.counts).filter(([, count]) => count).map(([key, count]) => `${count} ${key}`).join(", ");
    lines.push(`${section.status === "included" ? "ok" : section.status}\t${section.name}\t${section.status === "included" ? counts || "nothing to save" : section.reason}`);
  }
  lines.push("Not included:", ...summary.manifest.excluded.map((entry) => `  ${entry.what}: ${entry.why}`));
  return `${lines.join("\n")}\n`;
}

export function formatRestore(summary: RestoreSummary): string {
  const verb = summary.dryRun ? "Would restore" : "Restored";
  const lines = [`${summary.dryRun ? "Dry run: nothing was changed. " : ""}Backup from ${summary.createdAt}.`];
  for (const section of summary.sections) {
    const report = section.report;
    if (!report) {
      lines.push(`${section.status}\t${section.name}\t${section.reason}`);
      continue;
    }
    const parts = [
      report.created && `${report.created} new`,
      report.updated && `${report.updated} updated`,
      report.unchanged && `${report.unchanged} already here`,
      report.kept && `${report.kept} kept (newer here)`,
      report.unmapped && `${report.unmapped} made global`,
      report.failed && `${report.failed} failed`,
    ].filter(Boolean);
    lines.push(`${report.failed ? "partial" : "ok"}\t${section.name}\t${verb}: ${parts.join(", ") || "nothing to restore"}`);
    for (const problem of report.problems.slice(0, 10)) lines.push(`\t\t${problem.title} (${problem.id}): ${problem.reason}`);
    if (report.problems.length > 10) lines.push(`\t\t…and ${plural(report.problems.length - 10, "more item")}`);
    for (const note of report.notes) lines.push(`\t\t${note}`);
  }
  if (summary.projects.unmapped.length) {
    lines.push("Projects not on this BB; their items are global items now (move them with bb studio move):");
    for (const project of summary.projects.unmapped) lines.push(`  ${project.name}${project.path ? ` (${project.path})` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

/** True when any section failed or any item couldn't be restored. */
export function restoreFailed(summary: RestoreSummary): boolean {
  return summary.sections.some((section) => section.status === "failed" || (section.report?.failed ?? 0) > 0);
}
