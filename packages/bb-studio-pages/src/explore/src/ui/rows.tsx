// Explore's findings as full-width rows: "Along the way" at the bottom of a
// reply (the `::explore{items="🐛 …|🏗️ …"}` directive), and "Explore next"
// under an explainer. A row shows its explainer's state (Explore →
// Generating · 45% → Open · generated 2h ago, or Retry) from what's saved,
// so it survives a reload. Clicking one opens it in Explore's side-panel tab.
// A reply's findings can also be saved to Studio Feed, to read later.
import { errorMessage } from "@bb-studio/kit/format";
import { useBbNavigate, useRealtime, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@bb-studio/kit/ui";
import { cn } from "@bb-studio/kit/ui";
import { relativeTime } from "@bb-studio/kit/format";
import { PLUGIN_ID, REALTIME_CHANNEL } from "../constants";
import { useExploreRpc } from "../../client";
import { labelKey, parseExploreItems, type ExploreItem } from "../shared";
import { EXPLORE_ICON, explainerEvent, openExplainer, rowState, useMinuteTick, type ExplainerView } from "./explore";

const POLL_MS = 2_500;
/** Where the Explore setting lives: this plugin's page in Settings. */
const SETTINGS_HREF = `/settings/plugins/${PLUGIN_ID}`;

/** `::explore{items="…"}` at the end of a reply. */
export function ExploreDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const raw = attributes.items;
  const items = useMemo(() => parseExploreItems(raw), [raw]);
  if (!items.length) return null;
  return <ExploreRows items={items} threadId={message.threadId} messageId={message.id} turnId={message.turnId} settingsHint />;
}

export interface ExploreRowsProps {
  items: readonly ExploreItem[];
  threadId: string;
  messageId: string;
  turnId: string | null;
  /** Follow-ups of an explainer: explored from the same message, under it. */
  parentId?: string | null;
  title?: string;
  /** Says, quietly, where to turn Explore off. Only for the end-of-reply rows the setting controls. */
  settingsHint?: boolean;
  className?: string;
}

export function ExploreRows({ items, threadId, messageId, turnId, parentId = null, title = "Along the way", settingsHint = false, className }: ExploreRowsProps) {
  const rpc = useExploreRpc();
  const navigate = useBbNavigate();
  useMinuteTick();
  const [explainers, setExplainers] = useState<ExplainerView[]>([]);
  /** Labels whose click is in flight, and clicks that failed before a job existed. */
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Labels saved to the Feed (reply findings only), and saves in flight or failed. */
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Record<string, "busy" | string>>({});
  const savable = parentId === null;
  const load = useCallback(() => {
    rpc.call("explainersForMessage", { threadId, messageId, parentId }).then(
      (result) => setExplainers(result.explainers),
      () => undefined,
    );
  }, [rpc, threadId, messageId, parentId]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!savable) return;
    rpc.call("savedForMessage", { threadId, messageId }).then(
      (result) => setSaved(new Set(result.labels.map(labelKey))),
      () => undefined,
    );
  }, [rpc, threadId, messageId, savable]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = explainerEvent(payload);
    if (event && event.threadId === threadId && event.messageId === messageId && event.parentId === parentId) load();
  });

  const byLabel = useMemo(() => new Map(explainers.map((explainer) => [labelKey(explainer.label), explainer])), [explainers]);
  const running = explainers.some((explainer) => rowState(explainer) === "running");
  // Realtime is the fast path; polling covers a dropped connection while a job runs.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const replace = (next: ExplainerView) => setExplainers((current) => [...current.filter((each) => each.id !== next.id), next]);

  async function act(item: ExploreItem, explainer: ExplainerView | undefined, regenerate: boolean) {
    const key = labelKey(item.label);
    if (busy[key]) return;
    setErrors(({ [key]: _, ...rest }) => rest);
    const state = rowState(explainer);
    // Written or being written: just open it.
    if (explainer && !regenerate && (state === "ready" || state === "running")) {
      openExplainer(navigate, explainer);
      return;
    }
    setBusy((current) => ({ ...current, [key]: true }));
    try {
      const next =
        regenerate && explainer
          ? (await rpc.call("exploreRegenerate", { explainerId: explainer.id })).explainer
          : (await rpc.call("explore", { threadId, messageId, turnId, emoji: item.emoji, label: item.label, parentId })).explainer;
      replace(next);
      openExplainer(navigate, next);
    } catch (error) {
      setErrors((current) => ({ ...current, [key]: errorMessage(error) }));
    } finally {
      setBusy(({ [key]: _, ...rest }) => rest);
    }
  }

  async function save(item: ExploreItem) {
    const key = labelKey(item.label);
    if (saving[key] === "busy") return;
    setSaving((current) => ({ ...current, [key]: "busy" }));
    try {
      await rpc.call("saveToFeed", { threadId, messageId, turnId, emoji: item.emoji, label: item.label });
      setSaved((current) => new Set(current).add(key));
      setSaving(({ [key]: _, ...rest }) => rest);
    } catch (error) {
      setSaving((current) => ({ ...current, [key]: errorMessage(error) }));
    }
  }

  if (!items.length) return null;
  return (
    <section aria-label={title} className={cn("my-3 w-full overflow-hidden rounded-lg border border-border/70 bg-background", className)}>
      <header className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs text-muted-foreground">
        <Icon name={EXPLORE_ICON} fallback="Search" className="size-3.5" />
        {title}
        {settingsHint ? (
          <a
            href={SETTINGS_HREF}
            title="Stop agents from ending answers with things to explore. Applies to new agent sessions."
            className="ml-auto text-[11px] text-muted-foreground/60 hover:text-foreground hover:underline"
          >
            Turn off in settings
          </a>
        ) : null}
      </header>
      <ul className="divide-y divide-border/60 border-t border-border/60">
        {items.map((item) => {
          const key = labelKey(item.label);
          const explainer = byLabel.get(key);
          return (
            <ExploreRow
              key={key}
              item={item}
              explainer={explainer}
              pending={Boolean(busy[key])}
              clickError={errors[key] ?? null}
              onOpen={() => void act(item, explainer, false)}
              onRegenerate={() => void act(item, explainer, true)}
              feed={savable ? { saved: saved.has(key), saving: saving[key] ?? null, onSave: () => void save(item) } : null}
            />
          );
        })}
      </ul>
    </section>
  );
}

