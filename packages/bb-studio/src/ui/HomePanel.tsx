import { BarCrumb, BarSeparator, PageColumn, SECTION_TITLE, StudioBar, ViewMoveMenu, openAppPath, studioItemProps, studioThreadProps, threadLinkId } from "@bb-studio/kit/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { errorMessage } from "@bb-studio/kit/format";
import { useBbContext, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";
import type { rpcContract } from "../contract";

type Home = z.output<(typeof rpcContract)["home"]["output"]>;

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="min-w-0"><h2 className={`mb-2 ${SECTION_TITLE}`}>{title}</h2><div className="divide-y divide-border rounded-md border border-border">{children}</div></section>;
}

function Row({ title, detail, href }: { title: string; detail?: string; href?: string }) {
  const content = <><span className="min-w-0 flex-1 truncate">{title}</span>{detail ? <span className="shrink-0 text-xs text-muted-foreground">{detail}</span> : null}</>;
  return href ? <button type="button" onClick={() => openAppPath(href)} {...(threadLinkId(href) ? studioThreadProps(threadLinkId(href), title) : studioItemProps({ href, title }))} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">{content}</button>
    : <div className="flex items-center gap-3 px-3 py-2 text-sm">{content}</div>;
}

/** Measured thread and bot usage over a period, opened from Studio's options menu. */
export function ActivityPanel() {
  const navigate = useBbNavigate();
  const [periodDays, setPeriodDays] = useState(7);
  const { data, error } = useHome(periodDays);
  const back = () => navigate.toPluginPanel("studio", { subPath: "" });
  return <PageColumn className="pt-6">
    <StudioBar>
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5">
        <BarCrumb onClick={back} title="Back to Studio">Studio</BarCrumb>
        <BarSeparator />
        <BarCrumb current>Activity</BarCrumb>
      </nav>
      <select aria-label="Period" value={periodDays} onChange={(event) => setPeriodDays(Number(event.target.value))} className="h-7 rounded-md bg-transparent px-1.5 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"><option value={1}>Today</option><option value={7}>7 days</option><option value={30}>30 days</option></select>
      <ViewMoveMenu item={{ href: "/plugins/studio/studio/activity", title: "Activity" }} onBack={back} />
    </StudioBar>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {!data && !error ? <p className="text-sm text-muted-foreground">Loading activity…</p> : null}
    {data ? <div className="mt-4 space-y-6">
      <Section title="Threads">{data.dashboard.threads.length ? data.dashboard.threads.map((thread) => <Row key={thread.id} title={thread.title} detail={`${thread.turns} turns · ${thread.failures} errors · ${Math.round(thread.durationMs / 60000)} min · ${thread.status}`} href={`/threads/${thread.id}`} />) : <Row title="No thread activity in this period" />}</Section>
      {data.dashboard.bots ? <Section title="Bots">{data.dashboard.bots.length ? data.dashboard.bots.map((bot) => <Row key={bot.id} title={bot.name} detail={`${bot.turns} turns · ${bot.failures} errors · ${Math.round(bot.durationMs / 60000)} min${bot.limits ? ` · limit ${bot.limits.turnsPerDay}/day` : ""}`} />) : <Row title="No bots in this project" />}</Section> : null}
      {data.activity.length ? <Section title="Recent changes">{data.activity.map((event) => <Row key={event.id} title={event.summary || "Untitled"} detail={`${event.verb} · ${new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(event.at)}`} href={event.href} />)}</Section> : null}
    </div> : null}
  </PageColumn>;
}
