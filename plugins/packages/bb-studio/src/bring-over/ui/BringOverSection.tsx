// Settings → "Bring things over from bb". Lists what the old bb install has
// (read from a fresh copy of its database) and brings the picked projects,
// threads and settings over in a background job, with progress and Cancel.
// Plugins are added one at a time. Nothing is shown on a BB without the
// fork's bring-over routes or without a bb install.
import { useCallback, useEffect, useRef, useState } from "react";
import { relativeTime, errorMessage } from "../../kit/format";
import { Button } from "../../kit/ui/index";
import { Card, Row, SubHeading, Switch } from "../../settings/ui/controls";
import {
  addOldPlugin,
  cancelBringOver,
  currentJob,
  jobLine,
  listProjectThreads,
  readBb,
  readBringOver,
  startBringOver,
  type BringOverPlugin,
  type BringOverProject,
  type BringOverRequest,
  type BringOverState,
  type BringOverThread,
} from "../api";

export const BRING_OVER_SECTION_ANCHOR = "studio-settings-bring-over";

let requested = false;
/** Asks the section to scroll itself into view when it next mounts. */
export function requestBringOverSection(): void {
  requested = true;
}

const POLL_MS = 1_000;

export interface Picks {
  projects: Set<string>;
  threads: Set<string>;
  settings: Map<string, boolean>;
  attachments: boolean;
}

export function requestFrom(picks: Picks): BringOverRequest {
  return {
    picks: [
      ...[...picks.projects].map((id) => ({ kind: "project" as const, id })),
      ...[...picks.threads].map((id) => ({ kind: "thread" as const, id })),
    ],
    attachments: picks.attachments,
    settings: [...picks.settings].map(([id, replace]) => ({ id, replace })),
  };
}

