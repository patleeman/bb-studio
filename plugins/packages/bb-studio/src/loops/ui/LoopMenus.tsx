// A todo's menus and small forms, shared by the card and the Todos tab:
// Snooze (the presets, then Pick a time…), Hand off (the Bot or a lead),
// Choose… for a decision past three options, and Change trigger.
import { useState, type ReactNode } from "react";
import {
  Checkbox, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  Icon, Popover, PopoverContent, PopoverTrigger, cn,
} from "../../kit/ui/index";
import type { Loop } from "../contract";
import { optionParts, placeLabel, SNOOZE, snoozeHint, type SnoozePreset, type Trigger } from "./model";

export const CARD_BUTTON = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm text-foreground hover:bg-state-hover disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-state-active [&_svg]:size-3.5";
export const CARD_PRIMARY = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-sm font-medium text-background hover:bg-foreground/90 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5";
export const CARD_GHOST = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-state-active [&_svg]:size-3.5";

const fromLocalInput = (value: string): number | null => { const at = new Date(value).getTime(); return Number.isFinite(at) ? at : null; };
const toLocalInput = (at: number) => { const d = new Date(at - new Date(at).getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16); };

/** Snooze ▾: the presets, then Pick a time…, which asks for a date and time. */
export function SnoozeMenu({ disabled, onSnooze, onPick, className = CARD_BUTTON, label = "Snooze" }: { disabled?: boolean; onSnooze(preset: SnoozePreset): void; onPick(at: number): void; className?: string; label?: string }) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={className} disabled={disabled}><Icon name="Clock" />{label}<Icon name="ChevronDown" className="opacity-60" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-60">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Snooze until</DropdownMenuLabel>
          {SNOOZE.map((preset, index) => (
            <span key={preset.id} className="contents">
              {index === 4 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem onSelect={() => onSnooze(preset.id)}>
                <Icon name={preset.icon} />
                <span className="flex-1">{preset.label}</span>
                <span className="text-xs text-muted-foreground">{snoozeHint(preset.id)}</span>
              </DropdownMenuItem>
            </span>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPicking(true)}><Icon name="Calendar" />Pick a time…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {picking ? <PickTime onClose={() => setPicking(false)} onPick={(at) => { setPicking(false); onPick(at); }} /> : null}
    </>
  );
}

export function PickTime({ onClose, onPick }: { onClose(): void; onPick(at: number): void }) {
  const [value, setValue] = useState(() => toLocalInput(Date.now() + 3_600_000));
  const at = fromLocalInput(value);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Snooze until</DialogTitle></DialogHeader>
        <input type="datetime-local" aria-label="Snooze until" value={value} onChange={(event) => setValue(event.target.value)}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground" />
        <DialogFooter>
          <button type="button" className={CARD_GHOST} onClick={onClose}>Cancel</button>
          <button type="button" className={CARD_PRIMARY} disabled={at === null || at <= Date.now()} onClick={() => at && onPick(at)}>Snooze until then</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hand off ▾: the Bot, then each project's lead. */
export function HandOffMenu({ targets, disabled, onHandOff, className = CARD_BUTTON }: { targets: { owner: string; name: string }[]; disabled?: boolean; onHandOff(owner: string): void; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={className} disabled={disabled}><Icon name="ArrowTurnForward" />Hand off<Icon name="ChevronDown" className="opacity-60" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Hand off to</DropdownMenuLabel>
        {targets.map((target) => (
          <DropdownMenuItem key={target.owner} onSelect={() => onHandOff(target.owner)}>
            <Icon name="Bot" />{target.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A decision's option as a two-line button: its name and the rest. */
export function OptionButton({ option, disabled, onChoose }: { option: string; disabled?: boolean; onChoose(): void }) {
  const { label, detail } = optionParts(option);
  return (
    <button type="button" disabled={disabled} onClick={onChoose} title={option}
      className="flex min-w-0 flex-1 basis-40 flex-col items-start rounded-md border border-border px-3 py-1.5 text-left hover:bg-state-hover disabled:pointer-events-none disabled:opacity-50 sm:max-w-64">
      <span className="w-full truncate text-sm font-medium text-foreground">{label}</span>
      {detail ? <span className="w-full truncate text-xs text-muted-foreground">{detail}</span> : null}
    </button>
  );
}

/** Choose… for more than three options (decision 2): a sheet listing them. */
export function ChooseSheet({ loop, disabled, onChoose }: { loop: Loop; disabled?: boolean; onChoose(option: string): void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={CARD_PRIMARY} disabled={disabled} onClick={() => setOpen(true)}><Icon name="Fork" />Choose…</button>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{loop.title}</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-1.5">
              {loop.options.map((option) => <OptionButton key={option} option={option} disabled={disabled} onChoose={() => { setOpen(false); onChoose(option); }} />)}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

type TriggerType = Trigger["type"];
const TABS: { type: TriggerType; label: string }[] = [
  { type: "time", label: "Time" }, { type: "event", label: "Event" }, { type: "place", label: "Place" }, { type: "none", label: "Anytime" },
];

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange(value: T): void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-1 rounded-md bg-muted p-0.5">
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)}
          className={cn("h-7 flex-1 rounded px-2 text-sm text-muted-foreground hover:text-foreground", value === option.value && "bg-background text-foreground shadow-sm")}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Change trigger: Time, Event, Place (the phone's saved names) or Anytime,
 * and "Send to iPhone when it fires" (the todo's push flag).
 */
export function ChangeTrigger({ loop, places, disabled, onSave, children }: { loop: Loop; places: string[]; disabled?: boolean; onSave(changes: { trigger: Trigger; push: boolean }): void; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ?? <button type="button" className={CARD_GHOST} disabled={disabled}><Icon name="DateTime" />Change trigger</button>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        {open ? <TriggerForm loop={loop} places={places} onCancel={() => setOpen(false)} onSave={(changes) => { setOpen(false); onSave(changes); }} /> : null}
      </PopoverContent>
    </Popover>
  );
}

export function TriggerForm({ loop, places, onCancel, onSave }: { loop: Loop; places: string[]; onCancel(): void; onSave(changes: { trigger: Trigger; push: boolean }): void }) {
  const current = loop.trigger;
  const [type, setType] = useState<TriggerType>(current.type);
  const [when, setWhen] = useState(() => toLocalInput(current.type === "time" && current.at ? current.at : Date.now() + 3_600_000));
  const [event, setEvent] = useState(current.type === "event" ? current.event ?? "" : "");
  // Place keys are lower-case on the server; match the phone's names in any case.
  const names = places.length ? places : ["Home"];
  const [place, setPlace] = useState(() => current.type === "place" && current.place ? names.find((name) => name.toLowerCase() === current.place!.toLowerCase()) ?? current.place : names[0]!);
  const [direction, setDirection] = useState<"arrive" | "leave">(current.type === "place" ? current.direction ?? "arrive" : "arrive");
  const [push, setPush] = useState(loop.push);
  const at = fromLocalInput(when);
  const trigger: Trigger | null =
    type === "time" ? (at ? { type, at } : null)
      : type === "event" ? (event.trim() ? { type, event: event.trim() } : null)
        : type === "place" ? { type, place, direction }
          : { type: "none" };
  return (
    <form className="flex flex-col gap-3" aria-label="Change trigger" onSubmit={(e) => { e.preventDefault(); if (trigger) onSave({ trigger, push }); }}>
      <div className="text-sm font-medium text-foreground">Change trigger</div>
      <Segmented<TriggerType> label="Trigger" value={type} onChange={setType} options={TABS.map((tab) => ({ value: tab.type, label: tab.label }))} />
      {type === "time" ? (
        <input type="datetime-local" aria-label="When" value={when} onChange={(e) => setWhen(e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground" />
      ) : type === "event" ? (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Event name
          <input aria-label="Event name" value={event} placeholder="reply:sam" onChange={(e) => setEvent(e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground" />
        </label>
      ) : type === "place" ? (
        <div className="flex flex-col gap-2">
          <div role="radiogroup" aria-label="Place" className="flex flex-col">
            {names.map((name) => (
              <label key={name} className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 text-sm text-foreground hover:bg-state-hover">
                <input type="radio" name="loop-place" checked={place.toLowerCase() === name.toLowerCase()} onChange={() => setPlace(name)} className="accent-foreground" />
                <Icon name="Pin" className="size-3.5 text-muted-foreground" />{name}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            When I
            <Segmented<"arrive" | "leave"> label="Direction" value={direction} onChange={setDirection} options={[{ value: "arrive", label: "Arrive" }, { value: "leave", label: "Leave" }]} />
          </div>
          <p className="text-xs text-muted-foreground">{places.length ? placeLabel(place, direction) + "." : "No places yet. Set them up on iPhone (Settings ▸ Places)."}</p>
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-sm text-foreground">
        <Checkbox checked={push} onCheckedChange={(value) => setPush(value === true)} aria-label="Send to iPhone when it fires" />
        <Icon name="Smartphone" className="size-3.5 text-muted-foreground" />Send to iPhone when it fires
      </label>
      <div className="flex justify-end gap-1.5">
        <button type="button" className={CARD_GHOST} onClick={onCancel}>Cancel</button>
        <button type="submit" className={CARD_PRIMARY} disabled={!trigger}>Save</button>
      </div>
    </form>
  );
}
