import { EmptyState, PILL, SECTION_TITLE } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { RevisionList, type Revision } from "./revision-list";
import { MarkdownEditor } from "./markdown-editor";
import { isForkConversation } from "./send-mode";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useBbNavigate, useRpc, experimental_Icon as Icon, experimental_ProviderModelPicker as ProviderModelPicker, experimental_PermissionModePicker as PermissionModePicker } from "@get-bb/plugin-sdk/app";
import type { Bot, Job, ProfileInput, rpcContract } from "./contract";
import { Button, Input } from "@bb-studio/kit/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@bb-studio/kit/ui";
import { readConfigDraft, writeConfigDraft, profileDraft, documentDraft } from "./config-draft";
import { Modal } from "./controls";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb-studio/kit/ui";
import { externalAgent, externalPermissionHint, externalToolsNote, permissionModeFor, reasoningLevelFor } from "./external-agents";
import { ExternalAgentBadge, useExternalHealth } from "./external-health";
import "./styles.css";

export const message = (e: unknown) =>
  errorMessage(e);
const defaults: ProfileInput = {
  name: "",
  description: "",
  avatar: "🤖",
  providerId: "codex",
  model: "",
  fallbackProviderId: "",
  fallbackModel: "",
  fallbackReasoningLevel: "medium",
  reasoningLevel: "medium",
  permissionMode: "auto",
  intervalMinutes: 0,
};
export function FormRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  const labelClass = "pt-[7px] text-xs font-medium text-muted-foreground max-md:pt-0";
  return (
    <div data-form-row className="grid grid-cols-[140px_minmax(0,1fr)] items-start gap-4 p-3 max-md:grid-cols-1 max-md:gap-2">
      {htmlFor ? <label htmlFor={htmlFor} className={labelClass}>{label}</label> : <div className={labelClass}>{label}</div>}
      <div className="min-w-0 [&>:is(input,textarea,select):not(.w-20)]:w-full">
        {children}
        {hint && <p className="mt-1.5 text-xs leading-[1.45] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** A titled, bordered group of form rows, like BB's settings. */
export function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className={`${SECTION_TITLE}${tone === "danger" ? " text-destructive" : ""}`}>{title}</h2>
      <div className="min-w-0 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">{children}</div>
    </section>
  );
}

/** A quiet line inside a list that has nothing to show. */
export function EmptyNote({
  title,
  description,
  role,
}: {
  title: string;
  description?: string;
  role?: "status";
}) {
  return (
    <div role={role} className="flex flex-col items-start gap-1 px-3 py-3.5 text-[13px] leading-[1.45] text-muted-foreground">
      <p>{title}</p>
      {description && <p>{description}</p>}
    </div>
  );
}

