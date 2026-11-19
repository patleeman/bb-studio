// The first chat's one line when a bb install is on this Mac: "Bring things
// over from bb", which opens the Settings section. It goes away once something
// was brought over, or when dismissed.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { GHOST_BUTTON } from "../../kit/app/index";
import { registerThreadBanner } from "../../kit/app/host-sdk";
import { openAppPath } from "../../kit/app/nav";
import { STUDIO_SETTINGS_PATH } from "../../settings/ui/voice-anchor";
import { useLive } from "../../ui/live";
import { readBringOver } from "../api";
import { requestBringOverSection } from "./BringOverSection";

const DISMISSED_KEY = "studio.bringOver.linkDismissed";
const storage = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

let offered: Promise<boolean> | null = null;
/** Whether bb is there and nothing was brought over yet; asked once per session. */
export function bringOverOffered(load: typeof fetch = fetch): Promise<boolean> {
  offered ??= readBringOver(load).then((state) => state.available && !state.job);
  return offered;
}
export function resetBringOverOfferForTests(): void { offered = null; }

export function BringOverLink({ threadId }: { threadId: string }) {
  const [offer, setOffer] = useState(false);
  useEffect(() => {
    let current = true;
    if (storage()?.getItem(DISMISSED_KEY) !== "1") void bringOverOffered().then((next) => { if (current) setOffer(next); });
    return () => { current = false; };
  }, []);
  return offer ? <WelcomeOnly threadId={threadId} onDismiss={() => { storage()?.setItem(DISMISSED_KEY, "1"); setOffer(false); }} /> : null;
}

function WelcomeOnly({ threadId, onDismiss }: { threadId: string; onDismiss(): void }) {
  const welcome = useLive("bot_welcome", {});
  if (welcome.data?.threadId !== threadId) return null;
  return (
    <div data-testid="bring-over-link" className="studio-root flex shrink-0 items-center gap-2 px-5 py-1.5 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1">bb is on this Mac.</span>
      <button type="button" className={GHOST_BUTTON} onClick={() => { requestBringOverSection(); openAppPath(STUDIO_SETTINGS_PATH); }}>Bring things over from bb</button>
      <button type="button" className={GHOST_BUTTON} onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

export function registerBringOverLink(app: PluginAppBuilder): void {
  registerThreadBanner(app.slots, { id: "bring-over-link", component: BringOverLink });
}
