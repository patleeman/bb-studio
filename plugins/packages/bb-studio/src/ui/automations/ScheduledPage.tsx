// A Bot's Scheduled page (`studio/automations`): its check-ins, reminders,
// watchers and runners (`loops.scheduled`), with New and each one's Runs.
import { useMemo, useState } from "react";
import { useNow } from "../../kit/app/visible-poll";
import { Button } from "../../kit/ui/button";
import { cn } from "../../kit/ui/utils";
import type { BotView } from "../../contract";
import { BotPageEmpty, BotPageGroup, BotPageLayout, BotPageMore, BotPageRow, BotPageToolbar, foldRows, noMatch, useBotPageQuery, useRowOpen } from "../bot-page";
import { useLive } from "../live";
import { SEVERITY_LABEL } from "../../tasks/ui/model";
import { SCHEDULED_ICON, scheduledMeta } from "../../loops/ui/scheduled-model";
import { NewAutomationMenu, newKinds, useAutomationEditor, useAutomations } from "../bot/Automations";
import { useTodosZone } from "../../loops/ui/hooks";

export function ScheduledPage({ view }: { view: BotView }) {
  const bot = view.bot!;
  const zone = useTodosZone();
  const rowOpen = useRowOpen();
  const scheduledList = useLive("loops.scheduled", {}, { pollMs: 60_000 });
  // An automation's schedule is a task row; its Runs open that row.
  const list = useLive("tasks.list", {}, { pollMs: 60_000 });
  const automationList = useAutomations(bot.id);
  const editor = useAutomationEditor(bot.id, automationList.data?.automations ?? [], () => { automationList.refresh(); scheduledList.refresh(); });
  const [query, setQuery] = useBotPageQuery();
  const [unfolded, setUnfolded] = useState(false);
  const now = useNow(60_000);
  const searching = !!query.trim();

  const scheduled = useMemo(() => (scheduledList.data?.items ?? []).filter((item) => item.source === "automation" && item.botId === bot.id && (!searching || item.title.toLowerCase().includes(query.trim().toLowerCase()))),
    [scheduledList.data, bot.id, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const itemKey = (item: { id: string; botId: string | null }) => (item.id === "heartbeat" ? `heartbeat:${item.botId}` : item.id);
  const recurring = new Map((list.data?.tasks ?? []).filter((t) => t.automation?.role === "schedule").map((t) => [t.automation!.id, t]));
  const ready = !!scheduledList.data || !!scheduledList.error;
  const scheduledRows = foldRows(scheduled, unfolded);
  const anyScheduled = (scheduledList.data?.items ?? []).some((item) => item.source === "automation" && item.botId === bot.id);

  return (
    <BotPageLayout testId="scheduled-page" title="Scheduled" bot={bot.name} botId={bot.id}
      toolbar={<BotPageToolbar search={{ value: query, onChange: setQuery, placeholder: "Search scheduled" }}
        newAction={<NewAutomationMenu kinds={newKinds(bot.kind === "external")} disabled={bot.state !== "active"} onPick={editor.openNew} />} />}>
      {ready ? (
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
