import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../../kit/ui/button";
import { Slider } from "../../kit/ui/slider";
import { Switch } from "../../kit/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "../../kit/ui/toggle-group";
import { cn } from "../../kit/ui/utils";
import { defaultAppearance, withTheme, type Appearance, type EffectSwitch } from "../appearance";
import { checkTheme, type CheckReport } from "../checks";
import { browserCheckContext } from "../gpu";
import { optionsOverRpc, optionValue, themeOptions, themeOptionsChanged, type ThemeOption, type ThemeOptionsClient, type ThemeOptionValues } from "../options";
import type { ThemeEntry, ThemeRegistry } from "../registry";
import { variantFor, type Mode, type ThemePackage } from "../schema";
import { browserPreviewDeps, PreviewHub } from "./preview";

const PALETTE_NAMES = ["Background", "Accent", "Highlight", "Worker"] as const;
const SLIDERS: readonly { key: "intensity" | "glass" | "motion"; label: string }[] = [
  { key: "intensity", label: "Intensity" },
  { key: "glass", label: "Glass opacity" },
  { key: "motion", label: "Motion" },
];
const SWITCHES: readonly { key: EffectSwitch; label: string; scene: boolean }[] = [
  { key: "workers", label: "Workers in the scene", scene: true },
  { key: "finished", label: "Ripple when a turn finishes", scene: true },
  { key: "needsYou", label: "Pulse while waiting on me", scene: false },
  { key: "error", label: "Red ripple on an error", scene: true },
];
const SEGMENT = "h-6 flex-none whitespace-nowrap rounded-sm px-2 text-xs font-normal shadow-none hover:bg-state-hover hover:text-foreground data-[state=on]:bg-state-active data-[state=on]:text-foreground data-[state=on]:hover:bg-state-active max-md:pointer-coarse:h-9 max-md:pointer-coarse:text-sm";
const HEADING = "text-sm font-semibold text-foreground";
export const CARD_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-3.5";
export const FRAME = "relative overflow-hidden rounded-lg shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function withAlpha(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255} / ${alpha})`;
}

function SceneSketch({ theme }: { theme: ThemePackage }) {
  const [ground, line, light, worker] = theme.palette;
  if (theme.scene.kind === "shader" && theme.scene.fallback.image) return <span aria-hidden className="absolute inset-0 bg-cover bg-center" style={{ backgroundColor: ground, backgroundImage: `url("${theme.scene.fallback.image}")` }} />;
  const grid = withAlpha(line, 0.55);
  return (
    <span aria-hidden className="absolute inset-0" style={{ background: ground }}>
      <span className="absolute inset-x-0 bottom-0 top-[55%]" style={{ backgroundImage: `repeating-linear-gradient(90deg, ${grid} 0 1px, transparent 1px 12px), repeating-linear-gradient(0deg, ${grid} 0 1px, transparent 1px 9px)` }} />
      <span className="absolute inset-x-0 top-[55%] h-px" style={{ background: light, boxShadow: `0 0 6px ${line}` }} />
      <span className="absolute left-[28%] top-[70%] size-1.5 rounded-full" style={{ background: worker, boxShadow: `0 0 6px ${worker}` }} />
    </span>
  );
}

export function ScenePreview({ theme, hub }: { theme: ThemePackage; hub: PreviewHub | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = canvas.current;
    if (!hub || !target) return;
    const unregister = hub.register(theme, target);
    const view = target.ownerDocument.defaultView;
    if (!view || typeof view.IntersectionObserver !== "function") return unregister;
    const observer = new view.IntersectionObserver((entries) => { for (const entry of entries) hub.setVisible(theme.id, entry.isIntersecting); });
    observer.observe(target);
    return () => { observer.disconnect(); unregister(); };
  }, [hub, theme]);
  return (
    <>
      <SceneSketch theme={theme} />
      <canvas ref={canvas} aria-hidden data-testid="theme-live-preview" className="absolute inset-0 size-full" />
    </>
  );
}

