// The pieces Studio's settings sections are made of, drawn like BB's own
// settings rows: copy on the left, the control on the right, rows in one
// bordered card. `SettingRow` draws any Studio setting from its definition.
import { useEffect, useState, type ReactNode } from "react";
import { cn, Icon, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "../../kit/ui/index";
import { errorMessage } from "../../kit/format";
import { STUDIO_SETTINGS, type SettingValue, type StudioSetting, type StudioSettingKey } from "../schema";
import { useStudioSettings } from "./use-settings";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-border rounded-lg border border-border bg-card", className)}>{children}</div>;
}

/** A small heading inside a card, such as "Hands-free". */
export function SubHeading({ children }: { children: ReactNode }) {
  return <div className="bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">{children}</div>;
}

export function Row({ label, description, children, indent, testId }: { label: ReactNode; description?: ReactNode; children?: ReactNode; indent?: boolean; testId?: string }) {
  return (
    <div data-testid={testId} className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6", indent && "sm:pl-8")}>
      <div className="min-w-0 sm:max-w-[60%]">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? <div className="mt-0.5 text-xs text-muted-foreground">{description}</div> : null}
      </div>
      {children ? <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{children}</div> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange(next: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", checked ? "bg-success" : "bg-muted-foreground/30")}>
      <span className={cn("inline-block size-4 rounded-full bg-background shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

/** A row of buttons for two to four short choices. */
export function Segmented<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: readonly { value: T; label: string }[]; onChange(next: T): void; label: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-border p-0.5">
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} disabled={disabled} onClick={() => onChange(option.value)}
          className="rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground aria-checked:bg-foreground aria-checked:text-background disabled:opacity-50">
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A text or number field that saves when it loses focus or on Enter. */
export function CommitField({ value, onCommit, label, type = "text", placeholder, multiline, className, prefix }: {
  value: string; onCommit(next: string): Promise<void>; label: string; type?: "text" | "number"; placeholder?: string; multiline?: boolean; className?: string; prefix?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft === value) return;
    setError(null);
    onCommit(draft).catch((cause: unknown) => { setError(errorMessage(cause)); setDraft(value); });
  };
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex items-center gap-1.5">
        {prefix ? <span className="text-sm text-muted-foreground">{prefix}</span> : null}
        {multiline ? (
          <Textarea aria-label={label} value={draft} placeholder={placeholder} rows={3} onChange={(event) => setDraft(event.target.value)} onBlur={commit} className={cn("w-72 text-sm", className)} />
        ) : (
          <Input aria-label={label} type={type} value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={commit}
            onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} className={cn(type === "number" ? "w-24" : "w-72", "h-8 text-sm", className)} />
        )}
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** The control for one setting, from its definition. */
export function SettingControl({ k, options, disabled, prefix }: { k: StudioSettingKey; options?: readonly string[]; disabled?: boolean; prefix?: string }) {
  const { values, set } = useStudioSettings();
  const setting: StudioSetting = STUDIO_SETTINGS[k];
  const [error, setError] = useState<string | null>(null);
  if (!values) return null;
  const value = values[k] as SettingValue;
  const save = (next: SettingValue) => { setError(null); set({ [k]: next }).catch((cause: unknown) => setError(errorMessage(cause))); };
  const control = (() => {
    switch (setting.type) {
      case "boolean":
        return <Switch checked={value === true} label={setting.label} disabled={disabled} onChange={save} />;
      case "select": {
        const choices = options ?? setting.options;
        const shown = choices.includes(String(value)) ? choices : [String(value), ...choices];
        return (
          <Select value={String(value)} disabled={disabled} onValueChange={save}>
            <SelectTrigger aria-label={setting.label} className="h-8 w-56 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{shown.map((option) => <SelectItem key={option} value={option}>{setting.optionLabels?.[option] ?? option}</SelectItem>)}</SelectContent>
          </Select>
        );
      }
      case "number":
        return <CommitField label={setting.label} type="number" prefix={prefix} value={String(value)} onCommit={async (raw) => { await set({ [k]: raw.trim() === "" ? null : Number(raw) }); }} />;
      case "string":
        return <CommitField label={setting.label} multiline={setting.multiline} value={String(value)} onCommit={async (raw) => { await set({ [k]: raw }); }} />;
    }
  })();
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      {control}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** A row for one setting: its label and help text, and its control. */
export function SettingRow({ k, description, indent, options, disabled, prefix }: { k: StudioSettingKey; description?: ReactNode; indent?: boolean; options?: readonly string[]; disabled?: boolean; prefix?: string }) {
  const setting: StudioSetting = STUDIO_SETTINGS[k];
  return (
    <Row label={setting.label} description={description ?? setting.description} indent={indent} testId={`setting-${k}`}>
      <SettingControl k={k} options={options} disabled={disabled} prefix={prefix} />
    </Row>
  );
}

/** A disclosure inside a card, closed at first. */
export function Disclosure({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testId}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-sm text-muted-foreground hover:text-foreground">
        <Icon name="ChevronRight" className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />{label}
      </button>
      {open ? <div className="divide-y divide-border border-t border-border">{children}</div> : null}
    </div>
  );
}

/** Loading and error states for a whole section. */
export function SectionState({ children }: { children: ReactNode }) {
  const { values, error, isLoading } = useStudioSettings();
  if (values) return <>{children}</>;
  return <Card><p role={error ? "alert" : "status"} className={cn("px-4 py-3 text-sm", error ? "text-destructive" : "text-muted-foreground")}>{error ?? (isLoading ? "Loading settings…" : "Settings are unavailable.")}</p></Card>;
}
