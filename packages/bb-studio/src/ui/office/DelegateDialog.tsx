// Hand work to a bot. Who, what, and when; the bot works on its own and
// reports to the Inbox. Context items ride along, and the result comes back
// to the folder the work came from.
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@bb-studio/kit/ui";
import { GHOST_BUTTON, PRIMARY_BUTTON } from "@bb-studio/kit/app";
import { useEffect, useId, useState } from "react";
import { Face } from "./Face";
import { useCall, type TeamBot } from "./model";
import { cn } from "./styles";

const SCHEDULES = [
  { id: "once", label: "Now, once" },
  { id: "hourly", label: "Every hour" },
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Every week" },
] as const;

export interface DelegateContext {
  ref: string;
  title: string;
  projectId: string | null;
}

export function DelegateDialog({ open, onOpenChange, bots, initialBotId, context, onDelegated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bots: TeamBot[];
  initialBotId?: string | null;
  context?: DelegateContext | null;
  onDelegated?: (result: { taskId: string; botId: string }) => void;
}) {
  const call = useCall();
  const briefId = useId();
  const whenId = useId();
  const [botId, setBotId] = useState<string | null>(initialBotId ?? bots[0]?.id ?? null);
  const [brief, setBrief] = useState("");
  const [schedule, setSchedule] = useState<(typeof SCHEDULES)[number]["id"]>("once");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBotId(initialBotId ?? bots[0]?.id ?? null);
    setBrief(context ? `Finish this: ${context.title}` : "");
    setSchedule("once");
    setError(null);
  }, [open, initialBotId, context, bots]);

  const submit = async () => {
    if (!botId || !brief.trim()) return;
    setBusy(true); setError(null);
    try {
      const result = await call("delegate", {
        botId,
        brief: brief.trim(),
        ...(context ? { context: [context.ref], folderId: context.projectId } : {}),
        ...(schedule === "once" ? {} : { schedule }),
      }) as { taskId: string };
      onDelegated?.({ taskId: result.taskId, botId });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
          <DialogTitle>Hand off work</DialogTitle>
          <DialogDescription>
            {context ? <>With <span className="text-foreground">{context.title}</span> as context. </> : null}
            The bot works on its own and reports to your Inbox.
          </DialogDescription>

          <fieldset className="mt-4">
            <legend className="mb-2 text-xs font-medium text-muted-foreground">Who</legend>
            {bots.length
              ? <div role="radiogroup" className="flex flex-wrap gap-1.5">
                  {bots.map((bot) => (
                    <button
                      key={bot.id}
                      type="button"
                      role="radio"
                      aria-checked={bot.id === botId}
                      onClick={() => setBotId(bot.id)}
                      className={cn(
                        "flex h-8 items-center gap-1.5 rounded-full border py-0.5 pr-3 pl-0.5 text-sm",
                        bot.id === botId ? "border-foreground/60 bg-state-active" : "border-border hover:bg-state-hover",
                      )}
                    >
                      <Face name={bot.name} avatar={bot.avatar} size="sm" />
                      {bot.name}
                    </button>
                  ))}
                </div>
              : <p className="text-sm text-muted-foreground">This space has no bots yet.</p>}
          </fieldset>

          <label htmlFor={briefId} className="mt-4 mb-2 block text-xs font-medium text-muted-foreground">What</label>
          <textarea
            id={briefId}
            autoFocus
            value={brief}
            onChange={(change) => setBrief(change.target.value)}
            onKeyDown={(key) => { if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) void submit(); }}
            placeholder="Describe the outcome you want."
            className="min-h-24 w-full resize-y rounded-md border border-border bg-background p-2 text-sm"
          />

          <label htmlFor={whenId} className="mt-4 mb-2 block text-xs font-medium text-muted-foreground">When</label>
          <select id={whenId} value={schedule} onChange={(change) => setSchedule(change.target.value as typeof schedule)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
            {SCHEDULES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>

          {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className={GHOST_BUTTON}>Cancel</button>
            <button type="button" disabled={busy || !botId || !brief.trim()} onClick={() => void submit()} className={PRIMARY_BUTTON}>Delegate</button>
          </div>
        </DialogContent>
    </Dialog>
  );
}
