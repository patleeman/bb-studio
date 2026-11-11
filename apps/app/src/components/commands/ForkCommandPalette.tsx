import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { pluginCommandId, pluginCommandIdSchema } from "@bb/domain";
import type { ExperimentalAppCommand } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import type { PluginSettingsCandidate } from "@/components/settings/plugin-settings-entries";
import { buildPluginSettingsEntries } from "@/components/settings/plugin-settings-entries";
import { useSettingsNavSections } from "@/components/settings/settings-nav";
import { pluginListQueryOptions } from "@/hooks/queries/plugin-settings-queries";
import { useRouteState } from "@/hooks/useRouteState";
import { useServerChoices } from "@/hooks/useServerChoices";
import { getFocusedAppPanelController } from "@/lib/app-fixed-tab-navigation";
import type { PaletteAction } from "@/lib/command-palette/palette-action";
import {
  buildAppCommandActions,
  PALETTE_COMMAND_IDS,
} from "@/lib/command-palette/palette-app-commands";
import {
  buildPluginComposerCommandActions,
  buildPluginPaletteActions,
} from "@/lib/command-palette/palette-plugin-actions";
import { buildPluginPagePaletteActions } from "@/lib/command-palette/palette-plugin-page-actions";
import { buildSettingsPaletteActions } from "@/lib/command-palette/palette-settings-actions";
import type { PluginCommandPaletteSlot } from "@/lib/fork-slots";
import { getPluginSlotSnapshot, usePluginSlots } from "@/lib/plugin-slots";
import {
  useAppCommandRunner,
  useAppCommandShortcuts,
} from "./AppCommandProvider";

interface PaletteSession {
  actions: readonly PaletteAction[];
  installedPlugins: readonly PluginSettingsCandidate[];
  choose(action: PaletteAction): void;
}

const PaletteSessionContext = createContext<PaletteSession | null>(null);

function firstPalette(
  slots: readonly PluginCommandPaletteSlot[],
): PluginCommandPaletteSlot | null {
  return (
    [...slots].sort(
      (a, b) =>
        a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
    )[0] ?? null
  );
}

export function forkCommandPaletteActive(): boolean {
  return getPluginSlotSnapshot().commandPalettes.length > 0;
}

let escapeHandler: (() => boolean) | null = null;

function claimEscape(handler: () => boolean): () => void {
  escapeHandler = handler;
  return () => {
    if (escapeHandler === handler) escapeHandler = null;
  };
}

export function forkCommandPaletteEscape(event: KeyboardEvent): boolean {
  if (escapeHandler === null || !forkCommandPaletteActive()) return false;
  let claimed = false;
  try {
    claimed = escapeHandler() === true;
  } catch (error) {
    console.error("Command palette Escape handler failed", error);
  }
  if (claimed) event.preventDefault();
  return claimed;
}

export interface ForkCommandPaletteProps {
  openCount: number;
  searching: boolean;
  actions: readonly PaletteAction[];
  installedPlugins: readonly PluginSettingsCandidate[];
  onChoose: (action: PaletteAction) => void;
  runAfterClose: (run: () => void) => void;
  children: ReactNode;
}

export function ForkCommandPalette({
  openCount,
  searching,
  actions,
  installedPlugins,
  onChoose,
  runAfterClose,
  children,
}: ForkCommandPaletteProps) {
  const slot = firstPalette(usePluginSlots().commandPalettes);
  const session = useMemo<PaletteSession>(
    () => ({ actions, installedPlugins, choose: onChoose }),
    [actions, installedPlugins, onChoose],
  );
  if (slot === null) return <>{children}</>;
  const Palette = slot.component;
  return (
    <PluginSlotMount
      key={`${slot.pluginId}/${slot.id}/${String(slot.generation)}/${String(openCount)}`}
      pluginId={slot.pluginId}
      slotKind="commandPalette"
      slotId={slot.id}
      crashFallback={children}
    >
      <PaletteSessionContext.Provider value={session}>
        <div
          data-fork-command-palette={`${slot.pluginId}/${slot.id}`}
          className="contents"
        >
          <Palette
            initialMode={searching ? "search" : "commands"}
            experimental_onEscape={claimEscape}
            close={(then) =>
              runAfterClose(typeof then === "function" ? then : () => {})
            }
          />
        </div>
      </PaletteSessionContext.Provider>
    </PluginSlotMount>
  );
}

