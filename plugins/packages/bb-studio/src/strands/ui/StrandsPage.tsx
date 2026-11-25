// The Strands page (bot/<botId>/strands; the older Tasks address
// bot/<botId>/loops opens it too), in place of the Tasks page. Now: every
// conversation's open strands, needs you first (strands.overview, design 4b),
// then the areas' cards. Scheduled: the Bot's automations.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useMemo, useState, type MouseEvent } from "react";
import { useNow } from "../../kit/app/visible-poll";
import { Button } from "../../kit/ui/button";
import { cn } from "../../kit/ui/utils";
import type { BotView } from "../../contract";
import { BotPageEmpty, BotPageGroup, BotPageLayout, BotPageMore, BotPageRow, BotPageToolbar, foldRows, noMatch, useBotPageQuery, useRowOpen } from "../../ui/bot-page";
import { useLive } from "../../ui/live";
import { SEVERITY_LABEL } from "../../tasks/ui/model";
import type { Task } from "../../tasks/contract";
import { AreasSection } from "../../areas/ui/AreasSection";
import { ownerThreadOf } from "../../areas/ui/AreaCard";
import { SCHEDULED_ICON, scheduledMeta } from "../../loops/ui/scheduled-model";
import { NewAutomationMenu, newKinds, useAutomationEditor, useAutomations } from "../../ui/bot/Automations";
import { useTodosZone } from "../../loops/ui/hooks";
import { overviewLine, StrandsCards } from "./Overview";

export type StrandsTab = "now" | "scheduled";

/** An area's lead at work: a running strand, and its running workers, in the lead's conversation. */
export function areaWork(conversations: readonly { threadId: string; strands: readonly { state: string; workers: readonly { status: string }[] }[] }[] | undefined) {
  const byThread = new Map((conversations ?? []).map((row) => [row.threadId, row]));
  return (threadId: string | null) => {
    const row = threadId ? byThread.get(threadId) : undefined;
    if (!row) return { live: false, workers: 0 };
    const workers = row.strands.reduce((sum, strand) => sum + strand.workers.filter((worker) => worker.status === "running").length, 0);
    return { live: row.strands.some((strand) => strand.state === "running"), workers };
  };
}

