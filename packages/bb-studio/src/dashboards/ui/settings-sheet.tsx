// A widget's settings, in a sheet beside the grid: its type and options,
// and where its data comes from. Scripts show their exact command and wait
// for the user to review and approve them in the approval dialog.
import { useMemo, useState, type ReactNode } from "react";
import { GHOST_BUTTON, ICON_BUTTON, Icon, OUTLINE_BUTTON, PRIMARY_BUTTON, cn } from "@bb-studio/kit/app";
import { LIMITS, WIDGET_TYPES, WIDGETS, type Op, type Source, type WidgetTypeView, type WidgetView } from "../shared";

const FIELD = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
const AREA = cn(FIELD, "min-h-24 font-mono text-xs");

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      {children}
      {hint ? <span className="font-normal">{hint}</span> : null}
    </label>
  );
}

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false; error: string } => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};
const pretty = (value: unknown) => JSON.stringify(value ?? null, null, 2);

export function SettingsSheet({ widget, library, onSave, onReview, onRevoke, onClose }: {
  widget: WidgetView;
  library: readonly WidgetTypeView[];
  onSave(op: Op): Promise<boolean>;
  /** Opens the approval dialog. */
  onReview(): void;
  onRevoke(): void;
  onClose(): void;
}) {
  const [type, setType] = useState(widget.type);
  const [title, setTitle] = useState(widget.title ?? "");
  const [optionsText, setOptionsText] = useState(pretty(widget.options));
  const [source, setSource] = useState<Source>(widget.source);
  const [dataText, setDataText] = useState(pretty(widget.source.kind === "static" ? widget.source.data : null));
  const [customType, setCustomType] = useState<string | null>(widget.customType);
  const [html, setHtml] = useState(widget.html ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const info = WIDGETS[type];

  const options = useMemo(() => { const parsed = parseJson(optionsText); return parsed.ok && parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? (parsed.value as Record<string, unknown>) : null; }, [optionsText]);
  const setOption = (key: string, value: unknown) => {
    const next = { ...(options ?? {}) };
    if (value === "" || value === undefined || value === null) delete next[key];
    else next[key] = value;
    setOptionsText(pretty(next));
  };
  const option = (key: string) => (options && typeof options[key] === "string" ? (options[key] as string) : options && typeof options[key] === "number" ? String(options[key]) : "");

  const save = async () => {
    setError(null);
    if (!options) return setError("Options must be a JSON object.");
    let nextSource: Source = source;
    if (source.kind === "static") {
      const parsed = parseJson(dataText);
      if (!parsed.ok) return setError(`Data isn't valid JSON: ${parsed.error}`);
      nextSource = { kind: "static", data: parsed.value };
    }
    if (source.kind === "url" && !/^https?:\/\//i.test(source.url ?? "")) return setError("Enter an http or https URL.");
    if (source.kind === "script" && !source.command?.trim()) return setError("Enter a command.");
    if (type === "custom" && !customType && !html.trim()) return setError("Choose a library widget or write HTML.");
    setSaving(true);
    const ok = await onSave({
      op: "update",
      widgetId: widget.id,
      type,
      title: title.trim() || null,
      options,
      replaceOptions: true,
      source: info.usesData || type === "custom" ? nextSource : { kind: "none" },
      customType: type === "custom" ? customType : null,
      html: type === "custom" && !customType ? html : null,
    });
    setSaving(false);
    if (ok) onClose();
  };

  const scriptChanged = source.kind === "script" && (widget.source.kind !== "script" || widget.source.command !== source.command || (widget.source.cwd ?? "") !== (source.cwd ?? ""));

  return (
    <aside role="dialog" aria-label={`Settings for ${widget.title ?? info.label}`} className="absolute inset-y-0 right-0 z-30 flex w-[min(420px,100%)] flex-col border-l border-border bg-background shadow-xl">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="flex-1 truncate text-sm font-semibold text-foreground">Widget settings</h2>
        <button type="button" aria-label="Close settings" title="Close" className={ICON_BUTTON} onClick={onClose}><Icon name="X" /></button>
      </header>
      <div className="flex flex-1 flex-col gap-3 overflow-auto p-3">
        <Field label="Title"><input className={FIELD} value={title} maxLength={LIMITS.title} onChange={(event) => setTitle(event.target.value)} placeholder={info.label} /></Field>
        <Field label="Type" hint={info.description}>
          <select className={FIELD} value={type} onChange={(event) => setType(event.target.value as WidgetView["type"])}>
            {WIDGET_TYPES.map((each) => <option key={each} value={each}>{WIDGETS[each].label}</option>)}
          </select>
        </Field>

        {type === "note" ? <Field label="Markdown"><textarea className={cn(AREA, "min-h-40 font-sans text-sm")} value={option("markdown")} onChange={(event) => setOption("markdown", event.target.value)} /></Field> : null}
        {type === "stat" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Prefix"><input className={FIELD} value={option("prefix")} onChange={(event) => setOption("prefix", event.target.value)} placeholder="$" /></Field>
            <Field label="Unit"><input className={FIELD} value={option("unit")} onChange={(event) => setOption("unit", event.target.value)} placeholder="%" /></Field>
          </div>
        ) : null}
        {type === "embed" ? (
          <>
            <Field label="Studio item link" hint="e.g. /plugins/studio/studio/pages/…"><input className={FIELD} value={option("href")} onChange={(event) => setOption("href", event.target.value)} /></Field>
            <Field label="Thread id"><input className={FIELD} value={option("threadId")} onChange={(event) => setOption("threadId", event.target.value)} /></Field>
            <Field label="Web page URL" hint="Shown in a sandboxed frame."><input className={FIELD} value={option("url")} onChange={(event) => setOption("url", event.target.value)} placeholder="https://" /></Field>
          </>
        ) : null}
        {type === "image" ? <Field label="Image URL"><input className={FIELD} value={option("url")} onChange={(event) => setOption("url", event.target.value)} placeholder="https://" /></Field> : null}
        {type === "clock" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Mode">
              <select className={FIELD} value={option("mode") || "clock"} onChange={(event) => setOption("mode", event.target.value === "clock" ? "" : event.target.value)}>
                <option value="clock">Clock</option>
                <option value="countdown">Countdown</option>
              </select>
            </Field>
            {option("mode") === "countdown"
              ? <Field label="Until"><input className={FIELD} type="datetime-local" value={option("target").slice(0, 16)} onChange={(event) => setOption("target", event.target.value ? new Date(event.target.value).toISOString() : "")} /></Field>
              : <Field label="Time zone"><input className={FIELD} value={option("timeZone")} onChange={(event) => setOption("timeZone", event.target.value)} placeholder="Europe/London" /></Field>}
          </div>
        ) : null}
        {type === "progress" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Style">
              <select className={FIELD} value={option("style") || "bar"} onChange={(event) => setOption("style", event.target.value === "bar" ? "" : event.target.value)}>
                <option value="bar">Bar</option>
                <option value="gauge">Gauge</option>
              </select>
            </Field>
            <Field label="Max"><input className={FIELD} inputMode="decimal" value={option("max")} onChange={(event) => setOption("max", event.target.value === "" ? "" : Number(event.target.value))} /></Field>
          </div>
        ) : null}
        {type === "custom" ? (
          <>
            <Field label="Widget" hint="From your library, or HTML for this widget alone.">
              <select className={FIELD} value={customType ?? ""} onChange={(event) => setCustomType(event.target.value || null)}>
                <option value="">This widget's own HTML</option>
                {library.map((each) => <option key={each.id} value={each.id}>{each.name}</option>)}
              </select>
            </Field>
            {!customType ? <Field label="HTML" hint="Runs sandboxed with no network. Read window.bbWidget, listen for the bbwidget event."><textarea className={cn(AREA, "min-h-48")} value={html} onChange={(event) => setHtml(event.target.value)} spellCheck={false} /></Field> : null}
          </>
        ) : null}

        <details className="rounded-md border border-border/70 px-2 py-1.5">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Options (JSON)</summary>
          <p className="mt-1 text-xs text-muted-foreground">{info.options}</p>
          <textarea aria-label="Options JSON" className={cn(AREA, "mt-1.5")} value={optionsText} onChange={(event) => setOptionsText(event.target.value)} spellCheck={false} />
        </details>

        {info.usesData || type === "custom" ? (
          <section className="flex flex-col gap-2 border-t border-border pt-3" aria-label="Data source">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data</h3>
            <p className="text-xs text-muted-foreground">{info.data}</p>
            <Field label="Source">
              <select className={FIELD} value={source.kind} onChange={(event) => {
                const kind = event.target.value as Source["kind"];
                setSource(kind === "url" ? { kind, url: "", format: "auto", intervalSec: 300 } : kind === "script" ? { kind, command: "", intervalSec: 900 } : kind === "static" ? { kind, data: null } : { kind });
              }}>
                <option value="static">Static data</option>
                <option value="url">URL (JSON or RSS)</option>
                <option value="script">Script on this computer</option>
                <option value="push">Pushed by an agent</option>
                <option value="none">None</option>
              </select>
            </Field>
            {source.kind === "static" ? <Field label="Data (JSON)"><textarea aria-label="Static data JSON" className={cn(AREA, "min-h-36")} value={dataText} onChange={(event) => setDataText(event.target.value)} spellCheck={false} /></Field> : null}
            {source.kind === "url" ? (
              <>
                <Field label="URL" hint="Fetched by Studio's server: http(s) only, 2 MB, 15 s."><input className={FIELD} value={source.url ?? ""} onChange={(event) => setSource({ ...source, url: event.target.value })} placeholder="https://" /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Format">
                    <select className={FIELD} value={source.format ?? "auto"} onChange={(event) => setSource({ ...source, format: event.target.value as "auto" })}>
                      <option value="auto">Automatic</option>
                      <option value="json">JSON</option>
                      <option value="rss">RSS or Atom</option>
                    </select>
                  </Field>
                  <Field label="Every (seconds)" hint="At least 60, while open."><input className={FIELD} type="number" min={LIMITS.urlMinIntervalSec} value={source.intervalSec ?? 300} onChange={(event) => setSource({ ...source, intervalSec: Math.max(LIMITS.urlMinIntervalSec, Number(event.target.value) || LIMITS.urlMinIntervalSec) })} /></Field>
                </div>
              </>
            ) : null}
            {source.kind === "script" ? (
              <>
                <Field label="Command" hint="Runs with your shell on the BB host. It must print JSON (or text). 30 s and 1 MB at most."><textarea aria-label="Command" className={cn(AREA, "min-h-16")} value={source.command ?? ""} onChange={(event) => setSource({ ...source, command: event.target.value })} spellCheck={false} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Folder"><input className={FIELD} value={source.cwd ?? ""} onChange={(event) => setSource({ ...source, cwd: event.target.value || undefined })} placeholder="Home" /></Field>
                  <Field label="Every (seconds)" hint="At least 300, while open."><input className={FIELD} type="number" min={LIMITS.scriptMinIntervalSec} value={source.intervalSec ?? 900} onChange={(event) => setSource({ ...source, intervalSec: Math.max(LIMITS.scriptMinIntervalSec, Number(event.target.value) || LIMITS.scriptMinIntervalSec) })} /></Field>
                </div>
                {scriptChanged
                  ? <p className="text-xs text-muted-foreground">Save first. The changed command runs only after you approve it.</p>
                  : widget.script?.approved
                    ? <ApprovedState onRevoke={onRevoke} />
                    : widget.script ? <ApprovalCard command={widget.source.command ?? ""} onReview={onReview} /> : null}
              </>
            ) : null}
            {source.kind === "push" ? <p className="text-xs text-muted-foreground">Agents send data with <code>widget_set_data</code>; a script can run <code>bb studio dashboards set-data &lt;dashboard&gt; {widget.id} '&lt;json&gt;'</code>.</p> : null}
            {source.kind === "url" || source.kind === "script" || source.kind === "push" ? (
              <Field label="Select" hint="A path into the result, e.g. data.items or rows[0].value."><input className={FIELD} value={source.select ?? ""} onChange={(event) => setSource({ ...source, select: event.target.value || undefined })} /></Field>
            ) : null}
          </section>
        ) : null}
        {error ? <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
      <footer className="flex justify-end gap-2 border-t border-border px-3 py-2">
        <button type="button" className={OUTLINE_BUTTON} onClick={onClose}>Cancel</button>
        <button type="button" className={PRIMARY_BUTTON} disabled={saving} onClick={() => void save()}>Save</button>
      </footer>
    </aside>
  );
}

