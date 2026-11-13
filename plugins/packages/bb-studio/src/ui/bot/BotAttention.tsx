// Bot ▸ Controls ▸ Attention: how often the Chief of Staff may interrupt
// with Todos. Its daily budget and quiet hours are Studio settings
// (loopDailyBudget, loopQuietStart, loopQuietEnd; src/settings/schema.ts);
// the time zone is this Mac's. Todo reminders (loopsEnabled) is the switch
// for all of it; the Todos list works either way.
import { useState } from "react";
import { errorMessage } from "../../kit/format";
import { cn, Icon, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../kit/ui/index";
import { STUDIO_SETTINGS } from "../../settings/schema";
import { Switch } from "../../settings/ui/controls";
import { useStudioSettings } from "../../settings/ui/use-settings";

/** "10:00 PM" for hour 22. */
export function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:00 ${suffix}`;
}

/** Whether `hour` is inside quiet hours from `start` to `end` (which may cross midnight). */
export function isQuietHour(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** "New York (EST), from this Mac". */
function zoneWords(zone: string | null): string {
  if (!zone) return "From this Mac";
  const city = zone.split("/").pop()!.replace(/_/g, " ");
  const short = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value;
  return `${city}${short ? ` (${short})` : ""}, from this Mac`;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function BotAttention(_props: { botName: string }) {
  const { values, set, timeZone, error: loadError } = useStudioSettings();
  const [error, setError] = useState<string | null>(null);
  if (!values) return <p className={cn("text-sm", loadError ? "text-destructive" : "text-muted-foreground")}>{loadError ?? "Loading…"}</p>;
  const save = (patch: Record<string, number | boolean>) => { setError(null); set(patch).catch((cause: unknown) => setError(errorMessage(cause))); };
  const budget = values.loopDailyBudget;
  const start = values.loopQuietStart;
  const end = values.loopQuietEnd;
  const max = STUDIO_SETTINGS.loopDailyBudget.max;
  return (
    <div className="flex flex-col gap-3" data-testid="bot-attention">
      <div className="divide-y divide-border rounded-lg border border-border">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">{STUDIO_SETTINGS.loopsEnabled.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{STUDIO_SETTINGS.loopsEnabled.description}</div>
          </div>
          <Switch checked={values.loopsEnabled} label={STUDIO_SETTINGS.loopsEnabled.label} onChange={(next) => save({ loopsEnabled: next })} />
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3" data-testid="attention-budget">
          <div className="min-w-0">
            <div className="text-sm font-medium">{STUDIO_SETTINGS.loopDailyBudget.label}</div>
          </div>
          <div className="inline-flex items-center rounded-md border border-border">
            <button type="button" aria-label="Fewer interruptions" disabled={budget <= 0} onClick={() => save({ loopDailyBudget: budget - 1 })} className="px-2.5 py-1 text-muted-foreground hover:text-foreground disabled:opacity-40"><Icon name="Minus" className="size-3.5" /></button>
            <span className="min-w-8 text-center text-sm tabular-nums" aria-live="polite">{budget}</span>
            <button type="button" aria-label="More interruptions" disabled={budget >= max} onClick={() => save({ loopDailyBudget: budget + 1 })} className="px-2.5 py-1 text-muted-foreground hover:text-foreground disabled:opacity-40"><Icon name="Plus" className="size-3.5" /></button>
          </div>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3" data-testid="attention-quiet">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium">Quiet hours</div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <HourSelect label="Quiet hours start" value={start} onChange={(hour) => save({ loopQuietStart: hour })} />
              <span className="text-muted-foreground">to</span>
              <HourSelect label="Quiet hours end" value={end} onChange={(hour) => save({ loopQuietEnd: hour })} />
            </div>
          </div>
          <div aria-hidden>
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div>
            <div className="mt-1 flex gap-0.5">
              {HOURS.map((hour) => <div key={hour} className={cn("h-3 flex-1 rounded-sm", isQuietHour(hour, start, end) ? "bg-primary/40" : "bg-muted")} />)}
            </div>
            <div className="mt-1.5 flex gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-primary/40" />Quiet</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-muted" />May interrupt</span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3" data-testid="attention-zone">
          <div className="min-w-0">
            <div className="text-sm font-medium">Time zone</div>
            <div className="mt-0.5 text-xs text-muted-foreground">To use another, set STUDIO_LOOP_TIME_ZONE on the BB host.</div>
          </div>
          <span className="text-sm text-muted-foreground">{zoneWords(timeZone)}</span>
        </div>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function HourSelect({ label, value, onChange }: { label: string; value: number; onChange(hour: number): void }) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger aria-label={label} className="h-8 w-28 text-sm"><SelectValue /></SelectTrigger>
      <SelectContent>{HOURS.map((hour) => <SelectItem key={hour} value={String(hour)}>{hourLabel(hour)}</SelectItem>)}</SelectContent>
    </Select>
  );
}