/** Save status and buttons, pinned to the bottom of the scrolling page. */
export function ActionBar({
  status,
  secondary,
  primary,
}: {
  status?: ReactNode;
  secondary?: ReactNode;
  primary?: ReactNode;
}) {
  if (!status && !secondary && !primary) return null;
  return (
    <div className="sticky bottom-0 z-[3] mt-auto flex min-h-11 items-center justify-between gap-3 border-t border-border/75 bg-background/95 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {status && <span role="status" className="text-xs text-muted-foreground">{status}</span>}
        {secondary && <div className="flex min-w-0 items-center gap-1.5">{secondary}</div>}
      </div>
      {primary && <div className="flex min-w-0 items-center justify-end gap-1.5">{primary}</div>}
    </div>
  );
}
export function ErrorMessage({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

export function ProfileForm({
  bot,
  onSaved,
  onArchive,
}: {
  bot: Bot;
  onSaved: (bot: Bot) => void | Promise<void>;
  onArchive?: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const draftKey = `bb:bots:profile:${bot.id}`;
  const [restored] = useState(() => readConfigDraft(draftKey, profileDraft));
  const [draft, setDraft] = useState<ProfileInput>(
    restored?.draft ?? bot,
  );
  const [version, setVersion] = useState<number | null>(
    restored?.version ?? bot.updatedAt,
  );
  const submitting = useRef(false);
  const id = useId();
  const [baseline, setBaseline] = useState<ProfileInput>(
    restored?.baseline ?? bot,
  );
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The model default the picker filled in for a bot saved without one.
  const [resolved, setResolved] = useState<Partial<ProfileInput> | null>(null);
  const compared = resolved && !baseline.model ? { ...baseline, ...resolved } : baseline;
  const dirty = (Object.keys(defaults) as (keyof ProfileInput)[]).some(
    (key) => draft[key] !== compared[key],
  );
  const changedProfile = (Object.keys(defaults) as (keyof ProfileInput)[]).some(
    (key) => bot[key] !== baseline[key],
  );
  const conflict = changedProfile && dirty;
  useEffect(() => {
    if (!changedProfile) setVersion(bot.updatedAt);
  }, [bot, changedProfile]);
  useEffect(() => {
    if (!dirty && !submitting.current) {
      setDraft(resolved && !bot.model ? { ...bot, ...resolved } : bot);
      setBaseline(bot);
      setVersion(bot.updatedAt);
    }
  }, [bot, dirty, resolved]);
  useEffect(() => {
    try {
      writeConfigDraft(
        draftKey,
        dirty ? { draft, baseline, version } : null,
      );
    } catch {
      setError(
        "Draft could not be saved on this device. Save your changes before leaving.",
      );
    }
  }, [draftKey, draft, baseline, version, dirty]);
  const set = <K extends keyof ProfileInput>(
    key: K,
    value: ProfileInput[K],
  ) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current || pending || conflict) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await rpc.call("update", {
        ...draft,
        id: bot.id,
        ...(version === null ? {} : { expectedUpdatedAt: version }),
      });
      setDraft(result);
      setBaseline(result);
      setSaved(true);
      setVersion(result.updatedAt);
      try {
        writeConfigDraft(draftKey, null);
      } catch {
        /* Saving succeeded even if local storage is unavailable. */
      }
      await onSaved(result);
    } catch (e) {
      setError(message(e));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  const swapModel = async () => {
    if (pending || dirty || !bot.fallbackProviderId) return;
    setPending(true);
    setError(null);
    try {
      const result = await rpc.call("swapModel", {
        id: bot.id,
        expectedUpdatedAt: bot.updatedAt,
      });
      setDraft(result);
      setBaseline(result);
      setVersion(result.updatedAt);
      setSaved(true);
      await onSaved(result);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPending(false);
    }
  };
  const externalHealth = useExternalHealth([draft.providerId]);
  const schedules = [
    [0, "Only when messaged or woken manually"],
    [15, "Every 15 minutes"],
    [60, "Every hour"],
    [360, "Every 6 hours"],
    [1440, "Every day"],
  ] as const;
  return (
    <form
      onSubmit={submit}
      className="flex min-w-0 flex-col gap-4"
      aria-label="Bot profile"
    >
      <fieldset disabled={pending} className="min-w-0 space-y-5 border-0 p-0">
        <Section title="Identity">
          <FormRow label="Name" htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              aria-label="Bot name"
              required
              maxLength={80}
              value={draft.name}
              className="max-w-[360px]"
              onChange={(e) => set("name", e.target.value)}
            />
          </FormRow>
          <FormRow label="Avatar" htmlFor={`${id}-avatar`}>
            <Input
              id={`${id}-avatar`}
              aria-label="Avatar"
              className="w-20 text-center"
              maxLength={16}
              value={draft.avatar}
              onChange={(e) => set("avatar", e.target.value)}
            />
          </FormRow>
          <FormRow label="Role" htmlFor={`${id}-role`}>
            <Input
              id={`${id}-role`}
              aria-label="Bot role"
              maxLength={500}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What this bot is responsible for"
            />
          </FormRow>
        </Section>
        <Section title="Behavior">
          <FormRow label="Primary model" hint="Changing the provider or model starts fresh bot threads. Past threads stay in history.">
            <ProviderModelPicker
              disabled={pending}
              className="profile-picker-control max-w-[360px]"
              allowProviderChange
              value={{
                providerId: draft.providerId,
                model: draft.model,
                reasoningLevel: draft.reasoningLevel,
              }}
              onChange={(v) => {
                if (v.providerId === draft.providerId && v.model === draft.model && v.reasoningLevel === draft.reasoningLevel) return;
                // A bot without a model gets the catalog's default filled in
                // on load. That isn't an edit, so it moves the baseline too.
                if (!draft.model && !baseline.model && v.providerId === draft.providerId) {
                  setResolved({ model: v.model, reasoningLevel: v.reasoningLevel });
                } else setSaved(false);
                // Outside agents accept fewer permission modes and no reasoning level.
                setDraft((d) => ({ ...d, providerId: v.providerId, model: v.model, reasoningLevel: reasoningLevelFor(v.providerId, v.reasoningLevel), permissionMode: permissionModeFor(v.providerId, d.permissionMode) }));
              }}
              routing={{ kind: "host", hostId: bot.hostId }}
            />
          </FormRow>
          <FormRow label="Fallback model" hint="If a provider error ends a mission response, the bot retries once with this model in a new thread.">
            {draft.fallbackProviderId ? <div className="space-y-2">
              <ProviderModelPicker
                disabled={pending}
                className="profile-picker-control max-w-[360px]"
                allowProviderChange
                value={{
                  providerId: draft.fallbackProviderId,
                  model: draft.fallbackModel,
                  reasoningLevel: draft.fallbackReasoningLevel,
                }}
                onChange={(v) => {
                  if (v.providerId === draft.fallbackProviderId && v.model === draft.fallbackModel && v.reasoningLevel === draft.fallbackReasoningLevel) return;
                  setDraft((d) => ({
                    ...d,
                    fallbackProviderId: v.providerId,
                    fallbackModel: v.model,
                    fallbackReasoningLevel: v.reasoningLevel,
                  }));
                  setSaved(false);
                }}
                routing={{ kind: "host", hostId: bot.hostId }}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={pending || dirty}
                  onClick={() => void swapModel()}>Use fallback now</Button>
                <Button type="button" size="sm" variant="ghost" disabled={pending}
                  onClick={() => {
                    setDraft((d) => ({ ...d, fallbackProviderId: "", fallbackModel: "" }));
                    setSaved(false);
                  }}>Remove fallback</Button>
              </div>
            </div> : <Button type="button" size="sm" variant="outline" disabled={pending}
              onClick={() => {
                setDraft((d) => ({ ...d, fallbackProviderId: d.providerId,
                  fallbackModel: "", fallbackReasoningLevel: d.reasoningLevel }));
                setSaved(false);
              }}>Add fallback model</Button>}
          </FormRow>
          {externalAgent(draft.providerId) && (
            <FormRow label="Outside agent">
              <div className="space-y-1.5">
                <ExternalAgentBadge providerId={draft.providerId} health={externalHealth[draft.providerId]} />
                <p className="text-xs leading-[1.45] text-muted-foreground">{externalToolsNote(draft.providerId)}</p>
              </div>
            </FormRow>
          )}
          <FormRow label="Permissions" hint={externalPermissionHint(draft.providerId) ?? undefined}>
            <PermissionModePicker
              disabled={pending}
              className="profile-picker-control max-w-[360px]"
              align="start"
              providerId={draft.providerId}
              value={draft.permissionMode}
              onChange={(v) => set("permissionMode", permissionModeFor(draft.providerId, v))}
              routing={{ kind: "host", hostId: bot.hostId }}
            />
          </FormRow>
          <FormRow
            label="Mission schedule"
            htmlFor={`${id}-schedule`}
            hint="Threads working as this bot are always available. Off means its mission runs only when asked."
          >
            <Select
              disabled={pending}
              value={String(draft.intervalMinutes)}
              onValueChange={(value) => set("intervalMinutes", Number(value))}
            >
              <SelectTrigger
                id={`${id}-schedule`}
                aria-label="Mission schedule"
                className="profile-picker-control max-w-[360px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {schedules.map(([value, label]) => (
                  <SelectItem key={value} value={String(value)}>
                    {label}
                  </SelectItem>
                ))}
                {!schedules.some(
                  ([value]) => value === draft.intervalMinutes,
                ) && (
                  <SelectItem value={String(draft.intervalMinutes)}>
                    Every {draft.intervalMinutes} minutes
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </FormRow>
        </Section>
      </fieldset>
      <ErrorMessage error={error} />
      {conflict && (
        <div role="alert" className="text-sm text-muted-foreground">
          This profile changed elsewhere. Your draft is saved on this device.{" "}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(bot);
              setBaseline(bot);
              setVersion(bot.updatedAt);
              setError(null);
            }}
          >
            Discard draft and load latest
          </Button>
        </div>
      )}
      <ActionBar
        status={
          pending
            ? "Saving…"
            : dirty
              ? "Unsaved changes · draft saved"
              : saved
                ? "Saved"
                : ""
        }
        primary={dirty || pending ? (
          <Button
            size="sm"
            disabled={pending || conflict || !draft.name.trim() || !dirty}
          >
            {pending ? "Saving…" : "Save profile"}
          </Button>
        ) : undefined}
      />
      {bot && (
        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Workspace
          </summary>
          <p className="my-3 font-mono text-xs [overflow-wrap:anywhere]">{bot.home}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            MISSION.md, MEMORY.md, and working files live here and persist
            across conversations and BB restarts.
          </p>
        </details>
      )}
      {bot && onArchive && (
        <Section title="Danger zone" tone="danger">
          <div className="flex items-center justify-between gap-4 px-3 py-3.5 max-md:flex-col max-md:items-start">
            <p className="text-xs leading-normal text-muted-foreground">
              {bot.retired
                ? "This bot is archived. Restore it to make it available again."
                : "Archiving stops this bot and turns off its mission schedule. Its workspace and history are preserved."}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={bot.retired ? undefined : "border-destructive/55 text-destructive hover:bg-destructive/10 hover:text-destructive"}
              disabled={pending}
              onClick={onArchive}
            >
              {bot.retired ? "Restore bot" : "Archive bot"}
            </Button>
          </div>
        </Section>
      )}
    </form>
  );
}

