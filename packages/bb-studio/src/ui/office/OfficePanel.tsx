// The office panel: Home, Inbox, bot desks, and Space settings, all for the
// Space chosen in the sidebar's switcher.
import { DANGER_BUTTON, GHOST_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON, PageColumn, PILL } from "@bb-studio/kit/app";
import { useEffect, useId, useState, type FormEvent } from "react";
import { BotDesk } from "./BotDesk";
import { InboxRow } from "./InboxRow";
import { useCall, useLive, useSpaces, useSpaceTree, useTeam, setCurrentSpaceId, type InboxEvent, type Space, type TeamBot } from "./model";
import { OfficeHome } from "./OfficeHome";
import { openOffice, parseOfficeRoute } from "./routes";
import { SpaceMark } from "./SpaceSwitcher";
import { cn } from "./styles";
import { SPACE_COLORS, type OfficeOutput } from "../../office/contract";
import { EXTERNAL_PROVIDERS, useExternalHealth } from "./external";

export function OfficePanel({ subPath }: { subPath: string }) {
  const { current, spaces, loading, error } = useSpaces();
  const route = parseOfficeRoute(subPath);
  if (route.view === "new-space") return <NewSpacePage />;
  if (route.view === "new-bot" && current) return <NewBotPage space={current} />;
  if (route.view === "inbox" && route.scope === "all") return <InboxPage scope="all" space={current} spaces={spaces} />;
  if (!current) {
    return <PageColumn>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : loading ? null : <p className="text-sm text-muted-foreground">No spaces yet.</p>}</PageColumn>;
  }
  switch (route.view) {
    case "inbox": return <InboxPage scope="space" space={current} spaces={spaces} />;
    case "bot": return <div className="@container/page h-full"><BotDesk key={route.botId} space={current} botId={route.botId} tab={route.tab} /></div>;
    case "settings": return <SettingsPage space={current} />;
    default: return <OfficeHome space={current} />;
  }
}

function InboxPage({ scope, space, spaces }: { scope: "space" | "all"; space: Space | null; spaces: Space[] }) {
  const [filter, setFilter] = useState<string>("all");
  const target = scope === "all" ? "all" : space?.id ?? null;
  const inbox = useLive<{ events: InboxEvent[] }>("inbox_list", { spaceId: target }, { enabled: target !== null, pollMs: 30_000 });
  // Faces for every Space shown; the All view needs bots from all of them.
  const teams = useLive<{ bots: (TeamBot & { spaceId?: string })[] }>("team_list", { spaceId: target }, { enabled: target !== null });
  const botById = new Map((teams.data?.bots ?? []).map((bot) => [bot.id, bot]));
  const spaceById = new Map(spaces.map((entry) => [entry.id, entry]));
  const events = (inbox.data?.events ?? []).filter((event) => filter === "all" || event.spaceId === filter);
  const requests = events.filter((event) => event.type === "request");
  const rest = events.filter((event) => event.type !== "request");

  return (
    <PageColumn className="max-w-3xl">
      <h1 className="text-2xl font-semibold">{scope === "all" ? "Inbox · All spaces" : "Inbox"}</h1>
      {scope === "all"
        ? <div role="group" aria-label="Filter by space" className="mt-4 flex flex-wrap gap-1">
            <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")} className={PILL}>All</button>
            {spaces.map((entry) => (
              <button key={entry.id} type="button" aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)} className={`${PILL} flex items-center gap-1.5`}>
                <SpaceMark space={entry} size="sm" />{entry.name}
              </button>
            ))}
          </div>
        : null}
      {inbox.error && !inbox.data ? <p role="alert" className="mt-4 text-sm text-destructive">{inbox.error}</p> : null}
      <section aria-label="Needs you" className="mt-8">
        <h2 className="mb-1 text-sm font-medium text-muted-foreground">Needs you</h2>
        {requests.length
          ? <ul>{requests.map((event) => <InboxRow key={event.key} event={event} bot={event.botId ? botById.get(event.botId) : undefined} space={scope === "all" ? spaceById.get(event.spaceId) : undefined} onChanged={inbox.refresh} />)}</ul>
          : inbox.data ? <p className="py-2 text-sm text-muted-foreground">Nothing is waiting on you.</p> : null}
      </section>
      <section aria-label="Reports and comments" className="mt-8">
        <h2 className="mb-1 text-sm font-medium text-muted-foreground">Reports and comments</h2>
        {rest.length
          ? <ul>{rest.map((event) => <InboxRow key={event.key} event={event} bot={event.botId ? botById.get(event.botId) : undefined} space={scope === "all" ? spaceById.get(event.spaceId) : undefined} onChanged={inbox.refresh} />)}</ul>
          : inbox.data ? <p className="py-2 text-sm text-muted-foreground">You're caught up.</p> : null}
      </section>
    </PageColumn>
  );
}

