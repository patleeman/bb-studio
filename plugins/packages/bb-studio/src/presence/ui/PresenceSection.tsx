import { useState, type KeyboardEvent } from "react";
import { Button } from "../../kit/ui/button";
import { Input } from "../../kit/ui/input";
import { LIST_HOVER_TRANSITION } from "../../kit/ui/motion";
import { Slider } from "../../kit/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "../../kit/ui/toggle-group";
import { cn } from "../../kit/ui/utils";
import type { PresenceEntryView } from "../contract";
import { BUILTIN_FORMS, FORM_NAMES, PRESENCE_STATES, STATE_NAMES, type PresenceStateName } from "../forms";
import { tripleToHex } from "../palette";
import { MAX_MOTION, type Presence } from "../schema";
import { usePresenceLook, type PresenceBot } from "./BotPresence";
import { PresenceView } from "./PresenceView";
import { presenceFailure, failureKey, usePresenceList, usePresenceVersion } from "./state";

const SEGMENT = cn("h-6 min-w-0 flex-auto shrink-0 whitespace-nowrap rounded-sm px-2 text-xs font-normal shadow-none hover:bg-state-hover hover:text-foreground data-[state=on]:bg-state-active data-[state=on]:text-foreground data-[state=on]:hover:bg-state-active", "max-md:pointer-coarse:h-9 max-md:pointer-coarse:text-sm", LIST_HOVER_TRANSITION);
const HEADING = "text-xs font-medium text-muted-foreground";
const TILE = "group relative flex min-w-0 flex-col items-center gap-1.5 rounded-lg border border-border/60 px-1.5 pb-1.5 pt-2 text-xs text-foreground outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring aria-checked:border-primary aria-checked:bg-state-active";
const STAGE = "flex items-center justify-center rounded-xl border border-border/60 bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)]";
const PREVIEW_WORKERS = 2;
const NEXT_KEYS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

function moveInRadioGroup(event: KeyboardEvent<HTMLElement>, pick: (form: string) => void): void {
  const radios = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const at = radios.indexOf(event.target as HTMLElement);
  if (at < 0) return;
  const step = NEXT_KEYS[event.key];
  const to = event.key === "Home" ? 0 : event.key === "End" ? radios.length - 1 : step !== undefined ? (at + step + radios.length) % radios.length : -1;
  if (to < 0) return;
  event.preventDefault();
  const next = radios[to]!;
  next.focus();
  if (next.dataset.form) pick(next.dataset.form);
}

export interface PresenceSectionProps {
  bot: PresenceBot & { name: string };
  value: Presence;
  onChange(next: Presence): void;
  onAsk?(prompt: string): Promise<void>;
  entries?: readonly PresenceEntryView[];
  stageSize?: number;
}