export function ClassicPreview({ theme, mode }: { theme: ThemePackage; mode: Mode }) {
  const { colors } = variantFor(theme, mode);
  return (
    <span aria-hidden data-testid="theme-mock" className="absolute inset-0 flex" style={{ background: colors.canvas }}>
      <span className="flex h-full w-[30%] flex-col gap-1 px-1.5 pt-2" style={{ background: colors.sidebar, boxShadow: `inset -1px 0 0 ${withAlpha(colors.ink, 0.12)}` }}>
        <span className="h-1 w-[80%] rounded-full" style={{ background: colors.ink, opacity: 0.7 }} />
        <span className="h-1.5 w-full rounded-sm" style={{ background: withAlpha(colors.selection, 0.35) }} />
        <span className="h-1 w-[60%] rounded-full" style={{ background: colors.ink, opacity: 0.45 }} />
      </span>
      <span className="flex flex-1 flex-col justify-end gap-1.5 px-2 pb-2">
        <span className="h-1 w-[70%] rounded-full" style={{ background: colors.ink }} />
        <span className="h-1 w-[45%] rounded-full" style={{ background: colors.ink, opacity: 0.6 }} />
        <span className="mt-0.5 flex h-3 items-center justify-end rounded-sm px-0.5" style={{ background: colors.sidebar, boxShadow: `inset 0 0 0 1px ${withAlpha(colors.ink, 0.14)}` }}>
          <span className="size-2 rounded-[2px]" style={{ background: colors.accent }} />
        </span>
      </span>
    </span>
  );
}

function Swatches({ colors, label }: { colors: readonly string[]; label?: boolean }) {
  return (
    <span className="flex gap-1">
      {colors.map((color, index) => (
        <span key={`${color}-${index}`} role={label ? "img" : undefined} aria-label={label ? PALETTE_NAMES[index] : undefined} aria-hidden={label ? undefined : true}
          data-testid="palette-swatch" className="size-3 rounded-[3px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_18%,transparent)]" style={{ background: color }} />
      ))}
    </span>
  );
}

interface CardProps { id: string; name: string; checked: boolean; onPick(): void; preview: ReactNode; palette: readonly string[] | null; custom: boolean; large: boolean; onHover?(on: boolean): void }

function Card({ id, name, checked, onPick, preview, palette, custom, large, onHover }: CardProps) {
  return (
    <button type="button" role="radio" aria-checked={checked} aria-label={name} data-testid="theme-card" data-theme-id={id} onClick={onPick}
      onPointerEnter={() => onHover?.(true)} onPointerLeave={() => onHover?.(false)} onFocus={() => onHover?.(true)} onBlur={() => onHover?.(false)}
      className="group flex min-w-0 flex-col gap-2 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className={cn(FRAME, large ? "h-[104px]" : "h-20", checked && "ring-2 ring-primary")}>{preview}</span>
      <span className="flex min-w-0 items-center gap-1.5 px-0.5 text-xs font-medium text-foreground">
        <span className="truncate">{name}</span>
        {checked ? <span aria-hidden className="ml-auto size-2 shrink-0 rounded-full bg-primary" /> : null}
      </span>
      {palette || custom ? (
        <span className="flex min-w-0 items-center gap-1.5 px-0.5">
          {palette ? <Swatches colors={palette} /> : null}
          {custom ? <span data-testid="theme-custom" className="ml-auto shrink-0 rounded-sm bg-muted px-1 text-xs text-muted-foreground">Custom</span> : null}
        </span>
      ) : null}
    </button>
  );
}

interface RowProps { label: string; entries: readonly ThemeEntry[]; value: Appearance | null; mode: Mode; onPick(theme: ThemePackage): void; hub: PreviewHub | null; before?: ReactNode }

function Row({ label, entries, value, mode, onPick, hub, before }: RowProps) {
  const scene = label === "Scene";
  return (
    <div role="radiogroup" aria-label={label} data-testid={`theme-row-${label.toLowerCase()}`} className={CARD_GRID}>
      {before}
      {entries.map(({ theme, source }) => (
        <Card key={theme.id} id={theme.id} name={theme.name} checked={value?.themeId === theme.id} onPick={() => onPick(theme)} palette={theme.palette} large={scene}
          custom={source === "stored"}
          onHover={scene ? (on) => hub?.setHovered(on ? theme.id : null) : undefined}
          preview={theme.kind === "scene" ? <ScenePreview theme={theme} hub={hub} /> : <ClassicPreview theme={theme} mode={mode} />} />
      ))}
    </div>
  );
}

