// "Show HUD" on the Bot page, on a BB with plugin windows (src/hud/shared.ts).
import { ICON_BUTTON, OUTLINE_BUTTON } from "../../kit/app/index";
import { Icon } from "../../kit/ui/index";
import { hasHostWindows, useHostWindows } from "../../kit/app/windows";
import { useStudioSettings } from "../../settings/ui/use-settings";
import { useHudHotkey } from "../hotkey";
import { HUD_WINDOW_ID, hudWindowOptions } from "../shared";

/** Nothing on a BB without windows, or with the HUD off. */
export function ShowHudButton({ compact = false }: { compact?: boolean }) {
  return hasHostWindows ? <ShowHud compact={compact} /> : null;
}

function ShowHud({ compact }: { compact: boolean }) {
  const windows = useHostWindows();
  const { values } = useStudioSettings();
  // The shortcut BB holds, which is not the setting's when another app has that one.
  const { inUse, note } = useHudHotkey(values?.hudHotkey ?? "");
  if (!values?.hudEnabled) return null;
  const show = () => void windows.open(HUD_WINDOW_ID, hudWindowOptions({ hotkey: inUse, screen: window.screen }));
  return compact
    ? <button type="button" className={ICON_BUTTON} aria-label="Show HUD" title={note ? `Show HUD. ${note}` : "Show HUD"} data-testid="bot-show-hud" onClick={show}><Icon name="AppWindow" /></button>
    : (
      <>
        <button type="button" className={OUTLINE_BUTTON} data-testid="bot-show-hud" onClick={show}><Icon name="AppWindow" />Show HUD</button>
        {note ? <span role="status" data-testid="bot-hud-note" className="text-xs text-warning">{note}</span> : null}
      </>
    );
}
