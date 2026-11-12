// The built-in kinds' state as the frontend sees it, read once per window
// load (slot registrations are static): kinds the user turned off in Setup →
// Kinds, and kinds whose New and composer entries go to another provider.
// Changing either applies here after a window reload; see src/kinds.ts.
import type { ComponentType } from "react";

export interface KindsSnapshot {
  off: ReadonlySet<string>;
  routedAway: ReadonlySet<string>;
}

const EVERYTHING_ON: KindsSnapshot = { off: new Set(), routedAway: new Set() };

/** Parse `kinds.state`'s RPC response; anything unexpected leaves every kind on. */
export function parseKindsSnapshot(body: unknown): KindsSnapshot {
  const result = (body as { ok?: boolean; result?: { frontend?: { off?: unknown; routedAway?: unknown } } } | null)?.result?.frontend;
  if (!result) return EVERYTHING_ON;
  const strings = (value: unknown) => new Set(Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : []);
  return { off: strings(result.off), routedAway: strings(result.routedAway) };
}

let applied: KindsSnapshot | null = null;

/** What this window registered with, or null before app setup read it. */
export function appliedKinds(): KindsSnapshot | null {
  return applied;
}

/** Whether a saved state differs from what this window registered with. */
export function needsWindowReload(saved: { off: readonly string[]; routedAway: readonly string[] }, current: KindsSnapshot | null = applied): boolean {
  if (!current) return false;
  const same = (a: ReadonlySet<string>, b: readonly string[]) => a.size === new Set(b).size && b.every((each) => a.has(each));
  return !same(current.off, saved.off) || !same(current.routedAway, saved.routedAway);
}

/** A synchronous read at frontend setup; if Studio's server doesn't answer, every kind stays on. */
export function readKindsSnapshot(): KindsSnapshot {
  applied = read();
  return applied;
}

function read(): KindsSnapshot {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/plugins/studio/rpc/kinds.state", false);
    xhr.setRequestHeader("content-type", "application/json");
    xhr.send("null");
    if (xhr.status !== 200) return EVERYTHING_ON;
    return parseKindsSnapshot(JSON.parse(xhr.responseText));
  } catch {
    return EVERYTHING_ON;
  }
}

/** A reply card that renders nothing while its kind is off, instead of the raw directive line. */
export function whenOn<P extends object>(snapshot: KindsSnapshot, kind: string, Component: ComponentType<P>): ComponentType<P> {
  if (!snapshot.off.has(kind)) return Component;
  const Hidden = () => null;
  Hidden.displayName = `Off(${kind})`;
  return Hidden;
}
