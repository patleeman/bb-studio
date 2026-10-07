// The Backup and restore section of the Setup page. See use-backup.ts.
import { Button, cn } from "@bb-studio/kit/ui";
import { useRef } from "react";
import type { RestoreResult } from "../../backup-contract";
import { useBackup, type BackupApi } from "./use-backup";
import { CommandLine } from "./SetupPage";

const size = (bytes: number) => (bytes < 1024 ** 2 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`);

function Outcome({ result }: { result: RestoreResult }) {
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1 text-xs">
        {result.sections.map((section) => {
          const report = section.report;
          const parts = report ? [
            report.created && `${report.created} new`,
            report.updated && `${report.updated} updated`,
            report.unchanged && `${report.unchanged} already here`,
            report.kept && `${report.kept} kept (newer here)`,
            report.unmapped && `${report.unmapped} ${result.dryRun ? "would become" : "became"} global`,
            report.failed && `${report.failed} failed`,
          ].filter(Boolean).join(", ") || "Nothing to restore" : section.reason;
          return (
            <li key={section.pluginId} className="flex gap-2">
              <span className="w-32 shrink-0 font-medium text-foreground">{section.name}</span>
              <span className={cn("min-w-0 flex-1", section.status === "failed" || report?.failed ? "text-destructive" : "text-muted-foreground")}>
                {section.status === "failed" ? `Failed: ${section.reason}` : parts}
              </span>
            </li>
          );
        })}
      </ul>
      {result.projects.unmapped.length ? (
        <p className="text-xs text-warning">
          Not on this BB, so their items {result.dryRun ? "would become" : "became"} global: {result.projects.unmapped.map((project) => project.name).join(", ")}.
        </p>
      ) : null}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Details</summary>
        <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 font-mono text-[11px]">{result.text}</pre>
      </details>
    </div>
  );
}

export function BackupView({ api }: { api: BackupApi }) {
  const input = useRef<HTMLInputElement>(null);
  const { state } = api;
  const busy = ["backing-up", "uploading", "checking", "restoring"].includes(state.step);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-foreground">Backup and restore</h2>
      <p className="text-xs leading-relaxed text-muted-foreground">
        One file with every page, recording, drawing, artifact, table and design, plus your tags and Spaces. Restoring it on another BB adds what's missing and never overwrites newer work there; running it twice changes nothing.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void api.backup()}>{state.step === "backing-up" ? "Backing up…" : "Back up"}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>Restore…</Button>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          aria-label="Backup file to restore"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void api.plan(file);
          }}
        />
      </div>
      {state.step === "backed-up" ? (
        <p className="text-xs text-muted-foreground">
          Saved {state.name} ({size(state.bytes)}). <a className="text-foreground underline" href={state.href} download={state.name}>Download again</a>
        </p>
      ) : null}
      {state.step === "uploading" ? <p className="text-xs text-muted-foreground">Uploading {state.fileName}… {Math.round(state.progress * 100)}%</p> : null}
      {state.step === "checking" ? <p className="text-xs text-muted-foreground">Checking {state.fileName}…</p> : null}
      {state.step === "planned" || state.step === "restoring" ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-xs text-foreground">Restoring {state.fileName} (backed up {new Date(state.plan.createdAt).toLocaleString()}) would do this. Nothing has changed yet.</p>
          <Outcome result={state.plan} />
          <div className="flex items-center gap-1.5">
            <Button size="sm" disabled={state.step === "restoring"} onClick={() => void api.confirm()}>{state.step === "restoring" ? "Restoring…" : "Restore"}</Button>
            <Button size="sm" variant="ghost" disabled={state.step === "restoring"} onClick={api.cancel}>Cancel</Button>
          </div>
        </div>
      ) : null}
      {state.step === "restored" ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-xs text-foreground">{state.result.failed ? "Restored, with problems:" : `Restored ${state.fileName}.`}</p>
          <Outcome result={state.result} />
        </div>
      ) : null}
      {state.step === "error" ? <p className="text-xs text-destructive">{state.message}</p> : null}
      <CommandLine command="bb studio backup --out ~/Desktop" />
    </section>
  );
}

export function BackupSection() {
  return <BackupView api={useBackup()} />;
}
