import { BotPresence } from "../../presence/ui/BotPresence";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { inHostWindow } from "../../kit/app/windows";
import { STUDIO_PLUGIN_ID } from "../../kit/contract";
import { errorMessage } from "../../kit/format";
import { Popover, PopoverAnchor, PopoverContent } from "../../kit/ui/popover";
import { cn } from "../../kit/ui/utils";
import { shownBot } from "../../ui/conversations/BotSidebarPanel";
import { useAppMode } from "../../ui/conversations/app-mode";
import { useCurrentBot } from "../../ui/conversations/state";
import { useCall, useLive } from "../../ui/live";
import type { Appearance } from "../appearance";
import type { ThemeRegistry } from "../registry";
import type { Mode } from "../schema";
import type { PreviewHub } from "./preview";
import { appearanceFor, gridMove, isGridKey, NONE_ID, popoverGroups, saveTheme, setThemePopoverOpen, setThemeQuickRuntime, themeChoices, useThemePopoverOpen, type ThemeChoice } from "./quick";
import { appearanceDraft, setAppearanceDraft, shownAppearance, useAppearanceDraft, useThemeRegistry, type AppearanceDraft } from "./state";
import { ClassicPreview, FRAME, ScenePreview, usePreviewHub } from "./ThemePicker";

export const THEME_FOOTER_ID = "theme";
export const THEME_FOOTER_LABEL = "Theme";
const THUMB_GRID = "grid grid-cols-3 gap-2";
const GROUP_HEAD = "px-0.5 text-xs font-medium text-muted-foreground";

export interface ThemeGridProps {
  registry: ThemeRegistry;
  mode: Mode;
  value: Appearance | null;
  onPreview(choice: ThemeChoice): void;
  onPick(choice: ThemeChoice): void;
  makePreviews?: () => PreviewHub;
}