function checkSummary(report: CheckReport): string {
  const failed = report.results.filter((line) => !line.pass);
  const frame = report.results.find((line) => line.id === "frame-time");
  if (!failed.length) return `Checks passed${frame ? ` · ${frame.reason}` : ""}`;
  return `Checks failed · ${failed.map((line) => `${line.id}: ${line.reason}`).join(" · ")}`;
}

export function runInAppCheck(theme: ThemePackage): CheckReport {
  const context = browserCheckContext(document);
  try { return checkTheme(theme, { createContext: context.createContext }); } finally { context.release(); }
}

function useStoredCheck(theme: ThemePackage | null, stored: boolean, check: (theme: ThemePackage) => CheckReport): CheckReport | null {
  const [report, setReport] = useState<{ id: string; report: CheckReport } | null>(null);
  useEffect(() => {
    if (!theme || !stored) return;
    const timer = setTimeout(() => setReport({ id: theme.id, report: check(theme) }), 0);
    return () => clearTimeout(timer);
  }, [theme, stored, check]);
  return theme && stored && report?.id === theme.id ? report.report : null;
}

export function usePreviewHub(make: (() => PreviewHub) | undefined): PreviewHub | null {
  const [hub, setHub] = useState<PreviewHub | null>(null);
  useEffect(() => {
    const created = make ? make() : new PreviewHub(browserPreviewDeps(document));
    setHub(created);
    const media = typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION) : null;
    const sync = () => { created.setReducedMotion(!!media?.matches); created.setHidden(document.visibilityState === "hidden"); };
    sync();
    media?.addEventListener?.("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => { media?.removeEventListener?.("change", sync); document.removeEventListener("visibilitychange", sync); created.dispose(); };
  }, [make]);
  return hub;
}

