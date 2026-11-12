// Edit space: one view over BB's main view (in the sidebar, in place of the
// lists, where BB has none). The Bot's name, its presence (src/presence: a
// form, its color source and motion), its appearance (the theme picker: a scene or
// a classic theme, its sliders and effects) and its default model (what its
// new conversations start on, bb's provider and model picker). Save writes
// bot_set, bot_set_presence, bot_set_appearance and bot_set_default_model;
// Cancel and Esc leave it as it was. The window shows the chosen theme and
// presence while it is open.
//
// Every control is bb's own, as its Settings pages compose them (vendored in
// src/kit/ui): SettingsWithControl for the form, Input, Button and the
// segmented ToggleGroup (bb's model picker's Reasoning row).
import { useEffect, useState } from "react";
import type { BotSpace } from "../../bot-threads-contract";
import { errorMessage } from "../../kit/format";
import { Button } from "../../kit/ui/button";
import { Icon } from "../../kit/ui/icon";
import { Input } from "../../kit/ui/input";
import { SettingsWithControl } from "../../kit/ui/settings-section";
import { BotPresence } from "../../presence/ui/BotPresence";
import { PresenceSection } from "../../presence/ui/PresenceSection";
import { markPresenceSaved, setPresenceDraft } from "../../presence/ui/state";
import { defaultPresence, samePresence, type Presence } from "../../presence/schema";
import { defaultChanged, DefaultModelPicker, saveDefault, startingDefault, type DefaultModelChoice } from "../bot/DefaultModel";
import { useCall, useLive } from "../live";
import { sameAppearance, type Appearance } from "../../theme/appearance";
import { ThemePicker } from "../../theme/ui/ThemePicker";
import { forgetSavedAppearance, markAppearanceSaved, setAppearanceDraft, useThemeRegistry } from "../../theme/ui/state";
import { EditSpaceStage, type StageRect } from "./EditSpaceStage";
import { useAppMode } from "./app-mode";
import { useGlass } from "../../theme/glass";

export const SIDEBAR_ACTIONS = "sticky bottom-0 z-20 -mx-1 flex justify-end gap-2 border-t border-border bg-[var(--sidebar,var(--background))] px-2 py-2";
export const STAGE_SURFACE = "bg-[var(--canvas,var(--background))]";
export const STAGE_ACTIONS = `sticky -bottom-5 z-20 -mx-5 -mb-5 rounded-b-xl border-t border-border ${STAGE_SURFACE} px-5 py-3`;
export const STAGE_TITLE_ROW = `sticky top-0 z-20 -mx-5 flex h-11 shrink-0 items-center gap-2 rounded-t-xl ${STAGE_SURFACE} px-5`;
export const STAGE_PANE_BARE = "mx-auto flex max-h-full w-full min-w-0 max-w-[900px] flex-col gap-3 overflow-x-hidden overflow-y-auto rounded-[var(--studio-card-radius,8px)] bg-[color-mix(in_oklab,var(--background)_80%,transparent)] px-5 pt-4 pb-5 shadow-lg backdrop-blur-xl";
export const STAGE_BARE_TITLE_ROW = "mx-auto flex h-(--bb-window-title-bar-height,2.75rem) w-full max-w-[900px] shrink-0 items-center gap-2 px-5";
export const STAGE_FRAME_BARE = "flex min-h-0 flex-1 flex-col overflow-hidden px-4";
export const STAGE_FRAME = "flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-[calc(var(--bb-window-title-bar-height,2.75rem)+1px)]";
export const STAGE_PANE = "mx-auto flex max-h-full w-full min-w-0 max-w-[900px] flex-col gap-3 overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-[color-mix(in_oklab,var(--background)_80%,transparent)] px-5 pb-5 shadow-lg backdrop-blur-xl";

export function appearanceTargets(botId: string, before: Appearance | null, next: Appearance | null, everyBot: readonly { id: string; appearance?: Appearance | null }[] | null): string[] {
  return everyBot ? everyBot.filter((each) => !sameAppearance(each.appearance ?? null, next)).map((each) => each.id) : sameAppearance(before, next) ? [] : [botId];
}

export async function saveAppearance(call: ReturnType<typeof useCall>, botId: string, before: Appearance | null, next: Appearance | null, everyBot: readonly { id: string; appearance?: Appearance | null }[] | null): Promise<void> {
  const targets = appearanceTargets(botId, before, next, everyBot);
  markAppearanceSaved(targets, next);
  try {
    for (const id of targets) await call("bot_set_appearance", { botId: id, appearance: next });
  } catch (cause) {
    forgetSavedAppearance(targets);
    throw cause;
  }
}