export function DocumentEditor({
  bot,
  file,
}: {
  bot: Bot;
  file: "MISSION.md" | "MEMORY.md";
}) {
  const rpc = useRpc<typeof rpcContract>();
  const editorId = useId();
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const historyBusy = useRef(false);
  const [historyMore, setHistoryMore] = useState(false),
    [historyPending, setHistoryPending] = useState(false);
  const loadHistory = async (before?: number) => {
    if (historyBusy.current) return;
    historyBusy.current = true;
    setHistoryPending(true);
    try {
      const page = await rpc.call("documentHistory", {
        id: bot.id,
        file,
        ...(before !== undefined ? { before } : {}),
      });
      setRevisions((old) => (before ? [...(old ?? []), ...page] : page));
      setHistoryMore(page.length === 20);
    } catch (e) {
      setError(message(e));
    } finally {
      historyBusy.current = false;
      setHistoryPending(false);
    }
  };
  const draftKey = `bb:bots:document:${bot.id}:${file}`;
  const [restored] = useState(() => readConfigDraft(draftKey, documentDraft));
  const initialLoad = useRef(true);
  const [remoteConflict, setRemoteConflict] = useState(false);
  const [operation, setOperation] = useState("Loading…");
  const [doc, setDoc] = useState<{ text: string; version: string } | null>(
    null,
  );
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [saved, setSaved] = useState(false),
    [reloading, setReloading] = useState(false);
  const dirty = !!doc && text !== doc.text;
  const tooLong = text.length > 64000;
  const load = useCallback(() => {
    setPending(true);
    setOperation("Loading…");
    rpc
      .call("document", { id: bot.id, file })
      .then(
        (d) => {
          const draft = initialLoad.current ? restored : null;
          initialLoad.current = false;
          setRemoteConflict(!!draft && draft.doc.version !== d.version);
          setDoc(draft?.doc ?? d);
          setText(draft?.text ?? d.text);
          setError(
            draft && draft.doc.version !== d.version
              ? "This file changed while you were away. Your draft is preserved; copy your edits before reloading the latest file."
              : null,
          );
          setSaved(false);
        },
        (e) => setError(message(e)),
      )
      .finally(() => setPending(false));
  }, [rpc, bot.id, file]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!doc) return;
    try {
      writeConfigDraft(draftKey, dirty ? { text, doc } : null);
    } catch {
      setError(
        "Draft could not be saved on this device. Save your changes before leaving.",
      );
    }
  }, [draftKey, text, doc, dirty]);
  const save = async () => {
    if (!doc || pending || !dirty || remoteConflict || tooLong) return;
    setPending(true);
    setOperation("Saving…");
    try {
      const d = await rpc.call("saveDocument", {
        id: bot.id,
        file,
        text,
        version: doc.version,
      });
      setDoc(d);
      setText(d.text);
      setError(null);
      setSaved(true);
    } catch (e) {
      if (message(e).includes("document changed")) setRemoteConflict(true);
      setError(message(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div data-bot-document className="flex flex-col gap-4">
      <p className="text-sm leading-5 text-muted-foreground">
        {file === "MISSION.md"
          ? "The standing direction this bot reads at the start of every turn."
          : "Durable facts and decisions shared across this bot’s conversations. The bot can update this file."}
      </p>
      {doc ? (
        <MarkdownEditor
          id={editorId}
          label={file}
          value={text}
          disabled={pending}
          onSave={() => void save()}
          onChange={(value) => {
            setText(value);
            setSaved(false);
          }}
        />
      ) : (
        <p role="status">Loading {file}…</p>
      )}
      <ErrorMessage
        error={
          tooLong
            ? "This file exceeds 64,000 characters. Shorten it before saving; your draft is preserved."
            : error
        }
      />
      <ActionBar
        status={
          pending
            ? operation
            : dirty
              ? "Unsaved changes · draft saved"
              : saved
                ? "Saved"
                : ""
        }
        secondary={
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (dirty) setReloading(true);
                else load();
              }}
            >
              <Icon name="RotateCcw" /> Reload
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={historyPending}
              onClick={() => void loadHistory()}
            >
              Version history
            </Button>
          </>
        }
        primary={dirty || pending ? (
          <Button
            size="sm"
            disabled={!doc || pending || !dirty || remoteConflict || tooLong}
            onClick={save}
          >
            {pending ? "Saving…" : `Save ${file === "MISSION.md" ? "mission" : "memory"}`}
          </Button>
        ) : undefined}
      />
      {revisions && (
        <RevisionList
          revisions={revisions}
          current={text}
          morePending={historyPending}
          onMore={
            historyMore
              ? () => void loadHistory(revisions.at(-1)!.id)
              : undefined
          }
          onUse={(value) => {
            if (pending) return;
            setText(value);
            setSaved(false);
          }}
        />
      )}
      <Modal
        title="Discard unsaved changes?"
        open={reloading}
        onOpenChange={setReloading}
      >
        <p className="text-sm leading-5">
          Reloading {file} replaces your unsaved edits with the latest file.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            autoFocus
            size="sm"
            variant="ghost"
            onClick={() => setReloading(false)}
          >
            Keep editing
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setReloading(false);
              load();
            }}
          >
            Discard and reload
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function BackButton({
  onClick,
  label = "All bots",
}: { onClick?: () => void; label?: string } = {}) {
  const navigate = useBbNavigate();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={COARSE_POINTER_HEADER_ICON_BUTTON_CLASS}
      aria-label={label}
      onClick={onClick ?? (() => navigate.toPluginPanel("bots"))}
    >
      <Icon name="ChevronLeft" />
    </Button>
  );
}
/** The item page's sections, as Studio's filter pills. */
export function TabBar({
  items,
  selected,
  onSelect,
  label,
}: {
  items: readonly string[];
  selected: string;
  onSelect: (tab: string) => void;
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto">
      {items.map((tab) => (
        <button
          type="button"
          key={tab}
          aria-current={selected === tab ? "page" : undefined}
          className={`${PILL} aria-[current=page]:bg-state-active aria-[current=page]:text-foreground`}
          onClick={() => onSelect(tab)}
        >
          {tab[0].toUpperCase() + tab.slice(1)}
        </button>
      ))}
    </nav>
  );
}
const activityTime = (at: number) =>
  new Intl.DateTimeFormat(
    undefined,
    new Date(at).toDateString() === new Date().toDateString()
      ? { timeStyle: "short" }
      : { dateStyle: "short", timeStyle: "short" },
  ).format(at);
