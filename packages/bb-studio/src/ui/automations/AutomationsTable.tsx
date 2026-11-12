// The Bot's Automations page (design 7b), on the Bot-page template
// (src/ui/bot-page): one list of every automation that belongs to the Bot (`bot_automation_table`,
// src/automation-table.ts): its watchers, check-ins, reminders, runners, the
// heartbeat and maintenance, and bb's own automations attributed to it.
// Paused, disabled and finished ones stay listed. Search and the kind
// pills narrow it; New makes a Studio automation. Each row is one line: its
// name and status, then its Kind, When and Last run columns.
//
// A row opens the automation as a tab in the workbench beside the page
// (AutomationTab.tsx): Studio's own detail (Pause or Resume, Run now, Edit,
// Delete, recent runs) when `bot_automations` has it; otherwise, and for
// every row that is "in bb" on a mirrored install, what it does and its thread.
import { useState } from "react";
import { relativeTime } from "../../kit/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon } from "../../kit/ui/index";
import { KIND, newKinds, useAutomationEditor, useAutomations } from "../bot/Automations";
import { automationRefId, type AutomationTableKind, type AutomationTableRow } from "../../automation-table-contract";
import { BotPageColumns, BotPageEmpty, BotPageLayout, BotPageNewButton, BotPageRow, BotPageToolbar, useRowOpen } from "../bot-page";
import { useLive } from "../live";

const KINDS: AutomationTableKind[] = ["watcher", "checkin", "schedule", "reminder", "runner", "bb"];
export const KIND_LABEL: Record<AutomationTableKind, string> = { watcher: "Watcher", checkin: "Check-in", schedule: "Schedule", reminder: "Reminder", runner: "Runner", bb: "bb automation" };
const FILTER_LABEL: Record<AutomationTableKind, string> = { watcher: "Watchers", checkin: "Check-ins", schedule: "Schedules", reminder: "Reminders", runner: "Runners", bb: "bb automations" };

/** "Active", "Paused", "Paused · in bb" or "Off". */
export function statusText(row: Pick<AutomationTableRow, "status" | "inBb">): string {
  if (row.status === "active") return "Active";
  if (row.status === "off") return "Off";
  return row.inBb ? "Paused · in bb" : "Paused";
}

/** "2h ago", or "Never". */
export const lastRunText = (row: Pick<AutomationTableRow, "lastRunAt">, now = Date.now()) => (row.lastRunAt ? relativeTime(row.lastRunAt, now) : "Never");

/** bb's own page for one of its automations (its automations plugin's detail route). */
export const bbDetailPath = (bb: { id: string; projectId: string }) => `/plugins/automations/automations/${encodeURIComponent(bb.projectId)}/${encodeURIComponent(bb.id)}`;

/** The kinds' icons on their rows. */
const KIND_ICON: Record<AutomationTableKind, string> = { watcher: "Eye", checkin: "MessageSquare", schedule: "Calendar", reminder: "Clock", runner: "Repeat", bb: "Workflow" };

/** The meta columns, right-aligned after the name; the header uses the same widths. */
const COLUMNS = [
  { key: "kind", label: "Kind", className: "w-28" },
  { key: "when", label: "When", className: "w-48 @max-2xl/bot-page:hidden" },
  { key: "last", label: "Last run", className: "w-24" },
] as const;

/**
 * The Automations page on the Bot-page template, for one Bot, named in its
 * header.
 */
export function AutomationsTable({ botId, botName, disabled, external }: { botId: string; botName: string; disabled: boolean; external: boolean }) {
  const table = useLive("bot_automation_table", { botId }, { pollMs: 30_000 });
  const views = useAutomations(botId);
  const editor = useAutomationEditor(botId, views.data?.automations ?? [], () => { table.refresh(); views.refresh(); });
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AutomationTableKind | "all">("all");
  const rowOpen = useRowOpen();
  const rows = table.data?.rows ?? [];
  const kinds = KINDS.filter((each) => rows.some((row) => row.kind === each));
  const words = query.trim().toLowerCase();
  const shown = rows.filter((row) => (kind === "all" || row.kind === kind) && (!words || row.name.toLowerCase().includes(words)));
  const newKindsShown = newKinds(external);
  return (
    <BotPageLayout testId="automations-panel" title="Automations" bot={botName} botId={botId}
      toolbar={<BotPageToolbar<AutomationTableKind | "all"> search={{ value: query, onChange: setQuery, placeholder: "Search automations" }}
        filter={{ label: "Kind", value: kind, options: [{ id: "all", label: "All" }, ...kinds.map((each) => ({ id: each, label: FILTER_LABEL[each] }))], onChange: setKind }}
        newAction={(
          <DropdownMenu>
            <DropdownMenuTrigger asChild><BotPageNewButton disabled={disabled} /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {newKindsShown.map((each) => <DropdownMenuItem key={each} onSelect={() => editor.openNew(each)}><Icon name={KIND[each].icon} />{KIND[each].label}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )} />}>
      <section aria-label="Automations" data-testid="automations-table" className="flex flex-col">
        {editor.error ? <p role="alert" className="pb-2 text-xs text-destructive">{editor.error}</p> : null}
        {table.error && !table.data ? <p role="alert" className="pb-2 text-xs text-destructive">{table.error}</p> : null}
        {shown.length ? <>
          <BotPageColumns title="Name" columns={COLUMNS} />
          <div role="rowgroup" className="flex flex-col gap-px pt-1">
            {shown.map((row) => (
              <BotPageRow key={row.id} testId="automation-row" data={{ "data-automation": row.id, "data-kind": row.kind, "data-status": row.status, "data-read-only": row.readOnly ? "" : undefined }}
                icon={KIND_ICON[row.kind]} title={row.name} titleText={row.name} muted={row.status !== "active"}
                status={{ label: statusText(row), tone: row.status === "active" ? "success" : "neutral" }}
                columns={[
                  { key: "kind", className: COLUMNS[0].className, content: KIND_LABEL[row.kind] },
                  { key: "when", className: COLUMNS[1].className, content: row.when },
                  { key: "last", className: COLUMNS[2].className, content: <span className="inline-flex items-center justify-end gap-1">
                    {row.lastRun === "ok" ? <Icon name="Check" className="size-3 text-success" aria-label="Succeeded" /> : row.lastRun === "failed" ? <Icon name="X" className="size-3 text-destructive" aria-label="Failed" /> : null}
                    {lastRunText(row)}
                  </span> },
                ]}
                {...rowOpen({ kind: "automation", id: automationRefId(botId, row.id) }, row.name)} />
            ))}
          </div>
        </> : <BotPageEmpty>{table.loading && !table.data ? "Loading…" : "No automations"}</BotPageEmpty>}
      </section>
      {editor.dialogs}
    </BotPageLayout>
  );
}