export function ThemeGrid({ registry, mode, value, onPreview, onPick, makePreviews }: ThemeGridProps) {
  const groups = useMemo(() => popoverGroups(themeChoices(registry)), [registry]);
  const flat = useMemo(() => groups.flatMap((group) => group.choices), [groups]);
  const sizes = useMemo(() => groups.map((group) => group.choices.length), [groups]);
  const checkedId = value?.themeId ?? null;
  const [active, setActive] = useState(() => Math.max(0, flat.findIndex((choice) => choice.id === checkedId)));
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const hub = usePreviewHub(makePreviews);
  const preview = useRef(onPreview);
  preview.current = onPreview;
  const current = flat[active] ?? null;
  useEffect(() => { hub?.setSelected(checkedId); }, [hub, checkedId]);
  useEffect(() => { hub?.setHovered(current?.theme?.kind === "scene" ? current.theme.id : null); }, [hub, current]);
  useEffect(() => { if (current) preview.current(current); }, [current]);
  useEffect(() => { buttons.current[active]?.focus({ preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isGridKey(event.key)) return;
    event.preventDefault();
    buttons.current[gridMove(sizes, active, event.key)]?.focus({ preventScroll: true });
  };
  let index = -1;
  return (
    <div role="radiogroup" aria-label="Theme" data-testid="theme-grid" onKeyDown={onKeyDown} className="flex flex-col gap-2">
      {groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} data-testid={`theme-group-${group.label.toLowerCase()}`} className="flex flex-col gap-1.5">
          <h3 className={GROUP_HEAD}>{group.label}</h3>
          <div className={THUMB_GRID}>
            {group.choices.map((choice) => {
              index += 1;
              const at = index;
              const checked = choice.id === checkedId;
              return (
                <button key={choice.id ?? NONE_ID} ref={(node) => { buttons.current[at] = node; }} type="button" role="radio" aria-checked={checked} aria-label={choice.name}
                  tabIndex={at === active ? 0 : -1} data-testid="theme-thumb" data-theme-id={choice.id ?? NONE_ID} data-active={at === active ? "" : undefined}
                  onFocus={() => setActive(at)} onPointerEnter={(event) => event.currentTarget.focus({ preventScroll: true })} onClick={() => onPick(choice)}
                  className="group flex min-w-0 flex-col gap-1 rounded-lg text-left outline-none">
                  <span className={cn(FRAME, "h-[70px] w-full group-data-[active]:ring-2 group-data-[active]:ring-ring", checked && "ring-2 ring-primary group-data-[active]:ring-primary")}>
                    {choice.theme ? (choice.theme.kind === "scene" ? <ScenePreview theme={choice.theme} hub={hub} /> : <ClassicPreview theme={choice.theme} mode={mode} />) : <span aria-hidden className="absolute inset-0 bg-[var(--sidebar,var(--background))]" />}
                    {choice.custom ? <span data-testid="theme-custom" className="absolute right-1 top-1 rounded-sm bg-muted px-1 text-xs text-muted-foreground">Custom</span> : null}
                  </span>
                  <span className="flex min-w-0 items-center gap-1 px-0.5 text-xs text-foreground">
                    <span className="truncate">{choice.name}</span>
                    {checked ? <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const FOOTER_BUTTON = `[data-testid="plugin-sidebar-footer-item-${STUDIO_PLUGIN_ID}-${THEME_FOOTER_ID}"]`;
const ANCHORS = [FOOTER_BUTTON, "#sidebar-footer-more", '[data-testid="space-dots"]'];

export function themePopoverAnchor(doc: Document = document): { getBoundingClientRect(): DOMRect } {
  for (const selector of ANCHORS) {
    const found = doc.querySelector<HTMLElement>(selector);
    if (found) return found;
  }
  const view = doc.defaultView;
  return { getBoundingClientRect: () => new DOMRect(12, (view?.innerHeight ?? 0) - 12, 0, 0) };
}

function ThemeQuick({ makePreviews }: { makePreviews?: () => PreviewHub }) {
  const call = useCall();
  const spaces = useLive("bot_spaces", {}, { pollMs: 60_000 });
  const chosen = useCurrentBot();
  const overrides = useAppearanceDraft();
  const registry = useThemeRegistry();
  const mode = useAppMode();
  const open = useThemePopoverOpen();
  const bots = spaces.data?.bots;
  const bot = shownBot(bots ?? [], chosen, spaces.data?.currentBotId ?? null);
  const botId = bot?.id ?? null;
  const applied = shownAppearance(bot, { draft: null, saved: overrides.saved });
  const anchor = useRef<{ getBoundingClientRect(): DOMRect } | null>(null);
  const held = useRef<AppearanceDraft | null>(null);
  if (open && !anchor.current) {
    anchor.current = themePopoverAnchor();
    held.current = appearanceDraft();
  }
  if (!open) anchor.current = null;

  useEffect(() => {
    setThemeQuickRuntime({ bots: bots ?? [], shownBotId: botId, registry, save: (id, appearance) => call("bot_set_appearance", { botId: id, appearance }) });
    return () => setThemeQuickRuntime(null);
  }, [bots, botId, registry, call]);

  useEffect(() => {
    if (!open || !botId) return;
    const before = held.current;
    return () => {
      if (before) setAppearanceDraft(before.botId, before.appearance);
      else setAppearanceDraft(botId, null, false);
    };
  }, [open, botId]);
  useEffect(() => { if (open && spaces.data && !botId) setThemePopoverOpen(false); }, [open, spaces.data, botId]);
  useEffect(() => () => setThemePopoverOpen(false), []);

  if (!open || !bot) return null;
  const pick = (choice: ThemeChoice) => {
    saveTheme({ bot, themeId: choice.id, registry, save: (id, appearance) => call("bot_set_appearance", { botId: id, appearance }) })
      .catch((cause: unknown) => { toast.error(errorMessage(cause) || "Couldn't apply the theme."); });
    setThemePopoverOpen(false);
  };
  const onOutside = (event: { target: EventTarget | null; preventDefault(): void }) => {
    const button = document.querySelector(FOOTER_BUTTON);
    if (button && event.target instanceof Node && button.contains(event.target)) event.preventDefault();
  };
  return (
    <Popover open onOpenChange={(next) => { if (!next) setThemePopoverOpen(false); }}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent side="top" align="start" sideOffset={8} aria-label={THEME_FOOTER_LABEL} data-testid="theme-popover"
        className="w-[380px] rounded-[8px] border-0 p-3" onOpenAutoFocus={(event) => event.preventDefault()} onInteractOutside={onOutside}>
        <div data-testid="theme-popover-bot" className="mb-2.5 flex min-w-0 items-center gap-2">
          <BotPresence bot={bot} size={24} />
          <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">{bot.name}</span>
        </div>
        <ThemeGrid registry={registry} mode={mode} value={applied} makePreviews={makePreviews}
          onPreview={(choice) => setAppearanceDraft(bot.id, appearanceFor(applied, choice.theme))} onPick={pick} />
      </PopoverContent>
    </Popover>
  );
}

export function ThemeQuickHost({ makePreviews }: { makePreviews?: () => PreviewHub }) {
  return inHostWindow() ? null : <ThemeQuick makePreviews={makePreviews} />;
}