/** An approved script, quietly: it runs, and Revoke stops it. */
export function ApprovedState({ onRevoke }: { onRevoke(): void }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground" data-script-approved>
      <Icon name="CircleCheck" className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      <span className="flex-1">Approved. Any change needs a new approval.</span>
      <button type="button" className={cn(GHOST_BUTTON, "h-7 px-2 text-xs")} onClick={onRevoke}>Revoke</button>
    </div>
  );
}

/** A script waiting for the user: the start of its command, and Review, which opens the approval dialog. */
export function ApprovalCard({ command, onReview, compact = false }: { command: string; onReview(): void; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-2 text-xs", compact ? "h-full justify-center p-3" : "rounded-md border border-border bg-muted/40 p-2.5")} role="group" aria-label="Script approval">
      <div className="flex items-center gap-1.5 font-medium text-foreground"><Icon name="Lock" className="size-3.5 text-amber-600 dark:text-amber-400" /> Waiting for your approval</div>
      <code className="line-clamp-2 break-all rounded bg-muted/70 px-1.5 py-1 font-mono text-[11px] leading-snug text-muted-foreground">{command}</code>
      <button type="button" className={cn(OUTLINE_BUTTON, "h-7 self-start px-2.5 text-xs")} onClick={onReview}>Review command…</button>
    </div>
  );
}