function ProjectRow({ project, picks, onChange }: { project: BringOverProject; picks: Picks; onChange(): void }) {
  const [threads, setThreads] = useState<BringOverThread[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allHere = project.threadsHere >= project.threads;
  const toggleOpen = () => {
    setOpen(!open);
    if (!open && threads === null) void listProjectThreads(project.id).then(setThreads, (cause: unknown) => setError(errorMessage(cause)));
  };
  const whole = picks.projects.has(project.id);
  const details = [
    `${String(project.threads)} threads`,
    project.lastActivityAt ? `last active ${relativeTime(project.lastActivityAt)}` : null,
    project.threadsHere > 0 ? (allHere ? "Already here" : `${String(project.threadsHere)} already here`) : null,
    project.joins ? `joins ${project.joins.name}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <li data-testid="bring-over-project" className="flex flex-col gap-1 py-1">
      <div className="flex items-center gap-2">
        <input type="checkbox" aria-label={`Bring over ${project.name}`} checked={whole} disabled={allHere} onChange={(event) => { if (event.target.checked) picks.projects.add(project.id); else picks.projects.delete(project.id); onChange(); }} />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{project.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{details}</span>
        <button type="button" className="shrink-0 text-xs text-muted-foreground underline underline-offset-2" onClick={toggleOpen}>{open ? "Hide threads" : "Threads"}</button>
      </div>
      {error ? <p className="pl-6 text-xs text-destructive">{error}</p> : null}
      {open && threads ? (
        <ul className="flex flex-col gap-0.5 pl-6">
          {threads.map((thread) => (
            <li key={thread.id} data-testid="bring-over-thread" className="flex items-center gap-2 text-xs">
              <input type="checkbox" aria-label={`Bring over ${thread.title}`} checked={whole || thread.here || picks.threads.has(thread.id)} disabled={whole || thread.here} onChange={(event) => { if (event.target.checked) picks.threads.add(thread.id); else picks.threads.delete(thread.id); onChange(); }} />
              <span className="min-w-0 flex-1 truncate text-foreground">{thread.title}</span>
              <span className="shrink-0 text-muted-foreground">{thread.here ? "Already here" : relativeTime(thread.updatedAt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function PluginRow({ plugin, onAdded }: { plugin: BringOverPlugin; onAdded(): void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await addOldPlugin(plugin.id);
      setNote(result.data ? "Added with its data" : "Added");
      onAdded();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const description = [plugin.version ? `v${plugin.version}` : null, plugin.source, plugin.hasData ? "has data" : null].filter(Boolean).join(" · ");
  return (
    <Row label={plugin.id} description={<>{description}{error ? <span className="block text-destructive">{error}</span> : null}</>} testId={`bring-over-plugin-${plugin.id}`}>
      {plugin.here || note ? <span className="text-xs text-muted-foreground">{note ?? "Already here"}</span>
        : plugin.sourceMissing ? <span className="text-xs text-muted-foreground">Source gone</span>
        : <Button size="sm" variant="outline" disabled={busy} onClick={() => void add()}>Add</Button>}
    </Row>
  );
}

export function BringOverSection() {
  const [state, setState] = useState<BringOverState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [, setVersion] = useState(0);
  const picks = useRef<Picks>({ projects: new Set(), threads: new Set(), settings: new Map(), attachments: true });
  const ref = useRef<HTMLDivElement>(null);
  const changed = () => setVersion((value) => value + 1);
  const load = useCallback(() => void readBringOver().then(setState), []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!requested || !state?.available) return;
    requested = false;
    ref.current?.scrollIntoView({ block: "start" });
  }, [state?.available]);
  const running = state?.job?.state === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void currentJob().then(({ job }) => {
        if (job?.state === "running") setState((previous) => (previous ? { ...previous, job } : previous));
        else load();
      }, () => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);
  if (!state?.available) return null;
  const read = async () => {
    setReading(true);
    setError(null);
    try { setState(await readBb()); } catch (cause) { setError(errorMessage(cause)); } finally { setReading(false); }
  };
  const start = async () => {
    setError(null);
    try {
      const job = await startBringOver(requestFrom(picks.current));
      picks.current = { projects: new Set(), threads: new Set(), settings: new Map(), attachments: picks.current.attachments };
      setState({ ...state, job });
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const p = picks.current;
  const nothingPicked = p.projects.size === 0 && p.threads.size === 0 && p.settings.size === 0;
  return (
    <div ref={ref} id={BRING_OVER_SECTION_ANCHOR} data-testid="bring-over" className="scroll-mt-4">
      <Card>
        <Row label="From" description={state.readAt ? `${state.sourceDataDir ?? ""} · read ${relativeTime(state.readAt)}` : state.sourceDataDir} testId="bring-over-source">
          <Button size="sm" variant="outline" disabled={reading || running} onClick={() => void read()}>{reading ? "Reading…" : state.readAt ? "Read again" : "Read bb"}</Button>
        </Row>
        {error ? <p className="px-3 py-1 text-xs text-destructive">{error}</p> : null}
        {state.job ? (
          <div data-testid="bring-over-job" className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1">{jobLine(state.job)}</span>
            {running ? <Button size="sm" variant="outline" onClick={() => void cancelBringOver().then(load, () => {})}>Cancel</Button> : null}
          </div>
        ) : null}
        {state.job && !running && state.job.failures.length > 0 ? (
          <ul className="px-3 pb-2 text-xs text-destructive">{state.job.failures.slice(0, 10).map((failure) => <li key={failure.item}>{failure.item}: {failure.detail}</li>)}</ul>
        ) : null}
      </Card>
      {state.projects ? (
        <>
          <SubHeading>Projects and threads</SubHeading>
          <Card>
            {state.projects.length === 0 ? <p className="px-3 py-2 text-sm text-muted-foreground">No threads in bb</p> : (
              <ul className="flex flex-col px-3 py-1">{state.projects.map((project) => <ProjectRow key={project.id} project={project} picks={p} onChange={changed} />)}</ul>
            )}
            <Row label="Attachments" description="Pictures and files in the picked threads" testId="bring-over-attachments">
              <Switch label="Attachments" checked={p.attachments} onChange={(next) => { p.attachments = next; changed(); }} />
            </Row>
          </Card>
          <SubHeading>Settings</SubHeading>
          <Card>
            {(state.settings ?? []).map((setting) => (
              <Row key={setting.id} label={setting.label} description={setting.detail} testId={`bring-over-setting-${setting.id}`}>
                <span className="flex items-center gap-3">
                  {p.settings.has(setting.id) ? (
                    <label className="flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={p.settings.get(setting.id) === true} onChange={(event) => { p.settings.set(setting.id, event.target.checked); changed(); }} />Replace BB Studio's</label>
                  ) : null}
                  <Switch label={setting.label} checked={p.settings.has(setting.id)} onChange={(next) => { if (next) p.settings.set(setting.id, false); else p.settings.delete(setting.id); changed(); }} />
                </span>
              </Row>
            ))}
          </Card>
          <div className="flex justify-end py-2">
            <Button disabled={nothingPicked || running} onClick={() => void start()} data-testid="bring-over-start">Bring over</Button>
          </div>
          <SubHeading>Plugins from bb</SubHeading>
          <Card>
            {(state.plugins ?? []).length === 0 ? <p className="px-3 py-2 text-sm text-muted-foreground">No plugins to add</p>
              : (state.plugins ?? []).map((plugin) => <PluginRow key={plugin.id} plugin={plugin} onAdded={() => {}} />)}
          </Card>
        </>
      ) : null}
    </div>
  );
}
