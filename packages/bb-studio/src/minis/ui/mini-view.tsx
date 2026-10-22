// A mini app full size: the app, its data, its source and its settings.
// The Studio page (/plugins/studio/studio/minis/<id>) and the thread's
// Studio tab both show it; page blocks and chat cards show MiniEmbed.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BarTitle, ICON_BUTTON, ItemHeader, PRIMARY_BUTTON, cn, openAppPath } from "../../kit/app/index";
import { errorMessage, relativeTime } from "../../kit/format";
import { Icon } from "../../kit/ui/icon";
import type { MiniView as Mini, rpcContract } from "../contract";
import { miniHref, REALTIME_CHANNEL, type MiniRecord } from "../shared";
import { ApprovalBanner, describeCapability } from "./approval";
import { MiniFrame } from "./mini-frame";
import { useMini, type MiniRpc } from "./use-mini";
import { useRealtime } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";

type Section = "app" | "data" | "source" | "settings";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "app", label: "App" },
  { id: "data", label: "Data" },
  { id: "source", label: "Source" },
  { id: "settings", label: "Settings" },
];

const displayName = (mini: Pick<Mini, "name"> | null | undefined) => mini?.name.trim() || "Untitled mini app";

/** The app with its access banner and, when it breaks, why. */
export function MiniApp({ mini, rpc, threadId, fit = false }: { mini: Mini; rpc: MiniRpc; threadId: string | null; fit?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  if (!mini.versionId) return <p className="p-4 text-sm text-muted-foreground">This mini app has no source yet.</p>;
  return (
    <div className={cn("flex min-h-0 flex-col", fit ? "" : "h-full")}>
      <ApprovalBanner mini={mini} rpc={rpc} />
      {error ? (
        <div className="border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive-text" data-mini-error-strip>
          <span className="font-medium">The app hit an error.</span> <span className="line-clamp-2 whitespace-pre-wrap">{error.split("\n")[0]}</span>
        </div>
      ) : null}
      <div className={cn("min-h-0", fit ? "" : "flex-1")}>
        <MiniFrame
          key={`${mini.versionId}:${mini.granted.join(",")}`}
          miniId={mini.id}
          versionId={mini.versionId}
          name={displayName(mini)}
          threadId={threadId}
          fit={fit}
          minHeight={mini.manifest?.size.minHeight ?? 120}
          maxHeight={mini.manifest?.size.maxHeight ?? 720}
          onError={setError}
        />
      </div>
    </div>
  );
}

/** Tabs across the top: App, Data, Source, Settings. */
function SectionBar({ section, onSection, mini, trailing }: { section: Section; onSection(section: Section): void; mini: Mini; trailing?: ReactNode }) {
  const records = mini.collections.reduce((sum, each) => sum + each.count, 0);
  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-2" role="tablist">
      {SECTIONS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={section === id}
          onClick={() => onSection(id)}
          className={cn("rounded-md px-2.5 py-1 text-xs font-medium", section === id ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover hover:text-foreground")}
        >
          {label}
          {id === "data" && records ? <span className="ml-1 text-muted-foreground">{records.toLocaleString("en-US")}</span> : null}
          {id === "settings" && mini.pending.length ? <span className="ml-1 inline-block size-1.5 rounded-full bg-warning align-middle" /> : null}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-1">{trailing}</div>
    </div>
  );
}

export function MiniBody({ miniId, threadId, header }: { miniId: string; threadId: string | null; header(mini: Mini | null | undefined, rename: (name: string) => void): ReactNode }) {
  const { mini, rpc } = useMini(miniId);
  const [section, setSection] = useState<Section>("app");
  const rename = useCallback((name: string) => {
    rpc.call("minis.rename", { id: miniId, name }).catch((error) => toast.error(errorMessage(error)));
  }, [rpc, miniId]);
  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground" data-mini-view={miniId}>
      {header(mini, rename)}
      {mini === null ? <p className="p-4 text-sm text-muted-foreground">This mini app was deleted.</p> : null}
      {mini ? (
        <>
          <SectionBar section={section} onSection={setSection} mini={mini} />
          <div className="min-h-0 flex-1 overflow-hidden">
            {section === "app" ? <MiniApp mini={mini} rpc={rpc} threadId={threadId} />
              : section === "data" ? <DataSection mini={mini} rpc={rpc} />
              : section === "source" ? <SourceSection mini={mini} rpc={rpc} />
              : <SettingsSection mini={mini} rpc={rpc} />}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The Studio page: /plugins/studio/studio/minis/<id>. */
export function MiniPage({ miniId, backLabel, onBack }: { miniId: string; backLabel: string; onBack(replace?: boolean): void }) {
  return (
    <MiniBody
      miniId={miniId}
      threadId={null}
      header={(mini, rename) => {
        const item = { title: displayName(mini), href: miniHref(miniId) };
        return <ItemHeader thread={item} item={item} backLabel={backLabel} onBack={() => onBack()} leading={<BarTitle key={`${miniId}:${mini?.name ?? ""}`} title={mini?.name ?? ""} label="Mini app name" placeholder="Untitled mini app" disabled={!mini} onRename={rename} />} />;
      }}
    />
  );
}

/** In the thread's Studio tab, beside the conversation. */
export function TabMini({ miniId, threadId, backLabel, onBack }: { miniId: string; threadId: string; backLabel: string; onBack(): void }) {
  return (
    <MiniBody
      miniId={miniId}
      threadId={threadId}
      header={(mini, rename) => (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <button type="button" aria-label={`Back to ${backLabel}`} title={`Back to ${backLabel}`} className={ICON_BUTTON} onClick={onBack}>
            <Icon name="ArrowLeft" className="size-4" />
          </button>
          <div className="max-w-56 min-w-0">
            <BarTitle key={`${miniId}:${mini?.name ?? ""}`} title={mini?.name ?? ""} label="Mini app name" placeholder="Untitled mini app" disabled={!mini} onRename={rename} />
          </div>
          <button type="button" className={cn(ICON_BUTTON, "ml-auto")} title="Open in Studio" aria-label="Open in Studio" onClick={() => openAppPath(miniHref(miniId))}>
            <Icon name="ArrowUpRight" className="size-4" />
          </button>
        </div>
      )}
    />
  );
}

// ---- Data -----------------------------------------------------------------------------

function DataSection({ mini, rpc }: { mini: Mini; rpc: MiniRpc }) {
  const names = useMemo(() => [...new Set([...Object.keys(mini.manifest?.collections ?? {}), ...mini.collections.map((each) => each.name)])].sort(), [mini]);
  const [collection, setCollection] = useState<string | null>(names[0] ?? null);
  const [records, setRecords] = useState<MiniRecord[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; text: string } | null>(null);
  const current = collection && names.includes(collection) ? collection : names[0] ?? null;
  const declared = current ? current in (mini.manifest?.collections ?? {}) : false;

  const load = useCallback(() => {
    if (!current || !declared) return setRecords([]);
    rpc.call("minis.db.find", { id: mini.id, collection: current, query: { order: "-updatedAt", limit: 500 } }).then((result) => setRecords(result.records as MiniRecord[]), (error) => toast.error(errorMessage(error)));
  }, [rpc, mini.id, current, declared]);
  useEffect(load, [load]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as { type?: string; miniId?: string; collection?: string } | null;
    if (event?.type === "records" && event.miniId === mini.id && event.collection === current) load();
  });

  const columns = useMemo(() => {
    const keys = new Map<string, number>();
    for (const record of records ?? []) for (const key of Object.keys(record.data)) keys.set(key, (keys.get(key) ?? 0) + 1);
    return [...keys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key]) => key);
  }, [records]);

  const save = async () => {
    if (!editing || !current) return;
    let data: unknown;
    try {
      data = JSON.parse(editing.text);
    } catch (error) {
      return toast.error(`Not JSON: ${errorMessage(error)}`);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return toast.error("A record is a JSON object.");
    const clientId = "studio-data-panel";
    try {
      if (editing.id) await rpc.call("minis.db.update", { id: mini.id, clientId, collection: current, recordId: editing.id, data: data as Record<string, unknown> });
      else await rpc.call("minis.db.insert", { id: mini.id, clientId, collection: current, data: data as Record<string, unknown> });
      setEditing(null);
      load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const remove = async (record: MiniRecord) => {
    if (!current || !window.confirm("Delete this record?")) return;
    await rpc.call("minis.db.remove", { id: mini.id, clientId: "studio-data-panel", collection: current, recordId: record.id }).catch((error) => toast.error(errorMessage(error)));
    load();
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(records ?? [], null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${displayName(mini)} - ${current}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (!names.length) return <p className="p-4 text-sm text-muted-foreground">No collections. The app declares them under “collections” in mini.json.</p>;
  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-44 shrink-0 flex-col gap-0.5 overflow-auto border-r border-border p-2">
        {names.map((name) => (
          <button key={name} type="button" onClick={() => setCollection(name)} className={cn("flex items-center rounded-md px-2 py-1 text-left text-sm", name === current ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover")}>
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <span className="text-xs text-muted-foreground">{mini.collections.find((each) => each.name === name)?.count ?? 0}</span>
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-sm font-medium">{current}</span>
          {!declared ? <span className="text-xs text-muted-foreground">No longer in mini.json; its records are kept.</span> : null}
          <div className="ml-auto flex gap-1">
            <button type="button" className="rounded-md px-2 py-1 text-xs hover:bg-state-hover" onClick={exportJson} disabled={!records?.length}>Export JSON</button>
            {declared ? <button type="button" className={PRIMARY_BUTTON} onClick={() => setEditing({ id: null, text: "{\n  \n}" })}>Add record</button> : null}
          </div>
        </div>
        {editing ? (
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <textarea className="h-40 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs" value={editing.text} onChange={(event) => setEditing({ ...editing, text: event.target.value })} spellCheck={false} aria-label="Record JSON" />
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md px-3 py-1.5 text-sm hover:bg-state-hover" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className={PRIMARY_BUTTON} onClick={() => void save()}>Save</button>
            </div>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto">
          {records === null ? null : records.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No records yet.</p> : (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-border text-left text-muted-foreground">
                  {columns.map((column) => <th key={column} className="px-3 py-1.5 font-medium">{column}</th>)}
                  <th className="px-3 py-1.5 font-medium">Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-b border-border/60 hover:bg-state-hover/50">
                    {columns.map((column) => <td key={column} className="max-w-56 truncate px-3 py-1.5">{cellText(record.data[column])}</td>)}
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{relativeTime(record.updatedAt)}{record.createdBy === "agent" ? " · agent" : ""}</td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <button type="button" className="rounded px-1.5 py-0.5 hover:bg-state-hover" onClick={() => setEditing({ id: record.id, text: JSON.stringify(record.data, null, 2) })}>Edit</button>
                      <button type="button" className="rounded px-1.5 py-0.5 text-destructive-text hover:bg-state-hover" onClick={() => void remove(record)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const cellText = (value: unknown) => (value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));

// ---- Source ---------------------------------------------------------------------------

function SourceSection({ mini, rpc }: { mini: Mini; rpc: MiniRpc }) {
  const [files, setFiles] = useState<Record<string, string>>(mini.files);
  const [path, setPath] = useState(() => mini.manifest?.entry ?? Object.keys(mini.files)[0] ?? "main.jsx");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A new version from elsewhere (an agent) replaces the files unless they were edited here.
  const [baseVersion, setBaseVersion] = useState(mini.versionId);
  const dirty = JSON.stringify(files) !== JSON.stringify(mini.files) && baseVersion === mini.versionId;
  if (baseVersion !== mini.versionId && JSON.stringify(files) === JSON.stringify(mini.files)) setBaseVersion(mini.versionId);
  useEffect(() => {
    if (!dirty) setFiles(mini.files);
  }, [mini.files]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    try {
      await rpc.call("minis.save", { id: mini.id, files, note: "Edited in Studio" });
      setError(null);
      toast.success("Saved.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const addFile = () => {
    const name = window.prompt("File name, e.g. components/List.jsx");
    if (!name) return;
    if (name in files) return setPath(name);
    setFiles({ ...files, [name]: "" });
    setPath(name);
  };
  const removeFile = (name: string) => {
    if (!window.confirm(`Remove ${name}?`)) return;
    const next = { ...files };
    delete next[name];
    setFiles(next);
    setPath(Object.keys(next)[0] ?? "");
  };

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-48 shrink-0 flex-col gap-0.5 overflow-auto border-r border-border p-2">
        {Object.keys(files).sort().map((name) => (
          <div key={name} className={cn("group flex items-center rounded-md", name === path ? "bg-state-active" : "hover:bg-state-hover")}>
            <button type="button" onClick={() => setPath(name)} className="min-w-0 flex-1 truncate px-2 py-1 text-left font-mono text-xs">{name}</button>
            <button type="button" aria-label={`Remove ${name}`} className="hidden px-1.5 text-xs text-muted-foreground group-hover:block" onClick={() => removeFile(name)}>×</button>
          </div>
        ))}
        <button type="button" className="mt-1 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-state-hover" onClick={addFile}>+ Add file</button>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        {error ? <pre className="max-h-32 overflow-auto border-b border-border bg-destructive/10 px-3 py-2 text-xs whitespace-pre-wrap text-destructive-text">{error}</pre> : null}
        <textarea
          aria-label={`Source of ${path}`}
          className="min-h-0 w-full flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
          spellCheck={false}
          value={files[path] ?? ""}
          onChange={(event) => setFiles({ ...files, [path]: event.target.value })}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
              event.preventDefault();
              void save();
            }
            if (event.key === "Tab") {
              event.preventDefault();
              const target = event.currentTarget;
              const { selectionStart, selectionEnd } = target;
              const next = `${target.value.slice(0, selectionStart)}  ${target.value.slice(selectionEnd)}`;
              setFiles({ ...files, [path]: next });
              requestAnimationFrame(() => target.setSelectionRange(selectionStart + 2, selectionStart + 2));
            }
          }}
        />
        <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span>{dirty ? "Unsaved changes" : `Saved ${relativeTime(mini.updatedAt)}`}</span>
          {dirty ? <button type="button" className="rounded px-2 py-1 hover:bg-state-hover" onClick={() => { setFiles(mini.files); setError(null); }}>Discard</button> : null}
          <button type="button" className={cn(PRIMARY_BUTTON, "ml-auto")} disabled={!dirty || busy} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ---- Settings -------------------------------------------------------------------------

type FetchEntry = z.infer<(typeof rpcContract)["minis.fetchLog"]["output"]>["entries"][number];

function SettingsSection({ mini, rpc }: { mini: Mini; rpc: MiniRpc }) {
  const [log, setLog] = useState<FetchEntry[] | null>(null);
  const [secret, setSecret] = useState({ name: "", header: "Authorization", value: "" });
  useEffect(() => {
    rpc.call("minis.fetchLog", { id: mini.id }).then((result) => setLog(result.entries), () => setLog([]));
  }, [rpc, mini.id, mini.updatedAt]);
  const run = (work: Promise<unknown>, done?: string) => work.then(() => done && toast.success(done), (error) => toast.error(errorMessage(error)));
  const wantedSecrets = (mini.manifest?.capabilities ?? []).filter((cap) => cap.startsWith("secret:")).map((cap) => cap.slice(7));

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4 text-sm">
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Access</h3>
          {!mini.granted.length && !mini.pending.length ? <p className="text-muted-foreground">This app only uses its own data. It can't reach the network or the rest of BB.</p> : null}
          {mini.pending.length ? <div className="overflow-hidden rounded-lg border border-border"><ApprovalBanner mini={mini} rpc={rpc} /></div> : null}
          {mini.granted.map((capability) => (
            <div key={capability} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <Icon name="Check" className="size-3.5 text-success" />
              <span className="min-w-0 flex-1">{describeCapability(capability)}</span>
              <button type="button" className="rounded px-2 py-0.5 text-xs hover:bg-state-hover" onClick={() => run(rpc.call("minis.revoke", { id: mini.id, capabilities: [capability] }), "Access removed.")}>Revoke</button>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Secrets</h3>
          <p className="text-xs text-muted-foreground">Studio adds a secret as a request header when the app asks for it by name. The app and agents never see the value.{wantedSecrets.length ? ` This app asks for: ${wantedSecrets.join(", ")}.` : ""}</p>
          {mini.secrets.map((each) => (
            <div key={each.name} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <span className="font-mono text-xs">{each.name}</span>
              <span className="text-xs text-muted-foreground">→ {each.header} · set {relativeTime(each.updatedAt)}</span>
              <button type="button" className="ml-auto rounded px-2 py-0.5 text-xs hover:bg-state-hover" onClick={() => run(rpc.call("minis.removeSecret", { id: mini.id, name: each.name }))}>Remove</button>
            </div>
          ))}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(rpc.call("minis.setSecret", { id: mini.id, ...secret }), "Secret stored.").then(() => setSecret({ ...secret, value: "" }));
            }}
          >
            <input className="w-32 rounded-md border border-input bg-transparent px-2 py-1 text-xs" placeholder="name" value={secret.name} onChange={(event) => setSecret({ ...secret, name: event.target.value })} aria-label="Secret name" list="mini-wanted-secrets" />
            <datalist id="mini-wanted-secrets">{wantedSecrets.map((name) => <option key={name} value={name} />)}</datalist>
            <input className="w-36 rounded-md border border-input bg-transparent px-2 py-1 text-xs" placeholder="header" value={secret.header} onChange={(event) => setSecret({ ...secret, header: event.target.value })} aria-label="Header" />
            <input className="min-w-40 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs" type="password" placeholder="value, e.g. Bearer …" value={secret.value} onChange={(event) => setSecret({ ...secret, value: event.target.value })} aria-label="Secret value" autoComplete="off" />
            <button type="submit" className={PRIMARY_BUTTON} disabled={!secret.name || !secret.header || !secret.value}>Store</button>
          </form>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Network log</h3>
          {!log?.length ? <p className="text-xs text-muted-foreground">No requests yet.</p> : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-xs">
              {log.map((entry, index) => (
                <li key={index} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="w-12 font-mono">{entry.method}</span>
                  <span className="min-w-0 flex-1 truncate" title={entry.url}>{entry.url}</span>
                  <span className={cn("font-mono", entry.status && entry.status < 400 ? "text-success" : "text-destructive-text")} title={entry.error ?? undefined}>{entry.status ?? "failed"}</span>
                  <span className="w-16 text-right text-muted-foreground">{relativeTime(entry.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Versions</h3>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-xs">
            {mini.versions.map((version) => (
              <li key={version.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">{version.note ?? "Saved"} <span className="text-muted-foreground">· {version.by} · {relativeTime(version.createdAt)}</span></span>
                {version.id === mini.versionId ? <span className="text-muted-foreground">Current</span> : (
                  <button type="button" className="rounded px-2 py-0.5 hover:bg-state-hover" onClick={() => run(rpc.call("minis.restoreVersion", { id: mini.id, versionId: version.id }), "Restored.")}>Restore</button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Copies</h3>
          <p className="text-xs text-muted-foreground">Every place this app shows, in pages, chats and here, shares its data. A copy has its own.</p>
          <div className="flex gap-2">
            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-state-hover" onClick={() => run(rpc.call("minis.duplicate", { id: mini.id, withData: false }).then((result) => openAppPath(miniHref(result.mini.id))))}>Duplicate without data</button>
            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-state-hover" onClick={() => run(rpc.call("minis.duplicate", { id: mini.id, withData: true }).then((result) => openAppPath(miniHref(result.mini.id))))}>Duplicate with data</button>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---- Embedded: dashboard tiles, page blocks and chat cards --------------------------------------

/** The app filling a box, as a dashboard tile: no chrome, the access banner when it waits. */
export function MiniTile({ miniId }: { miniId: string }) {
  const { mini, rpc } = useMini(miniId);
  if (mini === null) return <p className="p-3 text-xs text-muted-foreground">This mini app was deleted.</p>;
  if (!mini) return null;
  return <MiniApp mini={mini} rpc={rpc} threadId={null} />;
}

/** The app in a page block or a chat card, fitted to its content, with a strip to open it. */
export function MiniEmbed({ miniId, threadId, onOpen, chrome = true }: { miniId: string; threadId: string | null; onOpen?(): void; chrome?: boolean }) {
  const { mini, rpc } = useMini(miniId);
  if (mini === null) return <div className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm text-muted-foreground"><Icon name="AppWindow" className="size-4" /> This mini app was deleted.</div>;
  if (!mini) return <div className="h-24 animate-pulse rounded-lg border border-border/70 bg-muted/40 motion-reduce:animate-none" />;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background" data-mini-embed={miniId}>
      {chrome ? (
        <div className="flex h-8 items-center gap-1.5 border-b border-border bg-card/50 px-2.5 text-xs text-muted-foreground">
          <Icon name="AppWindow" className="size-3.5" />
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{displayName(mini)}</span>
          <button type="button" className="rounded px-1.5 py-0.5 hover:bg-state-hover hover:text-foreground" onClick={onOpen ?? (() => openAppPath(miniHref(miniId)))}>Open</button>
        </div>
      ) : null}
      <MiniApp mini={mini} rpc={rpc} threadId={threadId} fit />
    </div>
  );
}
