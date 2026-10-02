import type { ComponentType, ReactNode } from "react";
import { openFloat } from "./float";
import type { FloatOpenOptions, FloatTarget } from "./float-registry";

export type CompanionPlacement = "floating" | "workbench" | "main";

export interface CompanionViewProps {
  id: string;
  title: string;
  icon?: string;
  placement: CompanionPlacement;
  activation: number;
  pinned?: boolean;
  onSelect(): void;
  onClose(): void;
  onPlacementChange(placement: CompanionPlacement): void;
  onPinnedChange?(pinned: boolean): void;
  onBack?: () => void;
  children: ReactNode;
}

/** Optional host capabilities: keep the suite's SDK pin compatible with stable BB. */
function runtime(): { View: ComponentType<CompanionViewProps>; Outlet: ComponentType<{ id: string }> } | null {
  const app = (globalThis as { __bbPluginRuntime?: { pluginSdkApp?: Record<string, unknown> } }).__bbPluginRuntime?.pluginSdkApp;
  const View = app?.experimental_CompanionView;
  const Outlet = app?.experimental_CompanionOutlet;
  if (typeof View !== "function" || typeof Outlet !== "function") return null;
  return { View: View as ComponentType<CompanionViewProps>, Outlet: Outlet as ComponentType<{ id: string }> };
}

export const companionWorkbenchAvailable = (): boolean => runtime() !== null;

/** One live portal on capable hosts; the same child tree remains usable on stable BB. */
export function CompanionView(props: CompanionViewProps) {
  const host = runtime();
  return host ? <host.View {...props} /> : <>{props.children}</>;
}

export function CompanionOutlet({ id }: { id: string }) {
  const host = runtime();
  return host ? <host.Outlet id={id} /> : null;
}

/** Chat and companion actions prefer the native workbench when the host supports it. */
export function openCompanion(target: FloatTarget, options: FloatOpenOptions = {}): boolean {
  return openFloat(target, { ...options, placement: options.placement ?? (companionWorkbenchAvailable() ? "workbench" : "floating") });
}
