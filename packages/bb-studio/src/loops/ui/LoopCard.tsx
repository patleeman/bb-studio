import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "../../kit/ui/index";
import { CHAT_CARD_ACTION, ChatCard, ChatCardHeader } from "../../kit/app/chat-card";
import { useLive } from "../../ui/live";
import { useLoopPeople, useOpenLoopsPane } from "./hooks";

export function LoopsDirective({ attributes }: PluginMessageDirectiveProps) {
  if (attributes.open !== undefined) return <LoopsOpenCard />;
  const more = Number.parseInt(attributes.more ?? "", 10);
  if (!Number.isFinite(more) || more <= 0) return null;
  return <LoopsMore more={more} />;
}

function LoopsMore({ more }: { more: number }) {
  const people = useLoopPeople();
  const openPane = useOpenLoopsPane();
  return (
    <button type="button" data-testid="loops-more" onClick={() => openPane(people.botId)}
      className="group flex h-8 w-full max-w-3xl items-center gap-2.5 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground">
      <Icon name="ListTodo" className="size-4 shrink-0" />
      <span className="flex-1">{more} more in Tasks</span>
      <Icon name="ChevronRight" className="size-3.5" />
    </button>
  );
}

export function loopsSummary(groups: { needsYouNow: unknown[]; comingUp: unknown[]; agentsOnIt: unknown[]; waitingOnOthers: unknown[] } | null | undefined): string {
  if (!groups) return "";
  const parts = [
    groups.needsYouNow.length ? `${groups.needsYouNow.length} need${groups.needsYouNow.length === 1 ? "s" : ""} you` : "",
    groups.comingUp.length ? `${groups.comingUp.length} coming up` : "",
    groups.agentsOnIt.length ? `${groups.agentsOnIt.length} with agents` : "",
    groups.waitingOnOthers.length ? `${groups.waitingOnOthers.length} waiting on others` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No tasks";
}

function LoopsOpenCard() {
  const people = useLoopPeople();
  const openPane = useOpenLoopsPane();
  const list = useLive("loops.list", {}, { pollMs: 60_000 });
  const summary = loopsSummary(list.data);
  return (
    <ChatCard data-testid="loops-open">
      <ChatCardHeader icon="ListTodo" title="Tasks" meta={summary || undefined}
        actions={<button type="button" className={CHAT_CARD_ACTION} onClick={() => openPane(people.botId)}><Icon name="PanelRight" />Open Tasks</button>} />
    </ChatCard>
  );
}