function ExploreRow({
  item,
  explainer,
  pending,
  clickError,
  onOpen,
  onRegenerate,
  feed,
}: {
  item: ExploreItem;
  explainer: ExplainerView | undefined;
  pending: boolean;
  clickError: string | null;
  onOpen(): void;
  onRegenerate(): void;
  /** Saving to Studio Feed: reply findings only. `saving` is "busy" or the error. */
  feed: { saved: boolean; saving: string | null; onSave(): void } | null;
}) {
  const state = clickError ? "error" : rowState(explainer);
  const progress = Math.round(explainer?.job?.progress ?? 0);
  const error = clickError ?? explainer?.job?.error ?? explainer?.error ?? null;
  const writtenAt = explainer?.regeneratedAt ?? explainer?.generatedAt ?? null;
  const regenerating = state === "running" && explainer?.job?.kind === "regenerate";

  let status: string;
  let title: string | undefined;
  if (state === "running") {
    status = `${regenerating ? "Regenerating" : "Generating"} · ${progress}%`;
    title = explainer?.job ? `${explainer.job.label}: ${explainer.job.detail}` : undefined;
  } else if (state === "ready") {
    status = writtenAt ? `Open · ${explainer?.regeneratedAt ? "regenerated" : "generated"} ${relativeTime(writtenAt)}` : "Open";
  } else if (state === "error") {
    status = "Retry";
    title = error ?? undefined;
  } else {
    status = "Explore";
  }

  return (
    <li className="group relative flex flex-wrap items-stretch">
      <button
        type="button"
        onClick={onOpen}
        disabled={pending}
        title={title}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-state-hover disabled:cursor-progress"
      >
        <span aria-hidden className="w-5 shrink-0 text-center text-base leading-none">
          {item.emoji}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.label}</span>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-xs tabular-nums",
            state === "error" ? "text-destructive" : state === "idle" ? "text-muted-foreground group-hover:text-foreground" : "text-muted-foreground",
            state === "running" && "animate-pulse motion-reduce:animate-none",
          )}
        >
          {pending ? <Icon name="Loading" fallback="Spinner" className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
          {status}
          {state === "ready" ? <Icon name="ArrowUpRight" className="size-3.5" /> : null}
          {state === "error" ? <Icon name="RotateCcw" className="size-3.5" /> : null}
        </span>
      </button>
      {state === "ready" ? (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={pending}
          aria-label={`Regenerate "${item.label}"`}
          title="Regenerate"
          className="flex w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-40"
        >
          <Icon name="RotateCcw" className="size-3.5" />
        </button>
      ) : null}
      {feed ? (
        <button
          type="button"
          onClick={feed.onSave}
          disabled={feed.saved || feed.saving === "busy"}
          aria-label={feed.saved ? `"${item.label}" is saved to the feed` : `Save "${item.label}" to the feed`}
          title={feed.saved ? "Saved to the feed" : feed.saving && feed.saving !== "busy" ? `Couldn't save: ${feed.saving}` : "Save to the feed, to read later"}
          className={cn(
            "flex w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:hover:bg-transparent",
            feed.saved && "text-foreground",
            feed.saving && feed.saving !== "busy" && "text-destructive",
          )}
        >
          <Icon
            name={feed.saving === "busy" ? "Loading" : feed.saved ? "pages/bookmark-check" : "pages/bookmark-add"}
            className={cn("size-3.5", feed.saving === "busy" && "animate-spin motion-reduce:animate-none")}
          />
        </button>
      ) : null}
      {state === "running" ? (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-foreground/[0.06]">
            <span className="block h-full bg-foreground/40 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.max(progress, 3)}%` }} />
          </span>
          <span role="progressbar" aria-label={`${item.label}: ${status}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="sr-only" />
        </>
      ) : null}
    </li>
  );
}
