import type {
  ExperimentalComposerReplace,
  ForkComposerCustomization,
} from "@get-bb/plugin-sdk";
import {
  requireComponent,
  requireSlotId,
  requireUniqueId,
} from "./composer-customization-validation.js";

export function parseComposerReplace(
  kind: string,
  value: unknown,
  onRejected: (reason: string) => void,
): ExperimentalComposerReplace | undefined {
  if (value === undefined) return undefined;
  const entry =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  if (entry === null) {
    onRejected(`${kind}: must be an object when set`);
    return undefined;
  }
  if (typeof entry.useActive !== "function") {
    onRejected(`${kind}: "useActive" must be a function`);
    return undefined;
  }
  if (typeof entry.component !== "function") {
    onRejected(`${kind}: "component" must be a React component function`);
    return undefined;
  }
  return {
    useActive: entry.useActive as ExperimentalComposerReplace["useActive"],
    component: entry.component as ExperimentalComposerReplace["component"],
  };
}

type ForkComposerFooterItem = NonNullable<
  ForkComposerCustomization["experimental_footer"]
>[number];

function parseComposerFooter(
  kind: string,
  value: unknown,
  onRejected: (reason: string) => void,
): readonly ForkComposerFooterItem[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    onRejected(`${kind}: must be an array when set`);
    return undefined;
  }
  const parsed: ForkComposerFooterItem[] = [];
  const seenIds = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const entryKind = `${kind}[${index}]`;
    try {
      const entry = raw as Record<string, unknown> | null;
      if (entry?.placement !== undefined && entry.placement !== "context") {
        throw new Error(`${entryKind}: "placement" must be "context" when set`);
      }
      const item: ForkComposerFooterItem = {
        id: requireSlotId(entryKind, entry?.id),
        component: requireComponent(entryKind, entry?.component),
        ...(entry?.placement === "context"
          ? { placement: "context" as const }
          : {}),
      };
      requireUniqueId(entryKind, seenIds, item.id);
      parsed.push(item);
    } catch (error) {
      onRejected(error instanceof Error ? error.message : String(error));
    }
  }
  return parsed;
}

export function parseForkComposerRegions(
  kind: string,
  registration: Record<string, unknown>,
  onRejected: (reason: string) => void,
): ForkComposerCustomization {
  const footer = parseComposerFooter(
    `${kind}.experimental_footer`,
    registration.experimental_footer,
    onRejected,
  );
  const replace = parseComposerReplace(
    `${kind}.experimental_replace`,
    registration.experimental_replace,
    onRejected,
  );
  return {
    ...(footer !== undefined ? { experimental_footer: footer } : {}),
    ...(replace !== undefined ? { experimental_replace: replace } : {}),
  };
}