export function EditSpace({ bot, bots, onClose, stage = null }: { bot: BotSpace; bots?: readonly BotSpace[]; onClose(): void; stage?: StageRect | null }) {
  const call = useCall();
  const stored = useLive("bot_get", { botId: bot.id }, { pollMs: 0 });
  const [model, setModel] = useState<DefaultModelChoice | null>(null);
  const [name, setName] = useState(bot.name);
  const [saved] = useState<Presence>(() => bot.presence ?? defaultPresence(bot.id, bot.primary));
  const [presence, setPresence] = useState<Presence>(saved);
  const [appearance, setAppearance] = useState<Appearance | null>(bot.appearance ?? null);
  const [everyBot, setEveryBot] = useState(false);
  const registry = useThemeRegistry();
  const appMode = useAppMode();
  const glass = useGlass();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setAppearanceDraft(bot.id, appearance); }, [bot.id, appearance]);
  useEffect(() => () => setAppearanceDraft(bot.id, null, false), [bot.id]);
  useEffect(() => { setPresenceDraft(bot.id, presence); }, [bot.id, presence]);
  useEffect(() => () => setPresenceDraft(bot.id, null), [bot.id]);
  useEffect(() => {
    // An open popover takes Esc first (Radix marks it handled); Esc here closes the panel.
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    const nextName = name.trim();
    if (!nextName) return;
    setBusy(true);
    setError(null);
    try {
      if (nextName !== bot.name) await call("bot_set", { botId: bot.id, name: nextName });
      if (!samePresence(presence, saved)) { await call("bot_set_presence", { botId: bot.id, presence }); markPresenceSaved(bot.id, presence); }
      await saveAppearance(call, bot.id, bot.appearance ?? null, appearance, everyBot ? bots ?? [bot] : null);
      const storedBot = stored.data?.bot ?? null;
      if (model && defaultChanged(storedBot, model)) await saveDefault(call, bot.id, model);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause) || "Couldn't save the space.");
    } finally {
      setBusy(false);
    }
  };

  const actions = (
    <>
      <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
      <Button type="button" size="sm" data-testid="edit-space-save" disabled={busy || !name.trim()} onClick={() => void save()}>Save</Button>
    </>
  );
  const nameField = (
    <SettingsWithControl label="Name" controlPlacement="below">
      <div className="flex items-center gap-2">
        <BotPresence bot={bot} size={28} />
        <Input aria-label="Name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
      </div>
    </SettingsWithControl>
  );
  const presenceField = (
    <SettingsWithControl label="Presence" controlPlacement="below">
      <PresenceSection bot={{ ...bot, name: name.trim() || bot.name }} value={presence} onChange={setPresence} stageSize={stage ? 160 : 120}
        onAsk={async (prompt) => { const answer = await call("presence_ask", { botId: bot.id, prompt }); if (!answer.sent) throw new Error(`${bot.name} has no chat yet.`); }} />
    </SettingsWithControl>
  );
  const modelField = (
    <div data-testid="edit-space-model" className="border-t border-border pt-4">
      <SettingsWithControl label="Default model" controlPlacement="below">
        {stored.data ? <DefaultModelPicker value={model ?? startingDefault(stored.data.bot)} disabled={busy} onChange={setModel} /> : null}
      </SettingsWithControl>
    </div>
  );
  const errorLine = error ? <p role="alert" className="px-1 text-xs text-destructive">{error}</p> : null;
  const picker = (
    <ThemePicker registry={registry} mode={appMode} value={appearance} onChange={setAppearance} everyBot={everyBot} onEveryBot={setEveryBot}
      after={<>{modelField}{errorLine}</>} actions={actions} actionsClassName={stage ? STAGE_ACTIONS : SIDEBAR_ACTIONS} />
  );
  const shownTheme = appearance ? registry.get(appearance.themeId) : null;
  const titleRow = (className: string) => (
    <header data-testid="edit-space-title-row" className={className}>
      <h2 className="text-sm font-semibold">Edit space</h2>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{name.trim() || bot.name}</span>
      <Button type="button" variant="ghost" size="icon" aria-label="Close" data-testid="edit-space-close" className="-mr-1.5 size-7" onClick={onClose}><Icon name="X" className="size-4" /></Button>
    </header>
  );
  if (stage) {
    return (
      <EditSpaceStage rect={stage} scene={shownTheme?.kind === "scene"}>
        <section aria-label="Edit space" data-testid="edit-space" className="flex min-h-0 flex-1 flex-col">
          <div data-testid="edit-space-scroll" className={glass ? STAGE_FRAME_BARE : STAGE_FRAME}>
            {glass ? titleRow(STAGE_BARE_TITLE_ROW) : null}
            <div data-testid="edit-space-pane" className={glass ? STAGE_PANE_BARE : STAGE_PANE}>
              {glass ? null : titleRow(STAGE_TITLE_ROW)}
              <div data-testid="edit-space-profile" className="flex flex-col gap-4 border-b border-border pb-4"><div className="w-full max-w-sm">{nameField}</div>{presenceField}</div>
              {picker}
            </div>
          </div>
        </section>
      </EditSpaceStage>
    );
  }
  return (
    <section aria-label="Edit space" data-testid="edit-space" data-studio-no-drag="all" className="flex flex-col gap-3 px-1 pt-3">
      <h2 className="px-2 text-sm font-semibold">Edit space</h2>
      <div data-testid="edit-space-profile" className="flex flex-col gap-5 px-2">{nameField}{presenceField}</div>
      <div className="px-2">{picker}</div>
    </section>
  );
}