export function StrandsPage({ view, tab: initialTab = "now" }: { view: BotView; tab?: StrandsTab }) {
  const bot = view.bot!;
  const zone = useTodosZone();
  const rowOpen = useRowOpen();
  const navigate = useBbNavigate();
  // Areas are the primary Bot's: its leads and runners report them.
  const primary = bot.primary !== false;
  const [tab, setTab] = useState<StrandsTab>(initialTab);
  const overview = useLive("strands.overview", { botId: bot.id }, { pollMs: 30_000 });
  const areas = useLive("areas.list", {}, { enabled: primary, pollMs: 60_000 });
  const scheduledList = useLive("loops.scheduled", {}, { pollMs: 60_000 });
  // An automation's schedule is a task row; its Runs open that row.
  const list = useLive("tasks.list", {}, { enabled: tab === "scheduled", pollMs: 60_000 });
  const automationList = useAutomations(bot.id);
  const editor = useAutomationEditor(bot.id, automationList.data?.automations ?? [], () => { automationList.refresh(); scheduledList.refresh(); });
  const [query, setQuery] = useBotPageQuery();
  const [unfolded, setUnfolded] = useState(false);
  const now = useNow(60_000);
  const searching = !!query.trim();
  const shownAreas = useMemo(() => {
    const all = areas.data?.areas ?? null;
    if (!all || !searching) return all;
    const words = query.trim().toLowerCase().split(/\s+/);
    return all.filter((a) => words.every((w) => [a.name, a.covers, a.now ?? "", a.ownerName, ...a.open.map((i) => i.title)].join(" ").toLowerCase().includes(w)));
  }, [areas.data, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const workOf = useMemo(() => areaWork(overview.data?.conversations), [overview.data]);
  const openTask = (task: Pick<Task, "id" | "title">, event?: MouseEvent) => rowOpen({ kind: "todo", id: task.id }, task.title).onOpen(event as never);
  const isOpen = (id: string) => rowOpen({ kind: "todo", id }).selected;
  const openThread = (threadId: string) => navigate.toThread(threadId);

  const scheduled = useMemo(() => (scheduledList.data?.items ?? []).filter((item) => item.source === "automation" && item.botId === bot.id && (!searching || item.title.toLowerCase().includes(query.trim().toLowerCase()))),
    [scheduledList.data, bot.id, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const itemKey = (item: { id: string; botId: string | null }) => (item.id === "heartbeat" ? `heartbeat:${item.botId}` : item.id);
  const recurring = new Map((list.data?.tasks ?? []).filter((t) => t.automation?.role === "schedule").map((t) => [t.automation!.id, t]));
  const ready = !!scheduledList.data || !!scheduledList.error;
  const scheduledRows = foldRows(scheduled, unfolded);
  const anyScheduled = (scheduledList.data?.items ?? []).some((item) => item.source === "automation" && item.botId === bot.id);
  const tabs = {
    label: "View", value: tab, onChange: (next: StrandsTab) => setTab(next),
    options: [{ id: "now" as const, label: "Now" }, { id: "scheduled" as const, label: "Scheduled", ...(ready ? { count: scheduled.length } : {}) }],
  };
  const header = overviewLine(overview.data);

  return (
    <BotPageLayout testId="strands-page" title="Strands" bot={bot.name} botId={bot.id}
      toolbar={<BotPageToolbar search={{ value: query, onChange: setQuery, placeholder: tab === "now" ? "Search strands" : "Search scheduled" }} filter={tabs}
        newAction={tab === "now" ? undefined : <NewAutomationMenu kinds={newKinds(bot.kind === "external")} disabled={bot.state !== "active"} onPick={editor.openNew} />} />}>
      {tab === "now" ? <div data-studio-dense-cards="" data-testid="strands-now" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2.5">
          {header ? <p data-testid="strands-line" className="px-0.5 text-xs text-subtle-foreground">{header}</p> : null}
          <StrandsCards overview={overview} now={now} query={query} />
        </div>
        {primary ? <AreasSection areas={shownAreas} error={areas.error} query={searching} workOf={(area) => workOf(area.owner.kind === "lead" ? ownerThreadOf(area) : null)} now={now} zone={zone}
          onOpenTask={(id, title, event) => openTask({ id, title }, event)} isOpen={isOpen} onOpenThread={openThread} /> : null}
      </div> : null}
      {tab === "scheduled" && ready ? (
        <BotPageGroup title="Scheduled" count={scheduled.length} testId="tasks-scheduled">
          {editor.error ? <p role="alert" className="pb-2 text-xs text-destructive">{editor.error}</p> : null}
          {scheduledList.error && !scheduledList.data ? <p role="alert" data-testid="scheduled-error" className="pb-2 text-xs text-destructive">{scheduledList.error}</p> : null}
          {scheduledRows.shown.map((item) => {
            const parent = recurring.get(itemKey(item));
            const severity = parent?.automation?.severity ?? null;
            const last = parent?.progress.line ? `${severity ? `${SEVERITY_LABEL[severity]} · ` : ""}${parent.progress.line}` : null;
            const runs = parent ? rowOpen({ kind: "todo", id: parent.id }, parent.title) : null;
            return (
              <BotPageRow key={item.key} testId="scheduled-row" data={{ "data-scheduled": item.key, ...(parent ? { "data-task": parent.id } : {}) }} icon={SCHEDULED_ICON[item.kind]} muted={item.state === "paused"}
                title={item.title} titleText={last ? `${item.title} · Last: ${last}` : item.title} meta={scheduledMeta(item, now, zone)} {...rowOpen(item.link, item.title)}
                columns={last ? [{ key: "last", content: <span data-testid="scheduled-last" title={last}>{last}</span>, className: cn("max-w-[40%]", severity === "critical" ? "text-destructive" : /^Needs you/.test(parent?.progress.line ?? "") || severity === "warn" ? "text-warning" : "text-subtle-foreground") }] : undefined}
                actions={runs ? <Button type="button" variant="ghost" size="sm" data-testid="scheduled-runs" className="h-7 px-2 text-xs font-normal" aria-label={`Runs: ${item.title}`} onClick={(event) => runs.onOpen(event)}>Runs</Button> : undefined} />
            );
          })}
          {!scheduled.length && !(scheduledList.error && !scheduledList.data) ? <BotPageEmpty testId="scheduled-empty" {...(searching && anyScheduled ? { title: noMatch("scheduled items", query) } : { title: "Nothing scheduled yet", hint: "Add a reminder or a check-in with New." })} /> : null}
          {scheduledRows.more ? <BotPageMore count={scheduledRows.more} group="Scheduled" testId="tasks-more" onOpen={() => setUnfolded(true)} /> : null}
        </BotPageGroup>
      ) : null}
      {editor.dialogs}
    </BotPageLayout>
  );
}
