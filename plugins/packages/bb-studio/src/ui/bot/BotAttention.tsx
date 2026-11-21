// Bot ▸ Controls ▸ Attention: the time zone scheduled items show and run in
// (todosTimeZone, a Studio setting; empty is this computer's).
import { useMemo, useState } from "react";
import { errorMessage } from "../../kit/format";
import { cn, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../kit/ui/index";
import { STUDIO_SETTINGS } from "../../settings/schema";
import { useStudioSettings } from "../../settings/ui/use-settings";

const COMPUTER = "computer";

export function zoneWords(zone: string): string {
  const place = zone.replace(/_/g, " ");
  try {
    const short = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value;
    return short ? `${place} (${short})` : place;
  } catch {
    return place;
  }
}

function supportedZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?(key: string): string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export function BotAttention(_props: { botName: string }) {
  const { values, set, defaultTimeZone, error: loadError } = useStudioSettings();
  const [error, setError] = useState<string | null>(null);
  if (!values) return <p className={cn("text-sm", loadError ? "text-destructive" : "text-muted-foreground")}>{loadError ?? "Loading…"}</p>;
  const save = (patch: Record<string, number | boolean | string>) => { setError(null); set(patch).catch((cause: unknown) => setError(errorMessage(cause))); };
  return (
    <div className="flex flex-col gap-3" data-testid="bot-attention">
      <div className="divide-y divide-border rounded-lg border border-border">
        <div className="flex items-center justify-between gap-4 px-4 py-3" data-testid="attention-zone">
          <div className="min-w-0">
            <div className="text-sm font-medium">{STUDIO_SETTINGS.todosTimeZone.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{STUDIO_SETTINGS.todosTimeZone.description}</div>
          </div>
          <ZoneSelect value={values.todosTimeZone} computer={defaultTimeZone} onChange={(zone) => save({ todosTimeZone: zone })} />
        </div>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function ZoneSelect({ value, computer, onChange }: { value: string; computer: string | null; onChange(zone: string): void }) {
  const zones = useMemo(() => {
    const all = supportedZones();
    return value && !all.includes(value) ? [value, ...all] : all;
  }, [value]);
  const labels = useMemo(() => new Map(zones.map((zone) => [zone, zoneWords(zone)])), [zones]);
  const here = computer ? `This computer · ${zoneWords(computer)}` : "This computer";
  return (
    <Select value={value || COMPUTER} onValueChange={(next) => onChange(next === COMPUTER ? "" : next)}>
      <SelectTrigger aria-label={STUDIO_SETTINGS.todosTimeZone.label} className="h-8 w-64 text-sm"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={COMPUTER}>{here}</SelectItem>
        {zones.map((zone) => <SelectItem key={zone} value={zone}>{labels.get(zone)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