function NewSpacePage() {
  const call = useCall();
  const nameId = useId();
  const iconId = useId();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError(null);
    try {
      const { space } = await call("space_create", { name: name.trim(), ...(icon.trim() ? { icon: icon.trim() } : {}) }) as OfficeOutput<"space_create">;
      setCurrentSpaceId(space.id);
      openOffice("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return (
    <PageColumn className="max-w-md">
      <h1 className="text-2xl font-semibold">New space</h1>
      <p className="mt-2 text-sm text-muted-foreground">A space is its own office: its own folders, team, conversations and inbox.</p>
      <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
        <div className="flex gap-3">
          <div className="w-16">
            <label htmlFor={iconId} className="mb-1.5 block text-xs font-medium text-muted-foreground">Icon</label>
            <input id={iconId} value={icon} maxLength={4} onChange={(change) => setIcon(change.target.value)} placeholder="🏢" className="h-9 w-full rounded-md border border-border bg-background px-2 text-center" />
          </div>
          <div className="flex-1">
            <label htmlFor={nameId} className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
            <input id={nameId} autoFocus required value={name} maxLength={100} onChange={(change) => setName(change.target.value)} placeholder="Work" className="h-9 w-full rounded-md border border-border bg-background px-2" />
          </div>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !name.trim()} className={PRIMARY_BUTTON}>Create space</button>
          <button type="button" onClick={() => history.back()} className={GHOST_BUTTON}>Cancel</button>
        </div>
      </form>
    </PageColumn>
  );
}

const TRUST_OPTIONS = [
  { id: "ask", label: "Ask first", detail: "Bots ask in your Inbox before changing anything outside their own files." },
  { id: "act", label: "Act and report", detail: "Bots act on their own and tell you what they did." },
] as const;

