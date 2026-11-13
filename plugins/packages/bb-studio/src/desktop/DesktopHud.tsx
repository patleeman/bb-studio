import { ThreadChat, useComposer, useSdk, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { hostWindowId, useHostWindows, windowParams } from "../kit/app/windows";
import { activityLine, desktopHudWindowOptions, pinsToInsert } from "./hud-model";
import { useHostAppRoute } from "../kit/app/host-sdk";
import { Button, Icon, Tooltip } from "../kit/ui/index";
import { useStudioSettings } from "../settings/ui/use-settings";
import { talk } from "../talk/ui/controller";
import {
  allGranted,
  DESKTOP_HUD_WINDOW_ID,
  threadIdFromPath,
  useDesktopControl,
  type DesktopControl,
  type DesktopPin,
} from "./host";
import { PermissionsSheet, readTalkKey, usePermissionPolling } from "./PermissionsSheet";
import { desktopHudOn } from "./gate";
import { encodePinMention, pinChipLabel, pinFacts, PIN_MENTION_PROVIDER } from "./pins";


function browserScreen() {
  return typeof window === "undefined" ? undefined : (window.screen as Screen & { availLeft?: number; availTop?: number });
}

function useThreadTitle(threadId: string | null): string | null {
  const sdk = useSdk();
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    if (threadId === null) return;
    let live = true;
    void sdk.threads
      .get({ threadId })
      .then((thread: { title?: string | null; titleFallback?: string | null }) => {
        if (live) setTitle(thread.title ?? thread.titleFallback ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sdk, threadId]);
  return title;
}

function useThreadHostId(threadId: string | null): string | null {
  const sdk = useSdk();
  const [hostId, setHostId] = useState<string | null>(null);
  useEffect(() => {
    if (threadId === null) return;
    let live = true;
    void (async () => {
      const thread = (await sdk.threads.get({ threadId }).catch(() => null)) as { environmentId?: string | null } | null;
      if (!thread?.environmentId) return;
      const environment = (await sdk.environments.get({ environmentId: thread.environmentId }).catch(() => null)) as { hostId?: string | null } | null;
      if (live && environment?.hostId) setHostId(environment.hostId);
    })();
    return () => {
      live = false;
    };
  }, [sdk, threadId]);
  return hostId;
}

export const DESKTOP_HUD_HOTKEY = "Alt+Shift+Space";

export function DesktopHudWindow() {
  const { values } = useStudioSettings();
  if (!desktopHudOn(values)) return null;
  return <DesktopHudPanel />;
}

function DesktopHudPanel() {
  const threadId = windowParams().thread ?? null;
  const control = useDesktopControl();
  const title = useThreadTitle(threadId);
  const [sheet, setSheet] = useState(false);
  const state = control.state;
  const ready = allGranted(state);
  usePermissionPolling(control, !ready);

  useEffect(() => {
    void control.request({ op: "hud", shown: true, threadId });
  }, [control, threadId]);

  useEffect(() => {
    void control.request({ op: "talkKey", key: readTalkKey() });
  }, [control]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[role=dialog], [role=menu], [role=listbox]")) return;
      if (control.state?.activity && control.state.activity.phase !== "stopped") void control.request({ op: "stop" });
      else void control.request({ op: "hud", shown: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [control]);

  const togglePointing = () => {
    if (!ready) {
      setSheet(true);
      return;
    }
    void control.request({ op: "pointing", on: !(state?.pointing ?? false) });
  };

  return (
    <div className="h-dvh w-dvw p-2" data-desktop-hud="">
      <section className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-2xl" aria-label="BB Studio HUD">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3.5 text-xs text-muted-foreground" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
          <span className="truncate font-semibold text-foreground">{title ?? "Conversation"}</span>
          <span className="flex-1" />
          <div className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <Tooltip label={state?.pointing ? "Stop pointing" : "Point"}>
              <Button size="icon" variant="ghost" className="size-7" aria-label="Pointing mode" aria-pressed={state?.pointing ?? false} onClick={togglePointing} data-desktop-point="">
                <Icon name="Pin" />
              </Button>
            </Tooltip>
            <Tooltip label="Back to BB Studio · esc">
              <Button size="icon" variant="ghost" className="size-7" aria-label="Back to BB Studio" onClick={() => void control.request({ op: "hud", shown: false })} data-desktop-back="">
                <Icon name="ArrowUpRight" />
              </Button>
            </Tooltip>
          </div>
        </header>
        {!ready && state?.permissions.checked ? (
          <div className="shrink-0 border-b border-border px-3.5 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-muted-foreground">Pointing needs three macOS permissions</span>
              <Button size="sm" variant="secondary" onClick={() => setSheet(true)}>
                Check
              </Button>
            </div>
          </div>
        ) : null}
        <div className="min-h-0 flex-1">{threadId === null ? <div className="p-4 text-sm text-muted-foreground">No conversation</div> : <ThreadChat threadId={threadId} variant="compact" />}</div>
      </section>
      <PermissionsSheet
        control={control}
        open={sheet}
        onOpenChange={setSheet}
        onStart={() => {
          setSheet(false);
          void control.request({ op: "pointing", on: true });
        }}
      />
    </div>
  );
}

function promptboxOf(marker: HTMLElement | null): HTMLElement | null {
  return marker?.closest<HTMLElement>("[data-promptbox-shell]")?.querySelector<HTMLElement>("[data-promptbox]") ?? null;
}


function insertPin(composer: PluginComposerApi, pin: DesktopPin): void {
  const facts = pinFacts(pin);
  composer.insert(
    [{ provider: PIN_MENTION_PROVIDER, id: encodePinMention(facts), label: pinChipLabel(facts) }, " "],
    { at: "end" },
  );
}

function attachImage(composer: PluginComposerApi, pin: DesktopPin, hostId: string): void {
  if (pin.imagePath === null) return;
  const path = pin.imagePath;
  composer.replace((current) => {
    if (current.attachments.some((attachment) => attachment.path === path)) return current;
    return {
      text: current.text,
      mentions: current.mentions,
      attachments: [...current.attachments, { type: "localImage", path, name: `pin-${String(pin.number)}.png`, mimeType: "image/png", hostId }],
    };
  });
}

export function DesktopComposerBridge() {
  const { values } = useStudioSettings();
  if (hostWindowId() !== DESKTOP_HUD_WINDOW_ID || !desktopHudOn(values)) return null;
  return <DesktopHudBridge />;
}

function DesktopHudBridge() {
  const composer = useComposer();
  const control = useDesktopControl();
  const state = control.state;
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const hostId = useThreadHostId(threadId);
  const marker = useRef<HTMLSpanElement>(null);
  const inserted = useRef(new Set<string>());
  const attached = useRef(new Set<string>());
  const wasTalking = useRef(false);
  const dictation = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => composer.onSubmitted(() => {
    if (control.state?.activity?.phase === "stopped") void control.request({ op: "resume" });
  }), [composer, control]);

  useEffect(() => {
    if (state === null || threadId === null) return;
    const fresh = pinsToInsert(state, threadId, inserted.current);
    for (const pin of fresh) {
      inserted.current.add(pin.id);
      try {
        insertPin(composer, pin);
      } catch (error) {
        toast.error(`Couldn't add pin ${String(pin.number)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (fresh.length > 0) void control.request({ op: "pinsTaken", ids: fresh.map((pin) => pin.id) });
    if (hostId !== null) {
      for (const pin of state.pins) {
        if (pin.threadId !== threadId || pin.imagePath === null || attached.current.has(pin.id)) continue;
        if (!inserted.current.has(pin.id) && !pin.taken) continue;
        attached.current.add(pin.id);
        attachImage(composer, pin, hostId);
      }
    }
    const talking = state.talking;
    if (talking && !wasTalking.current) {
      wasTalking.current = true;
      if (!talk.isActive()) dictation.current = talk.toggleDictation(promptboxOf(marker.current)).catch(() => {});
    } else if (!talking && wasTalking.current) {
      wasTalking.current = false;
      void dictation.current.then(() => (talk.isDictating() ? talk.stop(true) : undefined));
    }
  }, [state, threadId, hostId, composer, control]);

  return (
    <>
      <span hidden ref={marker} data-desktop-composer-bridge="" />
      <DesktopRows control={control} threadId={threadId} />
    </>
  );
}


function DesktopRows({ control, threadId }: { control: DesktopControl; threadId: string | null }) {
  const state = control.state;
  if (state === null || threadId === null) return null;
  const ask = state.ask !== null && state.ask.threadId === threadId ? state.ask : null;
  const line = activityLine(state, threadId);
  if (ask === null && line === null) return null;
  return (
    <div className="flex flex-col gap-2 px-2 pt-2" data-desktop-rows="">
      {line !== null ? (
        <div role="status" className="flex items-center gap-2 rounded-lg bg-accent px-2.5 py-2 text-xs" data-desktop-status="">
          <span className="size-2 shrink-0 rounded-full bg-sky-400" />
          <span className="flex-1">{line}</span>
          {state.activity?.phase === "stopped" ? (
            <Button size="sm" variant="secondary" className="h-7" onClick={() => void control.request({ op: "resume" })}>
              Resume
            </Button>
          ) : (
            <Button size="sm" variant="secondary" className="h-7" onClick={() => void control.request({ op: "stop" })} data-desktop-stop="">
              Stop · esc
            </Button>
          )}
        </div>
      ) : null}
      {ask !== null ? (
        <div role="alertdialog" aria-label="Let it drive" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-xs" data-desktop-ask="">
          <p className="mb-2.5">
            <span className="font-semibold">{ask.agent}</span>
            {ask.app === null ? "" : ` · ${ask.app}`} · {ask.reason}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void control.request({ op: "answer", id: ask.id, answer: "session" })} data-desktop-answer="session">
              Let it drive this session
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void control.request({ op: "answer", id: ask.id, answer: "once" })} data-desktop-answer="once">
              Just this once
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void control.request({ op: "answer", id: ask.id, answer: "no" })} data-desktop-answer="no">
              No
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DesktopHudButton() {
  const { values } = useStudioSettings();
  if (!desktopHudOn(values)) return null;
  return <DesktopHudOpenButton />;
}

function DesktopHudOpenButton() {
  const composer = useComposer();
  const control = useDesktopControl();
  const windows = useHostWindows();
  const [sheet, setSheet] = useState(false);
  if (!control.native || !control.state?.supported || hostWindowId() !== null) return null;
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  if (threadId === null) return null;
  const hotkey = DESKTOP_HUD_HOTKEY;
  const open = (pointing: boolean) => {
    void windows.open(DESKTOP_HUD_WINDOW_ID, desktopHudWindowOptions(threadId, hotkey, browserScreen())).then(() => {
      if (pointing) setTimeout(() => void control.request({ op: "pointing", on: true }), 600);
    });
  };
  return (
    <>
      <Tooltip label="Desktop HUD">
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="Desktop HUD"
          data-desktop-hud-button=""
          onClick={() => (allGranted(control.state) ? open(false) : setSheet(true))}
        >
          <Icon name="AppWindow" />
        </Button>
      </Tooltip>
      <PermissionsSheet
        control={control}
        open={sheet}
        onOpenChange={setSheet}
        onStart={() => {
          setSheet(false);
          open(true);
        }}
        onNotNow={() => {
          setSheet(false);
          open(false);
        }}
      />
    </>
  );
}

const noRoute = () => null;
const useRoute: () => { pathname: string } | null = useHostAppRoute ?? noRoute;

export function DesktopHudHotkey() {
  const control = useDesktopControl();
  const windows = useHostWindows();
  const { values } = useStudioSettings();
  const route = useRoute();
  const threadId = route === null ? null : threadIdFromPath(route.pathname);
  const hotkey = desktopHudOn(values) ? DESKTOP_HUD_HOTKEY : null;
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!control.native || hotkey === null || hostWindowId() !== null || !control.state?.supported) return;
    const key = `${threadId ?? ""}|${hotkey}`;
    if (last.current === key) return;
    last.current = key;
    void windows.register(DESKTOP_HUD_WINDOW_ID, desktopHudWindowOptions(threadId, hotkey, browserScreen()));
  }, [control.native, control.state?.supported, hotkey, threadId, windows]);
  return null;
}
