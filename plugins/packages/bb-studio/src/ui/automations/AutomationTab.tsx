import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { GHOST_BUTTON, openAppPath } from "../../kit/app/index";
import { Icon } from "../../kit/ui/index";
import { parseAutomationRefId, type AutomationTableRow } from "../../automation-table-contract";
import { NotFoundTab } from "../../links/NotFoundTab";
import { linkFor } from "../../links/router";
import { AutomationDetail, useAutomationEditor, useAutomations } from "../bot/Automations";
import { useOpenThread } from "../bot/workspace";
import { BotItemDetail, BotItemError } from "../bot-page/BotItemDetail";
import { useLive } from "../live";
import { bbDetailPath, KIND_LABEL, lastRunText, statusText } from "./automation-text";

const refId = (params: JsonValue | null): string | null => {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  return typeof params.id === "string" && params.id ? params.id : null;
};

export function AutomationTab({ params }: { params: JsonValue | null }) {
  const id = refId(params);
  const ref = parseAutomationRefId(id);
  if (!id || !ref) return <NotFoundTab params={{ kind: "automation", id, link: id ? linkFor({ kind: "automation", id }) : "bb://automation" }} />;
  return <AutomationItem key={id} botId={ref.botId} rowId={ref.rowId} />;
}

function AutomationItem({ botId, rowId }: { botId: string; rowId: string }) {
  const table = useLive("bot_automation_table", { botId }, { pollMs: 30_000 });
  const views = useAutomations(botId);
  const bots = useLive("bot_list", {}, { pollMs: 60_000 });
  const editor = useAutomationEditor(botId, views.data?.automations ?? [], () => { table.refresh(); views.refresh(); });
  const openThread = useOpenThread();
  const row = table.data?.rows.find((each) => each.id === rowId) ?? null;
  if (table.error && !table.data) return <BotItemError message={table.error} />;
  if (table.data && !row) return <AutomationDeleted />;
  if (!row) return null;
  const bot = bots.data?.bots.find((each) => each.id === botId) ?? null;
  const view = views.data?.automations.find((each) => each.id === row.id) ?? null;
  const own = view && !row.readOnly && row.kind !== "bb";
  const bb = row.kind === "bb" && row.bb && !row.readOnly && table.data?.bbPlugin === "on" ? row.bb : null;
  return (
    <BotItemDetail testId="automation-tab" title={row.name} facts={[
      { label: "Kind", value: KIND_LABEL[row.kind] },
      { label: "Status", value: statusText(row) },
      { label: "When", value: row.when },
      { label: "Last run", value: lastRunText(row) },
    ]} actions={bb ? <button type="button" data-testid="automation-open-bb" className={GHOST_BUTTON} onClick={() => openAppPath(bbDetailPath(bb))}><Icon name="Workflow" />Open in Automations</button> : undefined}>
      <div data-testid="automation-detail">
        {editor.error ? <p role="alert" className="pb-2 text-xs text-destructive">{editor.error}</p> : null}
        {own
          ? <AutomationDetail botId={botId} automation={view} busy={editor.busy} disabled={bot ? bot.state !== "active" : true} onOpen={openThread} {...editor.actions(view)} />
          : <ReadOnlyDetail row={row} onOpen={openThread} />}
      </div>
      {editor.dialogs}
    </BotItemDetail>
  );
}

export const AUTOMATION_DELETED = "Automation deleted";

export function AutomationDeleted() {
  return (
    <div data-testid="automation-deleted" className="studio-root flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
      <Icon name="Clock" className="size-8 text-muted-foreground" />
      <div className="text-base font-medium">{AUTOMATION_DELETED}</div>
    </div>
  );
}

function ReadOnlyDetail({ row, onOpen }: { row: AutomationTableRow; onOpen(threadId: string): void }) {
  return (
    <div data-testid="automation-read-only" className="flex flex-col gap-2">
      {row.script ? <pre className="max-h-32 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs whitespace-pre-wrap">{row.script}</pre> : null}
      {row.instruction ? <p className="max-h-40 overflow-auto text-xs whitespace-pre-wrap">{row.instruction}</p> : null}
      {row.threadId ? <div><button type="button" className={GHOST_BUTTON} onClick={() => onOpen(row.threadId!)}><Icon name="MessageSquare" />Thread</button></div> : null}
    </div>
  );
}
