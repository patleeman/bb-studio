import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { openAppPath } from "../../kit/app/index";
import { Icon } from "../../kit/ui/index";
import { parseAutomationRefId, type AutomationTableRow } from "../../automation-table-contract";
import { NotFoundTab } from "../../links/NotFoundTab";
import { linkFor } from "../../links/router";
import type { BotAutomationView } from "../../contract";
import { CARD_GHOST } from "../../loops/ui/LoopMenus";
import { AutomationActions, instructionLabel, RecentRuns, useAutomationEditor, useAutomations } from "../bot/Automations";
import { useOpenThread } from "../bot/workspace";
import { BotItemDetail, BotItemError, type BotPageFact } from "../bot-page/BotItemDetail";
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
  const own = view && !row.readOnly && row.kind !== "bb" ? view : null;
  const bb = row.kind === "bb" && row.bb && !row.readOnly && table.data?.bbPlugin === "on" ? row.bb : null;
  const facts: BotPageFact[] = [
    { label: "Kind", value: KIND_LABEL[row.kind] },
    { label: "Status", value: statusText(row) },
    { label: "When", value: row.when },
    { label: "Last run", value: lastRunText(row) },
    ...(own ? ownFacts(own) : readOnlyFacts(row)),
  ];
  const actions = own
    ? <AutomationActions automation={own} busy={editor.busy} disabled={bot ? bot.state !== "active" : true} onOpen={openThread} buttonClass={CARD_GHOST} {...editor.actions(own)} />
    : <>
      {bb ? <button type="button" data-testid="automation-open-bb" className={CARD_GHOST} onClick={() => openAppPath(bbDetailPath(bb))}><Icon name="Workflow" />Open in Automations</button> : null}
      {row.threadId ? <button type="button" className={CARD_GHOST} onClick={() => openThread(row.threadId!)}><Icon name="MessageSquare" />Thread</button> : null}
    </>;
  return (
    <BotItemDetail testId="automation-tab" title={row.name} facts={facts}
      actions={own || bb || row.threadId ? <>
        {actions}
        {editor.error ? <p role="alert" className="w-full text-xs text-destructive">{editor.error}</p> : null}
      </> : undefined}
      after={own ? <RecentRuns botId={botId} id={own.id} onOpen={openThread} title="Recent runs" empty={null} /> : undefined}>
      {editor.dialogs}
    </BotItemDetail>
  );
}

const SCRIPT = "max-h-40 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs whitespace-pre-wrap";

function ownFacts(automation: BotAutomationView): BotPageFact[] {
  return [
    ...(automation.kind === "watcher" && automation.script ? [{ label: "Script", value: <pre className={SCRIPT}>{automation.script.body}</pre> }] : []),
    ...(automation.instruction ? [{ label: instructionLabel(automation.kind), value: <span className="whitespace-pre-wrap">{automation.instruction}</span> }] : []),
    ...(automation.model?.model ? [{ label: "Model", value: `${automation.model.model}${automation.model.reasoning ? ` · ${automation.model.reasoning}` : ""}` }] : []),
  ];
}

function readOnlyFacts(row: AutomationTableRow): BotPageFact[] {
  return [
    ...(row.script ? [{ label: "Script", value: <pre className={SCRIPT}>{row.script}</pre> }] : []),
    ...(row.instruction ? [{ label: "Instruction", value: <span className="whitespace-pre-wrap">{row.instruction}</span> }] : []),
  ];
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
