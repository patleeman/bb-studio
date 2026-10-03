// An explainer in Explore's side-panel tab (`{ explainerId }` params): live
// progress (with Stop) while it's written, the error with Retry when it
// failed, and once it's ready the explainer's HTML document under a header
// (when it was written, Regenerate, Open in Pages) with its follow-up
// findings below. A Markdown explainer opens in Pages instead.
import { errorMessage, shortDateTime } from "@bb-studio/kit/format";
import { useBbNavigate, useRealtime, useRpc, type PluginNavPanelProps, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@bb-studio/kit/ui";
import { cn } from "@bb-studio/kit/ui";
import { relativeTime } from "@bb-studio/kit/format";
import { REALTIME_CHANNEL } from "../constants";
import type { rpcContract } from "../contract";
import { EXPLORE_ICON, explainerEvent, explainerIdFrom, openExplainer, openExplainerPage, rowState, useMinuteTick, type ExplainerView, type RowState } from "./explore";
import { HtmlFrame } from "./html";
import { ExploreRows } from "./rows";

const POLL_MS = 2_000;
/** An explainer is one document, so let its frame grow well past an HTML block's cap. */
const MAX_DOCUMENT_HEIGHT = 40_000;

/** The explainer's HTML document, refetched when it's rewritten: undefined while loading, null for Markdown. */
function useExplainerHtml(explainerId: string, version: string | null): string | null | undefined {
  const rpc = useRpc<typeof rpcContract>();
  const [html, setHtml] = useState<{ version: string; html: string | null } | null>(null);
  useEffect(() => {
    if (!version) return;
    let live = true;
    rpc.call("explainerDocument", { explainerId }).then(
      (result) => live && setHtml({ version, html: result.html }),
      () => live && setHtml({ version, html: null }),
    );
    return () => {
      live = false;
    };
  }, [rpc, explainerId, version]);
  if (!version) return null;
  // Keep showing the last document while a newer version loads.
  return html ? html.html : undefined;
}

/** Explore's side-panel tab: an explainer, or from the launcher, the thread's explainers. */
export function ExplainerTab({ threadId, params }: PluginThreadPanelProps) {
  const explainerId = explainerIdFrom(params);
  if (explainerId) return <ExplainerPanel key={explainerId} explainerId={explainerId} />;
  return <ThreadExplainers threadId={threadId} />;
}

export function ExplainersPage({ subPath }: PluginNavPanelProps) {
  if (subPath) return <ExplainerPanel key={subPath} explainerId={subPath} />;
  return <ThreadExplainers />;
}

function ThreadExplainers({ threadId }: { threadId?: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  useMinuteTick();
  const [explainers, setExplainers] = useState<ExplainerView[] | null>(null);
  const load = useCallback(() => {
    rpc.call("explainers", { threadId, limit: 100 }).then(
      (result) => setExplainers(result.explainers),
      () => setExplainers((current) => current ?? []),
    );
  }, [rpc, threadId]);
  useEffect(load, [load]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = explainerEvent(payload);
    if (event && (!threadId || event.threadId === threadId)) load();
  });
  if (explainers === null) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!explainers.length) {
    return <PanelMessage title={threadId ? "Nothing explored in this thread yet" : "Nothing explored yet"} detail="Click a finding under an answer to write a page explaining it." />;
  }
  return (
    <ul className="divide-y divide-border/60 overflow-auto">
      {explainers.map((explainer) => {
        const state = rowState(explainer);
        return (
          <li key={explainer.id}>
            <button type="button" onClick={() => openExplainer(navigate, explainer)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-state-hover">
              <span aria-hidden className="w-5 shrink-0 text-center text-base leading-none">
                {explainer.emoji}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{explainer.label}</span>
              <span className={cn("shrink-0 text-xs text-muted-foreground", state === "error" && "text-destructive")}>{writtenLine(explainer, state)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ExplainerPanel({ explainerId }: { explainerId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  useMinuteTick();
  const [explainer, setExplainer] = useState<ExplainerView | null | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(() => {
    rpc.call("explainer", { explainerId }).then(
      (result) => setExplainer(result.explainer),
      (error: unknown) => {
        setActionError(errorMessage(error));
        setExplainer((current) => current ?? null);
      },
    );
  }, [rpc, explainerId]);
  useEffect(load, [load]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    if (explainerEvent(payload)?.explainerId === explainerId) load();
  });

  const state = rowState(explainer);
  // Realtime is the fast path; polling covers a dropped connection while a job runs.
  useEffect(() => {
    if (state !== "running") return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [state, load]);

  const html = useExplainerHtml(explainerId, explainer?.pageId ? `${explainer.pageId}:${explainer.updatedAt}` : null);
  const pageId = explainer?.pageId;
  const openPage = pageId ? () => openExplainerPage(pageId) : null;

  async function run(method: "exploreRegenerate" | "exploreStop") {
    setActing(true);
    setActionError(null);
    try {
      const result = await rpc.call(method, { explainerId });
      if (result.explainer) setExplainer(result.explainer);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setActing(false);
    }
  }

  if (explainer === undefined) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (explainer === null) return <PanelMessage title="Explainer not found" detail={actionError ?? "It may have been removed."} />;
  const title = explainer.label;

  const job = explainer.job;
  const error =
    actionError ??
    (state === "error" ? (job?.error ?? explainer.error) : null) ??
    (state === "ready" && job?.status === "error" ? `Regenerating failed: ${job.error ?? "unknown error"}` : null);
  const header = (
    <>
      <ExplainerHeader
        explainer={explainer}
        title={title}
        state={state}
        acting={acting}
        onRegenerate={() => void run("exploreRegenerate")}
        onStop={() => void run("exploreStop")}
        onOpenPage={openPage}
      />
      {state === "running" && job ? (
        <Progress label={job.kind === "regenerate" ? `Regenerating · ${job.label}` : job.label} detail={job.detail} progress={job.progress} startedAt={job.createdAt} />
      ) : null}
      {error ? (
        <div role="alert" className="mx-3 mt-3 flex shrink-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
          <Icon name="AlertTriangle" fallback="AlertCircle" className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      ) : null}
    </>
  );
  const followUps = explainer.followUps.length ? (
    <ExploreRows
      title="Explore next"
      items={explainer.followUps}
      threadId={explainer.threadId}
      messageId={explainer.messageId}
      turnId={explainer.turnId}
      parentId={explainer.id}
    />
  ) : null;

  if (explainer.pageId && html) {
    return (
      <div data-explainer-panel={explainerId} className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
        {header}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="pt-2">
            <HtmlFrame source={html} title={title} maxHeight={MAX_DOCUMENT_HEIGHT} />
          </div>
          {followUps ? <div className="px-4 pb-24">{followUps}</div> : <div className="pb-20" />}
        </div>
      </div>
    );
  }
  return (
    <div data-explainer-panel={explainerId} className="relative flex h-full min-h-0 flex-col overflow-auto bg-background text-foreground">
      {header}
      {explainer.pageId && html === undefined ? (
        <p className="p-4 text-sm text-muted-foreground">Loading…</p>
      ) : explainer.pageId && html === null && openPage ? (
        <PanelMessage title="This explainer is a Markdown page" detail="Read it in Pages.">
          <OpenInPages onOpen={openPage} />
        </PanelMessage>
      ) : state === "idle" ? (
        <p className="p-4 text-sm text-muted-foreground">{explainer.pageId ? "Its page was deleted. Generate it again to write a new one." : "Not written yet."}</p>
      ) : null}
    </div>
  );
}

function writtenLine(explainer: ExplainerView, state: RowState): string {
  if (state === "running" && !explainer.pageId) return "Writing an explainer…";
  if (explainer.regeneratedAt) return `Regenerated ${relativeTime(explainer.regeneratedAt)}`;
  if (explainer.generatedAt) return `Generated ${relativeTime(explainer.generatedAt)}`;
  return state === "error" ? "Couldn't write the explainer" : "Explore";
}

function ExplainerHeader({
  explainer,
  title,
  state,
  acting,
  onRegenerate,
  onStop,
  onOpenPage,
}: {
  explainer: ExplainerView;
  title: string;
  state: RowState;
  acting: boolean;
  onRegenerate(): void;
  onStop(): void;
  onOpenPage: (() => void) | null;
}) {
  const writtenAt = explainer.regeneratedAt ?? explainer.generatedAt;
  const button = "flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50";
  return (
    <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
      <span className="shrink-0 text-base leading-none" aria-hidden>
        {explainer.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="flex items-center gap-1 truncate text-[11px] text-muted-foreground" title={writtenAt ? shortDateTime(writtenAt) : undefined}>
          <Icon name={EXPLORE_ICON} fallback="Search" className="size-3 shrink-0" />
          {writtenLine(explainer, state)}
        </div>
      </div>
      {state === "running" ? (
        <button type="button" className={button} disabled={acting} onClick={onStop} title="Stop writing this explainer">
          <Icon name="Square" className="size-3.5" /> Stop
        </button>
      ) : (
        <button type="button" className={button} disabled={acting} onClick={onRegenerate} title={state === "ready" ? "Write it again; the current page is kept as a version" : undefined}>
          <Icon name="RotateCcw" className="size-3.5" />
          {state === "ready" ? "Regenerate" : state === "error" ? "Retry" : "Generate"}
        </button>
      )}
      {onOpenPage ? <OpenInPages onOpen={onOpenPage} /> : null}
    </header>
  );
}

function Progress({ label, detail, progress, startedAt }: { label: string; detail: string; progress: number; startedAt: number }) {
  const value = Math.round(progress);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="mx-3 mt-3 shrink-0 rounded-lg border border-border/70 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <Icon name="Loading" fallback="Spinner" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
          <span className="truncate">{label}</span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {value}% · {elapsed(now - startedAt)}
        </span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="mt-2 h-1 overflow-hidden rounded-full bg-foreground/[0.06]">
        <div className="h-full rounded-full bg-foreground/50 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.max(value, 3)}%` }} />
      </div>
      <p className={cn("mt-2 text-xs text-muted-foreground")}>{detail}</p>
      <p className="mt-1 text-xs text-muted-foreground">A private copy of this thread is investigating. You can keep working; the page is saved in Pages under Explore.</p>
    </div>
  );
}

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function OpenInPages({ onOpen }: { onOpen(): void }) {
  return (
    <button
      type="button"
      title="Open the full page in Pages"
      className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
      onClick={onOpen}
    >
      Open in Pages
      <Icon name="ArrowUpRight" className="size-3.5" />
    </button>
  );
}

function PanelMessage({ title, detail, children }: { title: string; detail?: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <Icon name={EXPLORE_ICON} fallback="Search" className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {detail ? <p className="max-w-xs text-xs text-muted-foreground">{detail}</p> : null}
      {children}
    </div>
  );
}