function useRefreshOnFocus(enabled: boolean): void {
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!enabled) return;
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [enabled]);
}

function useLiveCommandActions(enabled: boolean): readonly PaletteAction[] {
  useRefreshOnFocus(enabled);
  const runner = useAppCommandRunner();
  const shortcuts = useAppCommandShortcuts(PALETTE_COMMAND_IDS);
  const { commandPaletteActions } = usePluginSlots();
  const { threadId, projectId } = useRouteState();
  const pluginCommandIds = useMemo(
    () =>
      commandPaletteActions.map((command) =>
        pluginCommandId(command.pluginId, command.id),
      ),
    [commandPaletteActions],
  );
  const pluginShortcuts = useAppCommandShortcuts(pluginCommandIds);
  if (!enabled) return [];
  return [
    ...buildAppCommandActions({
      target: null,
      isCommandAvailable: runner.isCommandAvailable,
      dispatch: runner.dispatch,
      shortcuts,
    }),
    ...[
      ...buildPluginPaletteActions({
        slots: commandPaletteActions.filter(
          (command) => command.target === "app",
        ),
        threadId: threadId ?? null,
        projectId: projectId ?? null,
        panel: getFocusedAppPanelController(),
      }),
      ...buildPluginComposerCommandActions({
        slots: commandPaletteActions.filter(
          (command) => command.target === "composer",
        ),
        target: null,
        isCommandAvailable: runner.isCommandAvailable,
        dispatch: runner.dispatch,
      }),
    ].map((action) => ({
      ...action,
      shortcut:
        pluginShortcuts.get(pluginCommandIdSchema.parse(action.id)) ?? null,
    })),
  ];
}

function usePageActions(
  installedPlugins: readonly PluginSettingsCandidate[],
): readonly PaletteAction[] {
  const navigate = useNavigate();
  const slots = usePluginSlots();
  const settingsSections = useSettingsNavSections(slots.fileOpeners);
  const serverChoices = useServerChoices();
  return useMemo(() => {
    const go = (path: string) => void navigate(path);
    return [
      ...buildSettingsPaletteActions({
        navigate: go,
        pluginEntries: buildPluginSettingsEntries({
          installedPlugins,
          settingsSections: slots.settingsSections,
        }),
        sections: settingsSections,
      }),
      ...buildPluginPagePaletteActions({
        navigate: go,
        panels: slots.navPanels,
      }),
      ...(serverChoices === null
        ? []
        : serverChoices.servers
            .filter((server) => !server.active)
            .map((server): PaletteAction => ({
              id: `server:${server.id}`,
              title: `Switch to ${server.name}`,
              bucket: "Actions",
              group: "Servers",
              shortcut: null,
              run: () => serverChoices.switchTo(server.id),
            }))),
    ];
  }, [
    installedPlugins,
    navigate,
    serverChoices,
    settingsSections,
    slots.navPanels,
    slots.settingsSections,
  ]);
}

export function usePluginAppCommands(): readonly ExperimentalAppCommand[] {
  const session = useContext(PaletteSessionContext);
  const live = useLiveCommandActions(session === null);
  const installed = useQuery(
    pluginListQueryOptions({ enabled: session === null }),
  ).data;
  const pages = usePageActions(session?.installedPlugins ?? installed ?? []);
  const commands = session?.actions ?? live;
  return [...commands, ...pages].map((action) => ({
    id: action.id,
    title: action.title,
    group: action.group,
    ...(action.shortcut === null ? {} : { shortcut: action.shortcut.label }),
    run: session === null ? action.run : () => session.choose(action),
  }));
}
