import { GHOST_BUTTON, Icon, OUTLINE_BUTTON, PageColumn, openAppPath, studioItemProps } from "@bb-studio/kit/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { errorMessage } from "@bb-studio/kit/format";
import { useBbContext, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";
import type { rpcContract } from "../contract";

type Home = z.output<(typeof rpcContract)["home"]["output"]>;
type Need = NonNullable<Home["needsYou"]>[number];

/** The `home` RPC, kept fresh on Studio changes, visibility and a minute's tick. */
function useHome(periodDays: number) {
  const rpc = useRpc<typeof rpcContract>();
  const context = useBbContext();
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    let cursor = 0;
    // RPC input must be JSON, so leave projectId out rather than sending undefined.
    const input = context.projectId ? { projectId: context.projectId, periodDays } : { periodDays };
    void rpc.call("changes", { since: 0 }).then((checkpoint) => { cursor = checkpoint.cursor; return rpc.call("home", input); })
      .then((home) => { setData(home); setError(null); return rpc.call("changes", { since: cursor }); })
      .then((later) => { if (later.reset || later.changes.length) void rpc.call("home", input).then(setData); })
      .catch((cause: unknown) => setError(errorMessage(cause)));
  }, [context.projectId, periodDays, rpc]);
  useEffect(() => { refresh(); const onVisible = () => { if (document.visibilityState === "visible") refresh(); }; document.addEventListener("visibilitychange", onVisible); return () => document.removeEventListener("visibilitychange", onVisible); }, [refresh]);
  useEffect(() => { const timer = setInterval(refresh, 60_000); return () => clearInterval(timer); }, [refresh]);
  useRealtime(STUDIO_REALTIME_CHANNEL, refresh);
  return { data, error, setError, refresh };
}

const NEED_ICONS: Record<Need["kind"], string> = {
  approval: "CircleCheck", question: "MessageSquare", attention: "BellDot", review: "Eye", due: "Calendar", reply: "CornerDownRight", mention: "MessageSquarePlus",
};
const SHOWN_NEEDS = 4;

function NeedRow({ entry, onRespond }: { entry: Need; onRespond: (entry: Need, action: "approve" | "deny" | "answer", answer?: string) => Promise<void> }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const respond = async (action: "approve" | "deny" | "answer") => {
    setBusy(true);
    try { await onRespond(entry, action, answer); } finally { setBusy(false); }
  };
  return <li className="flex min-h-10 items-center gap-3 px-3 py-1.5 text-sm max-md:flex-wrap">
    <Icon name={NEED_ICONS[entry.kind]} aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    <button type="button" onClick={() => openAppPath(entry.href)} title={entry.body} className="flex min-w-0 flex-1 items-baseline gap-2 text-left hover:underline focus-visible:outline-2 focus-visible:outline-ring">
      <span className="shrink-0 font-medium">{entry.title}</span>
      <span className="min-w-0 truncate text-muted-foreground">{entry.body}</span>
    </button>
    {entry.responseKind === "approval" ? <div className="flex shrink-0 gap-1.5">
      <button disabled={busy} type="button" onClick={() => void respond("approve")} className={OUTLINE_BUTTON}>Approve once</button>
      <button disabled={busy} type="button" onClick={() => void respond("deny")} className={GHOST_BUTTON}>Deny</button>
    </div> : null}
    {entry.responseKind === "question" ? <form onSubmit={(event) => { event.preventDefault(); void respond("answer"); }} className="flex shrink-0 gap-1.5">
      <input aria-label={`Answer ${entry.title}`} placeholder="Answer" value={answer} onChange={(event) => setAnswer(event.target.value)} className="h-8 w-48 rounded-md border border-border bg-background px-2" />
      <button disabled={busy || !answer.trim()} type="submit" className={OUTLINE_BUTTON}>Send</button>
    </form> : null}
  </li>;
}