export function PresenceSection({ bot, value, onChange, onAsk, entries, stageSize = 160 }: PresenceSectionProps) {
  usePresenceVersion();
  const listed = usePresenceList(!entries).data?.presences;
  const stored = (entries ?? listed ?? []).filter((entry) => entry.source === "stored" && entry.code);
  const look = usePresenceLook(bot, value);
  const [state, setState] = useState<PresenceStateName>("idle");
  const [creating, setCreating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [asked, setAsked] = useState<"sending" | "sent" | string | null>(null);
  const custom = stored.find((entry) => entry.id === value.form) ?? null;
  const failure = custom ? presenceFailure(failureKey(custom)) : null;
  const view = { palette: look.palette, light: look.light, motion: value.motion };
  const workers = state === "working" ? PREVIEW_WORKERS : 0;
  const checkedForm = [...BUILTIN_FORMS, ...stored.map((entry) => entry.id)].includes(value.form) ? value.form : BUILTIN_FORMS[0];
  const plain = value.color.source === "theme" && value.motion === 1;
  const ask = () => {
    const text = prompt.trim();
    if (!text || !onAsk) return;
    setAsked("sending");
    onAsk(text).then(() => { setAsked("sent"); setPrompt(""); }, (cause: unknown) => setAsked(cause instanceof Error && cause.message ? cause.message : "Couldn't send it."));
  };
  return (
    <section aria-label="Presence" data-testid="presence-section" className="grid min-w-0 grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-[minmax(180px,220px)_1fr]">
      <div className="flex min-w-0 flex-col items-center gap-2.5">
        <div data-testid="presence-stage" className={cn(STAGE, "w-full py-3")}>
          <PresenceView form={value.form} custom={custom} {...view} state={state} workers={workers} size={stageSize} />
        </div>
        <ToggleGroup type="single" aria-label="Preview state" value={state} onValueChange={(next) => { if (next) setState(next as PresenceStateName); }} data-testid="presence-states" className="grid w-full grid-cols-2 gap-1">
          {PRESENCE_STATES.map((each) => <ToggleGroupItem key={each} value={each} className={SEGMENT}>{STATE_NAMES[each]}</ToggleGroupItem>)}
        </ToggleGroup>
        <div data-testid="presence-sizes" className="flex w-full items-center gap-2.5 rounded-lg border border-border/60 px-2.5 py-1.5">
          <PresenceView form={value.form} custom={custom} {...view} state={state} workers={workers} size={36} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{bot.name}</span>
          <PresenceView form={value.form} custom={custom} {...view} state={state} workers={workers} size={24} />
        </div>
        {failure ? <p role="alert" data-testid="presence-failure" className="w-full text-xs text-destructive">{`${custom?.name ?? value.form} stopped: ${failure}`}</p> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h3 className={HEADING}>Form</h3>
          <div role="radiogroup" aria-label="Form" data-testid="presence-forms" className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2"
            onKeyDown={(event) => moveInRadioGroup(event, (form) => onChange({ ...value, form }))}>
            {BUILTIN_FORMS.map((form) => (
              <button key={form} type="button" role="radio" aria-checked={value.form === form} tabIndex={checkedForm === form ? 0 : -1} aria-label={FORM_NAMES[form]} data-testid="presence-tile" data-form={form}
                onClick={() => onChange({ ...value, form })} className={TILE}>
                <PresenceView form={form} {...view} state="idle" workers={0} size={56} />
                <span className="w-full truncate text-center">{FORM_NAMES[form]}</span>
              </button>
            ))}
            {stored.map((entry) => (
              <button key={entry.id} type="button" role="radio" aria-checked={value.form === entry.id} tabIndex={checkedForm === entry.id ? 0 : -1} aria-label={entry.name} title={entry.description || entry.name} data-testid="presence-tile" data-form={entry.id}
                onClick={() => onChange({ ...value, form: entry.id })} className={TILE}>
                <PresenceView form={entry.id} custom={entry} {...view} state="idle" workers={0} size={56} />
                <span className="w-full truncate text-center">{entry.name}</span>
                <span data-testid="presence-custom" className="absolute right-1 top-1 rounded-sm bg-muted px-1 text-xs text-muted-foreground">Custom</span>
              </button>
            ))}
            {onAsk ? (
              <button type="button" aria-expanded={creating} data-testid="presence-create" onClick={() => setCreating((open) => !open)} className={cn(TILE, "justify-center border-dashed text-muted-foreground hover:text-foreground")}>
                <span aria-hidden className="flex size-14 items-center justify-center text-2xl leading-none">+</span>
                <span className="w-full truncate text-center">Create…</span>
              </button>
            ) : null}
          </div>
          {creating && onAsk ? (
            <form data-testid="presence-create-form" className="flex min-w-0 items-center gap-2" onSubmit={(event) => { event.preventDefault(); ask(); }}>
              <Input aria-label="Presence description" className="h-7 min-w-0 flex-1 text-xs" placeholder="A slowly unfolding origami crane" maxLength={400} value={prompt}
                onChange={(event) => { setPrompt(event.target.value); if (asked !== "sending") setAsked(null); }} />
              <Button type="submit" size="sm" variant="outline" disabled={!prompt.trim() || asked === "sending"}>Create</Button>
            </form>
          ) : null}
          {creating && asked === "sent" ? <p role="status" data-testid="presence-asked" className="text-xs text-muted-foreground">{`Sent to ${bot.name}`}</p> : null}
          {creating && asked && asked !== "sent" && asked !== "sending" ? <p role="alert" className="text-xs text-destructive">{asked}</p> : null}
        </div>
        <div className="grid max-w-md grid-cols-[72px_minmax(0,1fr)] items-center gap-3 text-xs text-foreground">
          <span>Color</span>
          <div className="flex min-w-0 items-center gap-2">
            <ToggleGroup type="single" aria-label="Color source" value={value.color.source} className="flex shrink-0 gap-1"
              onValueChange={(next) => {
                if (next === "theme") onChange({ ...value, color: { source: "theme" } });
                if (next === "custom") onChange({ ...value, color: { source: "custom", hex: tripleToHex(look.palette[0]) } });
              }}>
              <ToggleGroupItem value="theme" className={SEGMENT}>From theme</ToggleGroupItem>
              <ToggleGroupItem value="custom" className={SEGMENT}>Custom</ToggleGroupItem>
            </ToggleGroup>
            {value.color.source === "custom" ? (
              <input type="color" aria-label="Color" data-testid="presence-color" value={value.color.hex} onChange={(event) => onChange({ ...value, color: { source: "custom", hex: event.target.value.toLowerCase() } })}
                className="size-6 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0" />
            ) : (
              <span aria-hidden data-testid="presence-swatches" className="flex gap-1">
                {look.palette.map((color, index) => <span key={index} className="size-3 rounded-[3px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_18%,transparent)]" style={{ background: tripleToHex(color) }} />)}
              </span>
            )}
          </div>
        </div>
        <label className="grid max-w-md grid-cols-[72px_minmax(0,1fr)_40px] items-center gap-3 text-xs text-foreground">
          <span>Motion</span>
          <Slider aria-label="Motion" min={0} max={MAX_MOTION} step={0.1} value={[value.motion]} onValueChange={([amount]) => { if (amount !== undefined) onChange({ ...value, motion: Math.round(amount * 10) / 10 }); }} />
          <output data-testid="presence-motion" className="text-right tabular-nums text-muted-foreground">{`${value.motion.toFixed(1)}×`}</output>
        </label>
        <div className="flex max-w-md justify-end">
          <Button type="button" variant="outline" size="sm" data-testid="presence-reset" disabled={plain} onClick={() => onChange({ ...value, color: { source: "theme" }, motion: 1 })}>Reset</Button>
        </div>
      </div>
    </section>
  );
}