const ACTIVITY_DOT: Record<"ready" | "working" | "paused" | "error", string> = {
  ready: "bg-muted-foreground/60",
  working: "bg-primary",
  paused: "bg-muted-foreground",
  error: "bg-destructive",
};
/** Read-only log of bot calls. Each row opens the bot's work thread. */
export function WorkList({ jobs, bots }: { jobs: Job[]; bots: Bot[] }) {
  const navigate = useBbNavigate();
  if (!jobs.length) return <EmptyState icon="Zap" title="No activity yet" />;
  return (
    <ol className="flex min-w-0 flex-col py-1">
      {jobs.map((job) => {
        const bot = bots.find((candidate) => candidate.id === job.botId);
        const status: { kind: keyof typeof ACTIVITY_DOT; label: string } =
          job.status === "error"
            ? { kind: "error", label: "Failed" }
            : job.status === "done"
              ? { kind: "ready", label: "Finished" }
              : job.status === "cancelled"
                ? { kind: "paused", label: "Stopped" }
                : {
                    kind: "working",
                    label:
                      job.status === "queued"
                        ? "Queued"
                        : job.startedAt
                          ? "Working"
                          : "Starting",
                  };
        const title = job.taskTitle || job.text || "Untitled request";
        return (
          <li key={job.id}>
            <button
              type="button"
              className="grid min-h-7 w-full grid-cols-[8px_minmax(0,max-content)_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-md px-2 py-1 text-left text-xs enabled:hover:bg-state-hover focus-visible:bg-state-hover disabled:cursor-default"
              disabled={!job.threadId}
              title={job.threadId ? "Open work thread" : undefined}
              aria-label={`${bot?.name ?? "Bot"}, ${status.label}: ${title}`}
              onClick={() => job.threadId && navigate.toThread(job.threadId)}
            >
              <span
                className={`size-[7px] self-center rounded-full ${ACTIVITY_DOT[status.kind]}`}
                aria-hidden="true"
              />
              <span className="font-semibold whitespace-nowrap">
                {bot?.name ?? "Bot"}
              </span>
              <span className="min-w-0 truncate text-muted-foreground">
                {isForkConversation(job.conversationKey) && (
                  <span className="me-1.5 rounded-full bg-muted px-1.5">
                    Fork
                  </span>
                )}
                {title}
              </span>
              <time
                className="whitespace-nowrap text-muted-foreground tabular-nums"
                dateTime={new Date(
                  job.updatedAt || job.createdAt,
                ).toISOString()}
              >
                {activityTime(job.updatedAt || job.createdAt)}
              </time>
              {job.error && (
                <span className="col-[3/-1] truncate text-destructive">
                  {job.error}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
