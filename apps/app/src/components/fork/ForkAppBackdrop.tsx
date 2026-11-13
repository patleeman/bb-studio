import { memo, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type {
  ExperimentalAppAppearance,
  ExperimentalAppSurface,
} from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { isBareWindow } from "@/lib/fork-bare-window";
import type { PluginAppBackdropSlot } from "@/lib/fork-slots";
import {
  setForkThemeModeOverride,
  type ForkThemeMode,
} from "@/lib/fork-theme-mode";
import { usePluginSlots } from "@/lib/plugin-slots";
import { FORK_TITLE_ROWS_ATTRIBUTE } from "./ForkTitleHost";

export const FORK_BACKDROP_ATTRIBUTE = "data-fork-backdrop";
export const FORK_SURFACE_EDGE_ATTRIBUTE = "data-fork-surface-edge";
export const FORK_CARDS_ATTRIBUTE = "data-fork-cards";
export const FORK_CARDS_GAP_PROPERTY = "--fork-cards-gap";
export const FORK_CARDS_RADIUS_PROPERTY = "--fork-cards-radius";

const SURFACE_NAMES = {
  sidebar: "sidebar",
  main: "main",
  composer: "composer",
  secondaryPanel: "secondary-panel",
  header: "header",
  panel: "panel",
  code: "code",
  popover: "popover",
} as const satisfies Record<ExperimentalAppSurface, string>;

const SURFACE_FIELDS = [
  ["background", "background", "background"],
  ["backdropFilter", "backdrop-filter", "backdrop-filter"],
  ["edge", "edge", "color"],
] as const;

const NO_BACKDROPS: readonly PluginAppBackdropSlot[] = [];
const TOKEN_NAME = /^--[A-Za-z0-9_-]+$/u;
const MAX_TOKENS = 500;
const MAX_CARDS_GAP = 24;
const MAX_CARDS_RADIUS = 28;

export interface ForkCardsLayout {
  gap: number;
  radius: number;
  titleRow: boolean;
}

export interface ForkAppearance {
  mode: ForkThemeMode | null;
  properties: ReadonlyMap<string, string>;
  edges: readonly string[];
  cards: ForkCardsLayout | null;
}

const NO_APPEARANCE: ForkAppearance = {
  mode: null,
  properties: new Map(),
  edges: [],
  cards: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampPixels(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(0, value));
}

function cleanCards(layout: unknown): ForkCardsLayout | null {
  if (!isRecord(layout) || !isRecord(layout.cards)) return null;
  const gap = clampPixels(layout.cards.gap, MAX_CARDS_GAP);
  const radius = clampPixels(layout.cards.radius, MAX_CARDS_RADIUS);
  if (gap === null || radius === null) return null;
  return { gap, radius, titleRow: layout.cards.titleRow === true };
}

const MAX_CSS_VALUE_LENGTH = 2000;

function cleanCssValue(property: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_CSS_VALUE_LENGTH) return null;
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    return CSS.supports(property, trimmed) ? trimmed : null;
  }
  return trimmed;
}

export function cleanAppearance(value: unknown): ForkAppearance {
  if (!isRecord(value)) return NO_APPEARANCE;
  const mode =
    value.mode === "light" || value.mode === "dark" ? value.mode : null;
  const properties = new Map<string, string>();
  if (isRecord(value.tokens)) {
    for (const [name, raw] of Object.entries(value.tokens).slice(
      0,
      MAX_TOKENS,
    )) {
      if (!TOKEN_NAME.test(name)) continue;
      const clean = cleanCssValue(name, raw);
      if (clean !== null) properties.set(name, clean);
    }
  }
  const edges: string[] = [];
  const surfaces = isRecord(value.surfaces) ? value.surfaces : {};
  for (const [surface, name] of Object.entries(SURFACE_NAMES)) {
    const style = surfaces[surface];
    if (!isRecord(style)) continue;
    for (const [field, suffix, property] of SURFACE_FIELDS) {
      const clean = cleanCssValue(property, style[field]);
      if (clean === null) continue;
      properties.set(`--fork-surface-${name}-${suffix}`, clean);
      if (field === "edge") edges.push(name);
    }
  }
  return { mode, properties, edges, cards: cleanCards(value.layout) };
}

function appearanceKey(appearance: ForkAppearance): string {
  return JSON.stringify([
    appearance.mode,
    [...appearance.properties],
    appearance.edges,
    appearance.cards,
  ]);
}