function SettingsPage({ space }: { space: Space }) {
  const call = useCall();
  const settings = useLive<OfficeOutput<"space_settings_get">>("space_settings_get", { spaceId: space.id }, { pollMs: 0 });
  const tree = useSpaceTree(space.id);
  const { bots } = useTeam(space.id);
  const [name, setName] = useState(space.name);
  const [icon, setIcon] = useState(space.icon ?? "");
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setName(space.name); setIcon(space.icon ?? ""); }, [space.id, space.name, space.icon]);

  const run = async (method: string, input: unknown, after?: () => void) => {
    setError(null);
    try { await call(method, input); after?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const trust = settings.data?.settings.defaultTrust ?? "ask";
  const folders = (tree.data?.folders ?? []).filter((folder) => !folder.archived);

  return (
    <PageColumn className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{space.name} settings</h1>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium">Space</h2>
        <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void run("space_update", { spaceId: space.id, name: name.trim(), icon: icon.trim() || null }); }}>
          <label className="w-16 text-xs text-muted-foreground">Icon<input value={icon} maxLength={4} placeholder={space.name.slice(0, 1).toUpperCase()} onChange={(change) => setIcon(change.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-border bg-background px-2 text-center text-sm text-foreground" /></label>
          <label className="flex-1 text-xs text-muted-foreground">Name<input value={name} maxLength={100} onChange={(change) => setName(change.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground" /></label>
          <button type="submit" disabled={!name.trim() || (name === space.name && icon === (space.icon ?? ""))} className={OUTLINE_BUTTON}>Save</button>
        </form>
        {/* Like an Arc Space's color: it tints the sidebar and marks the Space in the footer. */}
        <div role="radiogroup" aria-label="Color" className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-muted-foreground">Color</span>
          {SPACE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={space.color === color}
              aria-label={color}
              onClick={() => void run("space_update", { spaceId: space.id, color })}
              style={{ backgroundColor: color }}
              className={cn("size-6 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", space.color === color && "ring-2 ring-foreground ring-offset-2 ring-offset-background")}
            />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-1 text-sm font-medium">Folders</h2>
        <p className="mb-3 text-sm text-muted-foreground">Each folder is a BB project. A folder can have a repo; one without keeps its files in ~/Spaces.</p>
        <ul className="divide-y divide-border rounded-md border border-border">
          {folders.map((folder) => (
            <li key={folder.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{folder.name}{folder.isDefault ? <span className="ml-2 text-xs text-muted-foreground">Default</span> : null}</span>
              {folder.path ? <span className="max-w-56 truncate font-mono text-xs text-muted-foreground" title={folder.path}>{folder.path}</span> : null}
              {!folder.isDefault
                ? <button type="button" onClick={() => void run("folder_archive", { folderId: folder.id }, tree.refresh)} className={GHOST_BUTTON}>Archive</button>
                : null}
            </li>
          ))}
        </ul>
        <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (folderName.trim()) void run("folder_create", { spaceId: space.id, name: folderName.trim() }, () => { setFolderName(""); tree.refresh(); }); }}>
          <input aria-label="New folder name" value={folderName} onChange={(change) => setFolderName(change.target.value)} placeholder="New folder" className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm" />
          <button type="submit" disabled={!folderName.trim()} className={OUTLINE_BUTTON}>Add folder</button>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="mb-1 text-sm font-medium">Trust</h2>
        <p className="mb-3 text-sm text-muted-foreground">How much new bots in this space can do without asking. Each bot can override it on its profile.</p>
        <div role="radiogroup" aria-label="Default trust" className="space-y-1">
          {TRUST_OPTIONS.map((option) => (
            <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-state-hover">
              <input type="radio" name="trust" checked={trust === option.id} onChange={() => void run("space_settings_set", { spaceId: space.id, settings: { defaultTrust: option.id } }, settings.refresh)} className="mt-1" />
              <span><span className="block text-sm font-medium">{option.label}</span><span className="block text-sm text-muted-foreground">{option.detail}</span></span>
            </label>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-1 text-sm font-medium">Team</h2>
        <p className="text-sm text-muted-foreground">{bots.length ? `${bots.length} ${bots.length === 1 ? "bot works" : "bots work"} in this space.` : "No bots work in this space yet."}</p>
      </section>

      <LegacyDataSection />

      {!space.isDefault
        ? <section className="mt-10 border-t border-border pt-6">
            <h2 className="mb-1 text-sm font-medium">Delete space</h2>
            <p className="mb-3 text-sm text-muted-foreground">Move or archive its folders and bots first. A space with work in it can't be deleted.</p>
            <button
              type="button"
              className={DANGER_BUTTON}
              onClick={() => { if (confirm(`Delete ${space.name}?`)) void run("space_delete", { spaceId: space.id }, () => openOffice("")); }}
            >
              Delete {space.name}
            </button>
          </section>
        : null}
    </PageColumn>
  );
}

/** Hire a bot into this Space: who it is, what it's for, how much it may do. */
function NewBotPage({ space }: { space: Space }) {
  const call = useCall();
  const ids = { name: useId(), avatar: useId(), role: useId(), mission: useId() };
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [role, setRole] = useState("");
  const [mission, setMission] = useState("");
  const [trust, setTrust] = useState<"ask" | "act">("ask");
  const [runtime, setRuntime] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Outside agents (Hermes, OpenClaw) appear once their provider is enabled.
  const health = useExternalHealth(Object.keys(EXTERNAL_PROVIDERS));
  const agents = Object.entries(EXTERNAL_PROVIDERS).filter(([id]) => health[id] && health[id]!.status !== "disabled" && health[id]!.status !== "unavailable");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !mission.trim()) return;
    setBusy(true); setError(null);
    try {
      const result = await call("teams_create", {
        name: name.trim(),
        mission: mission.trim(),
        description: role.trim(),
        trust,
        // Outside agents only take reasoning level "none".
        ...(runtime ? { providerId: runtime, reasoningLevel: "none" } : {}),
        ...(avatar.trim() ? { avatar: avatar.trim() } : {}),
        ...(space.defaultProjectId ? { projectId: space.defaultProjectId } : {}),
      }) as { id?: string; bot?: { id: string } };
      const id = result.bot?.id ?? result.id;
      openOffice(id ? `team/${encodeURIComponent(id)}` : "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const field = "h-9 w-full rounded-md border border-border bg-background px-2 text-sm";
  return (
    <PageColumn className="max-w-xl">
      <h1 className="text-2xl font-semibold">Add a bot to {space.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">A bot works on its own, on the tasks you give it and on its mission, and reports back to your Inbox.</p>
      <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-5">
        <div className="flex gap-3">
          <div className="w-16">
            <label htmlFor={ids.avatar} className="mb-1.5 block text-xs font-medium text-muted-foreground">Face</label>
            <input id={ids.avatar} value={avatar} maxLength={16} onChange={(change) => setAvatar(change.target.value)} placeholder="🤖" className={`${field} text-center`} />
          </div>
          <div className="flex-1">
            <label htmlFor={ids.name} className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
            <input id={ids.name} autoFocus required value={name} maxLength={80} onChange={(change) => setName(change.target.value)} placeholder="Researcher" className={field} />
          </div>
        </div>
        <div>
          <label htmlFor={ids.role} className="mb-1.5 block text-xs font-medium text-muted-foreground">Role</label>
          <input id={ids.role} value={role} maxLength={500} onChange={(change) => setRole(change.target.value)} placeholder="Finds and checks facts for my projects" className={field} />
        </div>
        <div>
          <label htmlFor={ids.mission} className="mb-1.5 block text-xs font-medium text-muted-foreground">Mission</label>
          <textarea id={ids.mission} required value={mission} onChange={(change) => setMission(change.target.value)} placeholder="What this bot is responsible for, and how it should work." className="min-h-32 w-full resize-y rounded-md border border-border bg-background p-2 text-sm" />
        </div>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Trust</legend>
          {TRUST_OPTIONS.map((option) => (
            <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-state-hover">
              <input type="radio" name="bot-trust" checked={trust === option.id} onChange={() => setTrust(option.id)} className="mt-1" />
              <span><span className="block text-sm font-medium">{option.label}</span><span className="block text-sm text-muted-foreground">{option.detail}</span></span>
            </label>
          ))}
        </fieldset>
        {agents.length
          ? <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Runs on</legend>
              <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-state-hover">
                <input type="radio" name="bot-runtime" checked={runtime === ""} onChange={() => setRuntime("")} />
                <span className="text-sm">BB, with {space.name}'s default model</span>
              </label>
              {agents.map(([id, label]) => (
                <label key={id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-state-hover">
                  <input type="radio" name="bot-runtime" checked={runtime === id} onChange={() => setRuntime(id)} />
                  <span className="text-sm">{label}, an outside agent{health[id]?.online ? "" : " (offline now)"}</span>
                </label>
              ))}
            </fieldset>
          : null}
        <p className="text-xs text-muted-foreground">{runtime ? `${EXTERNAL_PROVIDERS[runtime]} keeps its own memory and tools. Trust covers what it does through Studio.` : `It uses ${space.name}'s default model. You can change that on its profile.`}</p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !name.trim() || !mission.trim()} className={PRIMARY_BUTTON}>Add bot</button>
          <button type="button" onClick={() => history.back()} className={GHOST_BUTTON}>Cancel</button>
        </div>
      </form>
    </PageColumn>
  );
}

interface CleanupEntry { pluginId: string; path: string; status: "ready" | "retained" | "removed"; reason: string; files: number; bytes: number }
interface CleanupResult { dryRun: boolean; archivePath: string | null; entries: CleanupEntry[] }

/**
 * Data left behind by the plugins Studio absorbed. Check first (nothing
 * changes), then back up and remove: the archive is written and verified
 * before anything is deleted.
 */
function LegacyDataSection() {
  const call = useCall();
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (dryRun: boolean) => {
    setBusy(true); setError(null);
    try { setResult(await call("modules_cleanup_legacy", { dryRun }) as CleanupResult); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const size = (bytes: number) => new Intl.NumberFormat(undefined, { style: "unit", unit: bytes >= 1e6 ? "megabyte" : "kilobyte", maximumFractionDigits: 1 }).format(bytes >= 1e6 ? bytes / 1e6 : bytes / 1e3);
  const ready = result?.entries.filter((entry) => entry.status === "ready") ?? [];
  return (
    <section className="mt-10">
      <h2 className="mb-1 text-sm font-medium">Old plugin data</h2>
      <p className="mb-3 text-sm text-muted-foreground">Studio copied the data of the plugins it replaced. The old copies can be backed up to one archive and removed. This applies to all spaces.</p>
      {error ? <p role="alert" className="mb-2 text-sm text-destructive">{error}</p> : null}
      {result
        ? <>
            {result.archivePath && !result.dryRun
              ? <p className="mb-2 text-sm">Backed up to <span className="font-mono text-xs">{result.archivePath}</span></p>
              : null}
            <ul className="mb-3 divide-y divide-border rounded-md border border-border">
              {result.entries.map((entry) => (
                <li key={entry.path} className="flex items-baseline gap-3 px-3 py-2 text-sm">
                  <span className="w-28 shrink-0 font-medium">{entry.pluginId}</span>
                  <span className="min-w-0 flex-1 text-muted-foreground">{entry.reason}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{entry.files} files · {size(entry.bytes)}</span>
                  <span className={`shrink-0 text-xs ${entry.status === "ready" ? "text-foreground" : entry.status === "removed" ? "text-success-foreground" : "text-muted-foreground"}`}>
                    {entry.status === "ready" ? "Can remove" : entry.status === "removed" ? "Removed" : "Kept"}
                  </span>
                </li>
              ))}
              {!result.entries.length ? <li className="px-3 py-2 text-sm text-muted-foreground">No old plugin data found.</li> : null}
            </ul>
          </>
        : null}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void run(true)} className={OUTLINE_BUTTON}>{result ? "Check again" : "Check"}</button>
        {result?.dryRun && ready.length
          ? <button
              type="button"
              disabled={busy}
              onClick={() => { if (confirm(`Back up and remove old data for ${ready.map((entry) => entry.pluginId).join(", ")}?`)) void run(false); }}
              className={DANGER_BUTTON}
            >
              Back up and remove
            </button>
          : null}
      </div>
    </section>
  );
}
