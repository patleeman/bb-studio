// The schedule editor for a Bot's automations (src/schedule.ts): presets,
// day chips, several times a day or every N minutes/hours in an active
// window, quiet hours, an end date, the timezone and a raw cron (Advanced).
// A one-time schedule (reminders) is a date and time with quick picks.
// Below it, the schedule in words and how many BB automations it becomes.
import { Input } from "@bb-studio/kit/ui";
import { useMemo } from "react";
import { ALL_DAYS, compileSchedule, describeSchedule, localZone, SCHEDULE_PRESETS, type Schedule, type Weekday } from "../../schedule";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CHIP = "inline-flex h-7 items-center rounded-md border border-border px-2 text-xs hover:bg-state-hover aria-pressed:border-foreground/40 aria-pressed:bg-state-active aria-pressed:font-medium disabled:opacity-50";
const FIELD = "h-8 rounded-md border border-border bg-background px-2 text-sm";
type Repeating = Exclude<Schedule, { type: "once" }>;

/** A local datetime-local value for an epoch ms. */
const localInput = (at: number) => { const d = new Date(at - new Date(at).getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16); };
const zones = (() => { try { return (Intl as unknown as { supportedValuesOf?(key: string): string[] }).supportedValuesOf?.("timeZone") ?? []; } catch { return []; } })();

/** The schedule's words and BB triggers, or why it can't be made. */
export function schedulePreview(schedule: Schedule): { text: string; detail: string; error: string | null } {
  try {
    const triggers = compileSchedule(schedule);
    const crons = triggers.flatMap((each) => each.triggerType === "schedule" ? [each.cron] : []);
    return { text: describeSchedule(schedule), detail: crons.length ? `${crons.join(" · ")}${crons.length > 1 ? ` (${crons.length} automations, kept as one)` : ""}` : "Runs once.", error: null };
  } catch (error) {
    return { text: "", detail: "", error: (error as Error).message };
  }
}

