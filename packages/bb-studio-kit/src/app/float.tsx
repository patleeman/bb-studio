// Floating windows (see float-registry.ts for how content reaches them).
//
// Anything that can open a window calls `openFloat`, and offers it only while
// `useFloatAvailable()` says the Float plugin is running. A plugin whose panel
// can show in a window renders <FloatPanels> from an `experimental_appOverlay`;
// its panel then renders in its own React tree, portalled into the window.
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  floatBodies,
  floatDock,
  floatHost,
  floatLeading,
  floatPanelFor,
  floatRevision,
  registerFloatPanel,
  subscribeFloat,
  type FloatOpenOptions,
  type FloatTarget,
} from "./float-registry";

function useFloatRevision(): number {
  return useSyncExternalStore(subscribeFloat, floatRevision, floatRevision);
}

/** Opens a window; false when the Float plugin isn't running. */
export function openFloat(target: FloatTarget, options?: FloatOpenOptions): boolean {
  const host = floatHost();
  if (!host) return false;
  host.open(target, options);
  return true;
}

/** Whether windows can open: the Float plugin is running. */
export function useFloatAvailable(): boolean {
  useFloatRevision();
  return floatHost() !== null;
}

/** Whether `target` can open in a window: threads always, paths when a panel shows them. */
export function useCanFloat(target: FloatTarget | null): boolean {
  useFloatRevision();
  if (!target || !floatHost()) return false;
  return target.kind === "thread" || floatPanelFor(target.path) !== null;
}

const InFloatContext = createContext(false);

/**
 * True inside a window. A view rendered there skips what only makes sense on
 * its own screen, such as handing its chat to a window or moving the dock.
 */
export const useInFloat = (): boolean => useContext(InFloatContext);

/**
 * Renders this plugin's panel at `path` in every window showing a path under
 * it, given the rest of the path as `subPath`, as BB passes a nav panel.
 */
export function FloatPanels({ path, render }: { path: string; render(subPath: string): ReactNode }) {
  const pluginId = experimental_usePluginId();
  useEffect(() => registerFloatPanel({ pluginId, path }), [pluginId, path]);
  useFloatRevision();
  return (
    <>
      {floatBodies().map(({ windowKey, target, element, placement }) => {
        if (target.kind !== "path") return null;
        const panel = floatPanelFor(target.path);
        if (!panel || panel.pluginId !== pluginId || panel.path !== path) return null;
        // Mark the content as this plugin's portal, as BB marks its own, so
        // the plugin's CSS and route links apply.
        return createPortal(
          <div data-bb-portaled-overlay="" data-bb-plugin-root="" data-bb-plugin={pluginId} className="flex h-full min-h-0 flex-col">
            <InFloatContext.Provider value={placement !== "main"}>{render(panel.subPath)}</InFloatContext.Provider>
          </div>,
          element,
          windowKey,
        );
      })}
    </>
  );
}

/** Renders `render(threadId)` above the messages of every thread window. */
export function FloatThreadLeading({ render }: { render(threadId: string): ReactNode }) {
  const pluginId = experimental_usePluginId();
  useFloatRevision();
  return (
    <>
      {floatLeading().map(({ windowKey, target, element }) =>
        target.kind === "thread"
          ? createPortal(
              <div data-bb-portaled-overlay="" data-bb-plugin-root="" data-bb-plugin={pluginId}>
                {render(target.threadId)}
              </div>,
              element,
              windowKey,
            )
          : null,
      )}
    </>
  );
}

/** Renders `children` in Float's bottom-right corner; null without Float. */
export function FloatDockPortal({ children }: { children: ReactNode }) {
  const pluginId = experimental_usePluginId();
  useFloatRevision();
  const dock = floatDock();
  if (!dock) return null;
  return createPortal(
    <div data-bb-portaled-overlay="" data-bb-plugin-root="" data-bb-plugin={pluginId} className="pointer-events-auto">
      {children}
    </div>,
    dock,
    "dock",
  );
}