export function applyAppearance(
  root: HTMLElement,
  appearance: ForkAppearance,
): () => void {
  const previous = new Map<string, [string, string]>();
  const properties = new Map(appearance.properties);
  if (appearance.cards !== null) {
    properties.set(FORK_CARDS_GAP_PROPERTY, `${appearance.cards.gap}px`);
    properties.set(FORK_CARDS_RADIUS_PROPERTY, `${appearance.cards.radius}px`);
    root.setAttribute(FORK_CARDS_ATTRIBUTE, "");
    if (appearance.cards.titleRow) {
      root.setAttribute(FORK_TITLE_ROWS_ATTRIBUTE, "");
    }
  }
  for (const [name, value] of properties) {
    previous.set(name, [
      root.style.getPropertyValue(name),
      root.style.getPropertyPriority(name),
    ]);
    root.style.setProperty(name, value);
  }
  if (appearance.edges.length > 0) {
    root.setAttribute(FORK_SURFACE_EDGE_ATTRIBUTE, appearance.edges.join(" "));
  }
  setForkThemeModeOverride(appearance.mode);
  return () => {
    setForkThemeModeOverride(null);
    root.removeAttribute(FORK_SURFACE_EDGE_ATTRIBUTE);
    root.removeAttribute(FORK_CARDS_ATTRIBUTE);
    root.removeAttribute(FORK_TITLE_ROWS_ATTRIBUTE);
    for (const [name, [value, priority]] of previous) {
      if (value === "") root.style.removeProperty(name);
      else root.style.setProperty(name, value, priority);
    }
  };
}

function useBackdropAttribute(slot: PluginAppBackdropSlot, active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.setAttribute(FORK_BACKDROP_ATTRIBUTE, `${slot.pluginId}/${slot.id}`);
    return () => root.removeAttribute(FORK_BACKDROP_ATTRIBUTE);
  }, [slot.pluginId, slot.id, active]);
}

const AppearanceProbe = memo(function AppearanceProbe({
  slot,
  useAppearance,
}: {
  slot: PluginAppBackdropSlot;
  useAppearance: () => ExperimentalAppAppearance | null;
}) {
  const raw = useAppearance();
  const active = raw !== null && raw !== undefined;
  const key = appearanceKey(cleanAppearance(raw));
  useBackdropAttribute(slot, active);
  useLayoutEffect(
    () => applyAppearance(document.documentElement, readAppearanceKey(key)),
    [key],
  );
  return null;
});

function AlwaysActive({ slot }: { slot: PluginAppBackdropSlot }) {
  useBackdropAttribute(slot, true);
  return null;
}

function readAppearanceKey(key: string): ForkAppearance {
  const [mode, properties, edges, cards] = JSON.parse(key) as [
    ForkThemeMode | null,
    [string, string][],
    string[],
    ForkCardsLayout | null,
  ];
  return { mode, properties: new Map(properties), edges, cards };
}

const BackdropLayer = memo(function BackdropLayer({
  slot,
}: {
  slot: PluginAppBackdropSlot;
}) {
  const Component = slot.component;
  return createPortal(
    <div
      aria-hidden
      data-fork-app-backdrop={`${slot.pluginId}/${slot.id}`}
      data-bb-plugin-root=""
      data-bb-plugin={slot.pluginId}
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <Component />
    </div>,
    document.body,
  );
});

function firstBackdrop(
  slots: readonly PluginAppBackdropSlot[],
): PluginAppBackdropSlot | null {
  return (
    [...slots].sort(
      (a, b) =>
        a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
    )[0] ?? null
  );
}

export function ForkAppBackdropHost() {
  const backdrops = usePluginSlots().appBackdrops ?? NO_BACKDROPS;
  const slot = useMemo(() => firstBackdrop(backdrops), [backdrops]);
  if (slot === null || isBareWindow()) return null;
  return (
    <PluginSlotMount
      key={`${slot.pluginId}/${slot.id}/${String(slot.generation)}`}
      pluginId={slot.pluginId}
      slotKind="appBackdrop"
      slotId={slot.id}
      crashFallback={null}
      wrapRoot={false}
    >
      <BackdropLayer slot={slot} />
      {slot.useAppearance === undefined ? (
        <AlwaysActive slot={slot} />
      ) : (
        <AppearanceProbe slot={slot} useAppearance={slot.useAppearance} />
      )}
    </PluginSlotMount>
  );
}