export function ScheduleEditor({ value, onChange, once = false, disabled = false }: { value: Schedule; onChange(next: Schedule): void; once?: boolean; disabled?: boolean }) {
  const preview = useMemo(() => schedulePreview(value), [value]);
  if (once || value.type === "once") {
    const at = value.type === "once" ? value.at : Date.now() + 3_600_000;
    const tomorrow9 = new Date(); tomorrow9.setDate(tomorrow9.getDate() + 1); tomorrow9.setHours(9, 0, 0, 0);
    const picks: [string, number][] = [["In 30 min", Date.now() + 1_800_000], ["In 2 h", Date.now() + 7_200_000], ["Tomorrow 9:00", tomorrow9.getTime()]];
    return (
      <fieldset className="flex flex-col gap-2" disabled={disabled} aria-label="When">
        <div className="flex flex-wrap gap-1">
          {picks.map(([label, time]) => <button key={label} type="button" className={CHIP} onClick={() => onChange({ type: "once", at: Math.round(time / 60_000) * 60_000 })}>{label}</button>)}
        </div>
        <label className="flex items-center gap-2 text-sm"><span className="w-12 text-xs text-muted-foreground">At</span>
          <input type="datetime-local" aria-label="Date and time" className={FIELD} value={localInput(at)} onChange={(event) => { const next = new Date(event.target.value).getTime(); if (Number.isFinite(next)) onChange({ type: "once", at: next }); }} />
        </label>
        <Preview preview={preview} />
      </fieldset>
    );
  }
  const schedule = value as Repeating;
  const set = (patch: Partial<Repeating>) => onChange({ ...schedule, ...patch } as Schedule);
  const days = "days" in schedule ? schedule.days : ALL_DAYS;
  const mode = schedule.type;
  const toMode = (next: Repeating["type"]) => {
    const common = { ...(schedule.timezone ? { timezone: schedule.timezone } : {}), ...(schedule.quiet ? { quiet: schedule.quiet } : {}), ...(schedule.until ? { until: schedule.until } : {}) };
    if (next === "times") onChange({ type: "times", days, times: ["09:00"], ...common });
    if (next === "interval") onChange({ type: "interval", every: 30, unit: "minutes", days, from: "09:00", to: "18:00", ...common });
    if (next === "cron") {
      let cron = "0 9 * * 1-5";
      try { const first = compileSchedule(schedule)[0]; if (first?.triggerType === "schedule") cron = first.cron; } catch { /* Keep the default. */ }
      onChange({ type: "cron", cron, ...common, quiet: null });
    }
  };
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled} aria-label="Schedule">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Presets">
        {SCHEDULE_PRESETS.map((preset) => (
          <button key={preset.id} type="button" className={CHIP} aria-pressed={JSON.stringify({ ...preset.schedule, timezone: undefined }) === JSON.stringify({ ...schedule, timezone: undefined }) || undefined}
            onClick={() => onChange({ ...preset.schedule, ...(schedule.timezone ? { timezone: schedule.timezone } : {}) } as Schedule)}>{preset.label}</button>
        ))}
      </div>

      <div className="inline-flex w-fit rounded-md border border-border p-0.5" role="radiogroup" aria-label="Repeat">
        {([["times", "At times"], ["interval", "Every…"], ["cron", "Cron"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => mode !== id && toMode(id)}
            className="h-6 rounded px-2 text-xs text-muted-foreground aria-checked:bg-state-active aria-checked:font-medium aria-checked:text-foreground">{label}</button>
        ))}
      </div>

      {schedule.type !== "cron" ? (
        <div className="flex items-center gap-1" role="group" aria-label="Days">
          {DAY_LETTERS.map((letter, day) => {
            const on = days.includes(day as Weekday);
            return <button key={day} type="button" className={`${CHIP} w-7 justify-center px-0`} aria-pressed={on} aria-label={DAY_NAMES[day]} title={DAY_NAMES[day]}
              onClick={() => set({ days: (on ? days.filter((each) => each !== day) : [...days, day as Weekday]).sort() } as Partial<Repeating>)}>{letter}</button>;
          })}
        </div>
      ) : null}

      {schedule.type === "times" ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Times">
          {schedule.times.map((time, i) => (
            <span key={i} className="inline-flex items-center gap-0.5">
              <input type="time" aria-label={`Time ${i + 1}`} className={FIELD} value={time} onChange={(event) => set({ times: schedule.times.map((each, j) => j === i ? event.target.value : each) } as Partial<Repeating>)} />
              {schedule.times.length > 1 ? <button type="button" className="rounded px-1 text-xs text-muted-foreground hover:text-foreground" aria-label={`Remove ${time}`} onClick={() => set({ times: schedule.times.filter((_, j) => j !== i) } as Partial<Repeating>)}>×</button> : null}
            </span>
          ))}
          {schedule.times.length < 24 ? <button type="button" className={CHIP} onClick={() => set({ times: [...schedule.times, "12:00"] } as Partial<Repeating>)}>+ Time</button> : null}
        </div>
      ) : null}

      {schedule.type === "interval" ? (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-xs text-muted-foreground">Every</span>
          <input type="number" min={1} max={schedule.unit === "hours" ? 24 : 720} aria-label="Interval" className={`${FIELD} w-16`} value={schedule.every} onChange={(event) => set({ every: Math.max(1, Number(event.target.value) || 1) } as Partial<Repeating>)} />
          <select aria-label="Unit" className={FIELD} value={schedule.unit} onChange={(event) => set({ unit: event.target.value as "minutes" | "hours" } as Partial<Repeating>)}>
            <option value="minutes">minutes</option><option value="hours">hours</option>
          </select>
          <span className="text-xs text-muted-foreground">from</span>
          <input type="time" aria-label="Window start" className={FIELD} value={schedule.from ?? "00:00"} onChange={(event) => set({ from: event.target.value } as Partial<Repeating>)} />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="time" aria-label="Window end" className={FIELD} value={schedule.to ?? "23:59"} onChange={(event) => set({ to: event.target.value } as Partial<Repeating>)} />
        </div>
      ) : null}

      {schedule.type === "cron" ? (
        <label className="flex items-center gap-2"><span className="w-12 text-xs text-muted-foreground">Cron</span>
          <Input aria-label="Cron" className="font-mono" value={schedule.cron} onChange={(event) => set({ cron: event.target.value } as Partial<Repeating>)} placeholder="0 9 * * 1-5" />
        </label>
      ) : null}

      <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-2 gap-y-1.5 text-sm">
        {schedule.type !== "cron" ? <>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" aria-label="Quiet hours" checked={!!schedule.quiet} onChange={(event) => set({ quiet: event.target.checked ? { from: "22:00", to: "07:00" } : null })} />Quiet hours</label>
          {schedule.quiet ? (
            <span className="flex items-center gap-1.5">
              <input type="time" aria-label="Quiet from" className={FIELD} value={schedule.quiet.from} onChange={(event) => set({ quiet: { ...schedule.quiet!, from: event.target.value } })} />
              <span className="text-xs text-muted-foreground">to</span>
              <input type="time" aria-label="Quiet to" className={FIELD} value={schedule.quiet.to} onChange={(event) => set({ quiet: { ...schedule.quiet!, to: event.target.value } })} />
            </span>
          ) : <span className="text-xs text-muted-foreground">No runs skipped</span>}
        </> : null}
        <span className="text-xs text-muted-foreground">Ends</span>
        <span className="flex items-center gap-1.5">
          <input type="date" aria-label="End date" className={FIELD} value={schedule.until ?? ""} onChange={(event) => set({ until: event.target.value || null })} />
          {schedule.until ? <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => set({ until: null })}>Never</button> : null}
        </span>
        <span className="text-xs text-muted-foreground">Timezone</span>
        <span>
          <input list="studio-timezones" aria-label="Timezone" className={`${FIELD} w-full`} value={schedule.timezone ?? localZone()} onChange={(event) => set({ timezone: event.target.value })} />
          <datalist id="studio-timezones">{zones.map((zone) => <option key={zone} value={zone} />)}</datalist>
        </span>
      </div>
      <Preview preview={preview} />
    </fieldset>
  );
}

function Preview({ preview }: { preview: ReturnType<typeof schedulePreview> }) {
  if (preview.error) return <p role="alert" className="text-xs text-destructive">{preview.error}</p>;
  return (
    <p className="text-xs text-muted-foreground" data-testid="schedule-preview">
      <span className="text-foreground">{preview.text}</span>
      <span className="block font-mono text-[11px]">{preview.detail}</span>
    </p>
  );
}