function ThemeOptionRows({ themeId, options, client }: { themeId: string; options: readonly ThemeOption[]; client: ThemeOptionsClient }) {
  const [state, setState] = useState<{ themeId: string; values: ThemeOptionValues } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    client.load(themeId).then((values) => { if (live) setState({ themeId, values }); }, () => {});
    return () => { live = false; };
  }, [client, themeId]);
  const values = state?.themeId === themeId ? state.values : null;
  const choose = (option: ThemeOption, value: string) => {
    const before = values;
    setState({ themeId, values: { ...values, [option.id]: value } });
    setError(null);
    client.save(themeId, option.id, value).then(
      (saved) => { setState({ themeId, values: saved }); themeOptionsChanged(themeId); },
      (cause: unknown) => { setState(before ? { themeId, values: before } : null); setError(`Couldn't save ${option.label}: ${cause instanceof Error ? cause.message : String(cause)}`); },
    );
  };
  return (
    <div data-testid="theme-options" className="flex min-w-0 flex-col gap-3 border-t border-border pt-4 text-xs">
      {options.map((option) => (
        <div key={option.id} data-testid="theme-option" data-option-id={option.id} className="grid grid-cols-[100px_1fr] items-center gap-3 text-foreground">
          <span>{option.label}</span>
          <ToggleGroup type="single" size="sm" aria-label={option.label} className="flex-wrap justify-start gap-1" value={optionValue(option, values)}
            onValueChange={(value) => { if (value) choose(option, value); }}>
            {option.choices.map((choice) => <ToggleGroupItem key={choice.value} value={choice.value} className={SEGMENT}>{choice.label}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
      ))}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </div>
  );
}

export interface ThemePickerProps {
  registry: ThemeRegistry;
  mode: Mode;
  value: Appearance | null;
  onChange(next: Appearance | null): void;
  everyBot: boolean;
  onEveryBot(on: boolean): void;
  after?: ReactNode;
  actions?: ReactNode;
  actionsClassName?: string;
  makePreviews?: () => PreviewHub;
  check?: (theme: ThemePackage) => CheckReport;
  options?: ThemeOptionsClient;
}

export function ThemePicker({ registry, mode, value, onChange, everyBot, onEveryBot, after, actions, actionsClassName, makePreviews, check = runInAppCheck, options = optionsOverRpc }: ThemePickerProps) {
  const theme = value ? registry.get(value.themeId) : null;
  const scene = theme?.kind === "scene";
  const stored = !!theme && registry.list().some((entry) => entry.theme.id === theme.id && entry.source === "stored");
  const hub = usePreviewHub(makePreviews);
  const report = useStoredCheck(theme, stored, check);
  const declared = themeOptions(theme?.id);
  useEffect(() => { hub?.setSelected(value?.themeId ?? null); }, [hub, value?.themeId]);
  const pick = (next: ThemePackage) => onChange(withTheme(value, next));
  const setSlider = (key: "intensity" | "glass" | "motion", amount: number) => { if (value) onChange({ ...value, [key]: Math.round(amount * 100) / 100 }); };
  const setEffect = (key: EffectSwitch, on: boolean) => { if (value) onChange({ ...value, effects: { ...value.effects, [key]: on } }); };
  return (
    <section aria-label="Appearance" data-testid="theme-picker" className="flex min-w-0 flex-col gap-3">
      <h2 className={HEADING}>Scene</h2>
      <Row label="Scene" entries={registry.scenes()} value={value} mode={mode} onPick={pick} hub={hub} />
      <h2 className={cn(HEADING, "mt-2")}>Classic</h2>
      <Row label="Classic" entries={registry.classics()} value={value} mode={mode} onPick={pick} hub={hub}
        before={<Card id="none" name="None" checked={!value} onPick={() => onChange(null)} palette={null} custom={false} large={false} preview={<span aria-hidden className="absolute inset-0 bg-[var(--sidebar,var(--background))]" />} />} />
      <div className="mt-3 grid grid-cols-1 gap-x-10 gap-y-4 border-t border-border pt-4 text-xs md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          {SLIDERS.map((slider) => (
            <label key={slider.key} className="grid grid-cols-[100px_1fr_40px] items-center gap-3 text-foreground">
              <span>{slider.label}</span>
              <Slider aria-label={slider.label} min={0} max={1} step={0.01} disabled={!scene} value={[value?.[slider.key] ?? 0]}
                onValueChange={([amount]) => { if (amount !== undefined) setSlider(slider.key, amount); }} />
              <output data-testid={`theme-${slider.key}`} className="text-right tabular-nums text-muted-foreground">{scene && value ? `${Math.round(value[slider.key] * 100)}%` : "–"}</output>
            </label>
          ))}
          <div className="grid grid-cols-[100px_1fr] items-center gap-3 text-foreground">
            <span>Palette</span>
            {theme ? <Swatches colors={theme.palette} label /> : <span className="text-muted-foreground">–</span>}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {SWITCHES.map((each) => (
            <label key={each.key} className="flex items-center gap-3 text-foreground">
              <span className="flex-1">{each.label}</span>
              <Switch aria-label={each.label} disabled={!value || (each.scene && !scene)} checked={!!value?.effects[each.key] && (!each.scene || scene)} onCheckedChange={(on) => setEffect(each.key, on)} />
            </label>
          ))}
          <label className="flex items-center gap-3 text-foreground">
            <span className="flex-1">Use on every Bot</span>
            <Switch aria-label="Use on every Bot" checked={everyBot} onCheckedChange={onEveryBot} />
          </label>
        </div>
      </div>
      {theme && declared.length ? <ThemeOptionRows themeId={theme.id} options={declared} client={options} /> : null}
      {report ? <p role="status" data-testid="theme-check" data-pass={report.pass} className={cn("text-xs", report.pass ? "text-muted-foreground" : "text-destructive")}>{checkSummary(report)}</p> : null}
      {after}
      <div data-testid="theme-picker-actions" className={cn("mt-2 flex items-center gap-2", actionsClassName)}>
        <Button type="button" variant="outline" size="sm" disabled={!theme} onClick={() => { if (theme) onChange(defaultAppearance(theme)); }}>Reset</Button>
        <span className="flex-1" />
        {actions}
      </div>
    </section>
  );
}