/** What needs you, above the collection. Renders nothing when nothing does. */
export function NeedsYou() {
  const rpc = useRpc<typeof rpcContract>();
  const { data, error, setError, refresh } = useHome(7);
  const [expanded, setExpanded] = useState(false);
  const respond = useCallback(async (entry: Need, action: "approve" | "deny" | "answer", answer?: string) => {
    if (!entry.threadId || !entry.interactionId) return;
    try { await rpc.call("homeRespond", { threadId: entry.threadId, interactionId: entry.interactionId, action, ...(answer === undefined ? {} : { answer }) }); refresh(); }
    catch (cause) { setError(errorMessage(cause)); }
  }, [refresh, rpc, setError]);
  const needs = data?.needsYou ?? [];
  if (!needs.length) return null;
  const shown = expanded ? needs : needs.slice(0, SHOWN_NEEDS);
  return <section aria-label="Needs you" className="mb-4 rounded-lg border border-border">
    <h2 className="flex items-center justify-between px-3 pt-2 text-xs font-medium text-muted-foreground">
      Needs you · {needs.length}
      {needs.length > SHOWN_NEEDS ? <button type="button" onClick={() => setExpanded(!expanded)} className="hover:text-foreground">{expanded ? "Show less" : "Show all"}</button> : null}
    </h2>
    {error ? <p role="alert" className="px-3 pt-1 text-sm text-destructive">{error}</p> : null}
    <ul className="m-0 list-none divide-y divide-border p-0">{shown.map((entry) => <NeedRow key={entry.id} entry={entry} onRespond={respond} />)}</ul>
  </section>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="min-w-0"><h2 className="mb-2 text-sm font-semibold">{title}</h2><div className="divide-y divide-border rounded-md border border-border">{children}</div></section>;
}

function Row({ title, detail, href }: { title: string; detail?: string; href?: string }) {
  const content = <><span className="min-w-0 flex-1 truncate">{title}</span>{detail ? <span className="shrink-0 text-xs text-muted-foreground">{detail}</span> : null}</>;
  return href ? <button type="button" onClick={() => openAppPath(href)} {...studioItemProps({ href, title })} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">{content}</button>
    : <div className="flex items-center gap-3 px-3 py-2 text-sm">{content}</div>;
}

/** Measured thread and bot usage over a period, opened from Studio's options menu. */
export function ActivityPanel() {
  const navigate = useBbNavigate();
  const [periodDays, setPeriodDays] = useState(7);
  const { data, error } = useHome(periodDays);
  return <PageColumn>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <button type="button" onClick={() => navigate.toPluginPanel("studio", { subPath: "" })} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><Icon name="ChevronLeft" className="size-4" /> Studio</button>
        <h1 className="text-2xl font-semibold">Activity</h1>
      </div>
      <label className="flex items-center gap-2 text-sm">Period <select value={periodDays} onChange={(event) => setPeriodDays(Number(event.target.value))} className="rounded-md border border-border bg-background px-2 py-1"><option value={1}>Today</option><option value={7}>7 days</option><option value={30}>30 days</option></select></label>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {!data && !error ? <p className="text-sm text-muted-foreground">Loading activity…</p> : null}
    {data ? <div className="mt-4 space-y-6">
      <Section title="Threads">{data.dashboard.threads.length ? data.dashboard.threads.map((thread) => <Row key={thread.id} title={thread.title} detail={`${thread.turns} turns · ${thread.failures} errors · ${Math.round(thread.durationMs / 60000)} min · ${thread.status}`} href={`/threads/${thread.id}`} />) : <Row title="No thread activity in this period" />}</Section>
      {data.dashboard.bots ? <Section title="Bots">{data.dashboard.bots.length ? data.dashboard.bots.map((bot) => <Row key={bot.id} title={bot.name} detail={`${bot.turns} turns · ${bot.failures} errors · ${Math.round(bot.durationMs / 60000)} min${bot.limits ? ` · limit ${bot.limits.turnsPerDay}/day` : ""}`} />) : <Row title="No bots in this project" />}</Section> : null}
      {data.activity.length ? <Section title="Recent changes">{data.activity.map((event) => <Row key={event.id} title={event.summary || "Untitled"} detail={`${event.verb} · ${new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(event.at)}`} href={event.href} />)}</Section> : null}
    </div> : null}
  </PageColumn>;
}
