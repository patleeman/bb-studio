import { Icon, PageColumn, openAppPath } from "@bb-studio/kit/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { errorMessage } from "@bb-studio/kit/format";
import { useBbContext, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";
import type { rpcContract } from "../contract";

type Home = z.output<(typeof rpcContract)["home"]["output"]>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="min-w-0"><h2 className="mb-2 text-sm font-semibold">{title}</h2><div className="divide-y divide-border rounded-md border border-border">{children}</div></section>;
}

function Row({ title, detail, href }: { title: string; detail?: string; href?: string }) {
  const content = <><span className="min-w-0 flex-1 truncate">{title}</span>{detail ? <span className="shrink-0 text-xs text-muted-foreground">{detail}</span> : null}</>;
  return href ? <button type="button" onClick={() => openAppPath(href)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">{content}</button>
    : <div className="flex items-center gap-3 px-3 py-2 text-sm">{content}</div>;
}

function NeedRow({ entry, onRespond }: { entry: NonNullable<Home["needsYou"]>[number]; onRespond: (entry: NonNullable<Home["needsYou"]>[number], action: "approve" | "deny" | "answer", answer?: string) => Promise<void> }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const respond = async (action: "approve" | "deny" | "answer") => {
    setBusy(true);
    try { await onRespond(entry, action, answer); } finally { setBusy(false); }
  };
  return <div className="space-y-2 px-3 py-2 text-sm">
    <button type="button" onClick={() => openAppPath(entry.href)} className="block w-full text-left focus-visible:outline-2 focus-visible:outline-ring"><span className="font-medium">{entry.title}</span><span className="ml-2 text-xs capitalize text-muted-foreground">{entry.kind}</span><span className="mt-0.5 block line-clamp-2 text-muted-foreground">{entry.body}</span></button>
    {entry.responseKind === "approval" ? <div className="flex gap-2"><button disabled={busy} type="button" onClick={() => void respond("approve")} className="rounded-md border border-border px-2 py-1 hover:bg-state-hover disabled:opacity-50">Approve once</button><button disabled={busy} type="button" onClick={() => void respond("deny")} className="rounded-md border border-border px-2 py-1 hover:bg-state-hover disabled:opacity-50">Deny</button></div> : null}
    {entry.responseKind === "question" ? <form onSubmit={(event) => { event.preventDefault(); void respond("answer"); }} className="flex gap-2"><input aria-label={`Answer ${entry.title}`} value={answer} onChange={(event) => setAnswer(event.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1" /><button disabled={busy || !answer.trim()} type="submit" className="rounded-md border border-border px-2 py-1 hover:bg-state-hover disabled:opacity-50">Answer</button></form> : null}
  </div>;
}

export function HomePanel({ tab }: { tab: "today" | "activity" }) {
  const rpc = useRpc<typeof rpcContract>();
  const context = useBbContext();
  const navigate = useBbNavigate();
  const [periodDays, setPeriodDays] = useState(7);
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
  const respond = useCallback(async (entry: NonNullable<Home["needsYou"]>[number], action: "approve" | "deny" | "answer", answer?: string) => {
    if (!entry.threadId || !entry.interactionId) return;
    try { await rpc.call("homeRespond", { threadId: entry.threadId, interactionId: entry.interactionId, action, ...(answer === undefined ? {} : { answer }) }); refresh(); }
    catch (cause) { setError(errorMessage(cause)); }
  }, [refresh, rpc]);
  useEffect(() => { refresh(); const onVisible = () => { if (document.visibilityState === "visible") refresh(); }; document.addEventListener("visibilitychange", onVisible); return () => document.removeEventListener("visibilitychange", onVisible); }, [refresh]);
  useEffect(() => { const timer = setInterval(refresh, 60_000); return () => clearInterval(timer); }, [refresh]);
  useRealtime(STUDIO_REALTIME_CHANNEL, refresh);
  return <PageColumn>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">Studio</h1>
      <button type="button" onClick={() => navigate.toPluginPanel("studio", { subPath: "collection" })} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-state-hover"><Icon name="GridView" className="size-4" /> Collection</button>
    </div>
    <div role="tablist" aria-label="Home views" className="mb-2 flex gap-1 border-b border-border">
      {(["today", "activity"] as const).map((view) => <button key={view} type="button" role="tab" aria-selected={tab === view} onClick={() => navigate.toPluginPanel("studio", { subPath: view === "today" ? "" : "activity" })} className={`px-3 py-2 text-sm capitalize ${tab === view ? "border-b-2 border-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>{view}</button>)}
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {!data && !error ? <p className="text-sm text-muted-foreground">Loading Studio…</p> : null}
    {data && tab === "today" ? <div className="grid gap-6 lg:grid-cols-2">
      {data.needsYou?.length ? <div className="lg:col-span-2"><Section title="Needs you">{data.needsYou.map((entry) => <NeedRow key={entry.id} entry={entry} onRespond={respond} />)}</Section></div> : null}
      {data.due?.length ? <Section title="Due today and overdue">{data.due.map((task) => <Row key={task.id} title={task.title} detail={task.due ?? undefined} href={`/plugins/studio-tasks/tasks/${task.id}`} />)}</Section> : null}
      {data.review?.length ? <Section title="In review">{data.review.map((task) => <Row key={task.id} title={task.title} href={`/plugins/studio-tasks/tasks/${task.id}`} />)}</Section> : null}
      {data.working.threads.length || data.working.bots?.length ? <Section title="Agents working now">{data.working.threads.map((thread) => <Row key={thread.id} title={thread.title} detail={thread.status} href={`/threads/${thread.id}`} />)}{data.working.bots?.map((bot) => <Row key={bot.id} title={bot.name} detail="Bot" />)}</Section> : null}
      {data.recent.length ? <Section title="Recent items">{data.recent.map((item) => <Row key={`${item.pluginId}:${item.id}`} title={item.title || "Untitled"} detail={item.kind} href={item.href} />)}</Section> : null}
      {data.automations?.length ? <Section title="Today's automations">{data.automations.map((automation) => <Row key={automation.id} title={automation.name} detail={automation.nextRunAt ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(automation.nextRunAt) : undefined} />)}</Section> : null}
      {data.activity.length ? <Section title="Activity">{data.activity.map((event) => <Row key={event.id} title={event.summary || "Untitled"} detail={`${event.verb} · ${new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(event.at)}`} href={event.href} />)}</Section> : null}
      {!data.needsYou?.length && !data.due?.length && !data.review?.length && !data.working.threads.length && !data.working.bots?.length && !data.recent.length && !data.automations?.length && !data.activity.length ? <p className="text-sm text-muted-foreground">Nothing needs attention today.</p> : null}
    </div> : null}
    {data && tab === "activity" ? <div className="space-y-6">
      <label className="flex items-center gap-2 text-sm">Period <select value={periodDays} onChange={(event) => setPeriodDays(Number(event.target.value))} className="rounded-md border border-border bg-background px-2 py-1"><option value={1}>Today</option><option value={7}>7 days</option><option value={30}>30 days</option></select></label>
      <Section title="Threads">{data.dashboard.threads.length ? data.dashboard.threads.map((thread) => <Row key={thread.id} title={thread.title} detail={`${thread.turns} turns · ${thread.failures} errors · ${Math.round(thread.durationMs / 60000)} min · ${thread.status}`} href={`/threads/${thread.id}`} />) : <Row title="No thread activity in this period" />}</Section>
      {data.dashboard.bots ? <Section title="Bots">{data.dashboard.bots.length ? data.dashboard.bots.map((bot) => <Row key={bot.id} title={bot.name} detail={`${bot.turns} turns · ${bot.failures} errors · ${Math.round(bot.durationMs / 60000)} min${bot.limits ? ` · limit ${bot.limits.turnsPerDay}/day` : ""}`} />) : <Row title="No bots in this project" />}</Section> : null}
    </div> : null}
  </PageColumn>;
}
