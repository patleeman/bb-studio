// Bot settings ▸ Main conversation: which of the Bot's conversations is its
// Main (where check-ins, runners and automations report). Any active
// conversation of the Bot can be picked (bot_make_main, the same as "Make this
// the Main" in a thread's menu), or "Start a new Main" (bot_new_main). The
// old Main stays an ordinary conversation. With no Main (deleted, archived,
// or never made), the row says so and offers the same choices: it never
// shows an error in place of the picker.
import { useState } from "react";
import { errorMessage } from "../../kit/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../kit/ui/index";
import { useCall, useLive } from "../live";

export const NEW_MAIN = "__new_main__";
const NO_MAIN = "__no_main__";

type Conversation = { threadId: string; title: string; isMain: boolean; archivedAt: number | null };

/** The picker's rows: the Bot's active conversations, the Main first, then by title. Archived ones can't be Main. */
export function mainChoices(conversations: readonly Conversation[], mainThreadId: string | null): { value: string; label: string }[] {
  const active = conversations.filter((each) => each.archivedAt == null);
  const main = active.find((each) => each.threadId === mainThreadId || each.isMain);
  const label = (each: Conversation) => each.title.trim() || "Untitled conversation";
  const rest = active.filter((each) => each !== main).sort((a, b) => label(a).localeCompare(label(b)));
  return [...(main ? [main] : []), ...rest].map((each) => ({ value: each.threadId, label: label(each) }));
}

/** The value the picker shows: the Main when it is listed, else "No Main". */
export function shownMain(choices: readonly { value: string }[], mainThreadId: string | null): string {
  return mainThreadId && choices.some((each) => each.value === mainThreadId) ? mainThreadId : NO_MAIN;
}

export function MainPicker({ botId, botName, mainThreadId, disabled, onChanged }: { botId: string; botName: string; mainThreadId: string | null; disabled?: boolean; onChanged(): void }) {
  const call = useCall();
  const all = useLive("bot_conversations_all", { botId }, { pollMs: 30_000 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = mainChoices(all.data?.conversations ?? [], mainThreadId);
  const value = shownMain(choices, mainThreadId);
  const pick = async (next: string) => {
    if (next === value || next === NO_MAIN || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (next === NEW_MAIN) await call("bot_new_main", { botId });
      else await call("bot_make_main", { botId, threadId: next });
      all.refresh();
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause) || "Couldn't change the Main.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5" data-testid="main-picker">
      <Select value={value} disabled={!!disabled || busy} onValueChange={(next) => void pick(next)}>
        <SelectTrigger aria-label={`${botName}'s Main conversation`} className="h-8 w-72 max-w-full text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {value === NO_MAIN ? <SelectItem value={NO_MAIN} disabled>No Main: pick one</SelectItem> : null}
          {choices.map((each) => <SelectItem key={each.value} value={each.value}>{each.label}</SelectItem>)}
          <SelectItem value={NEW_MAIN}>Start a new Main</SelectItem>
        </SelectContent>
      </Select>
      {value === NO_MAIN && !busy ? <p className="text-xs text-muted-foreground" data-testid="main-picker-none">{botName} has no Main right now. Pick a conversation or start a new one; check-ins and reports wait until it has one.</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
