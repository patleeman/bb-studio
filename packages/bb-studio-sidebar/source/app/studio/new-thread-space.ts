// Tells Studio's composer Space picker (bb-studio's ComposerSpaces) which
// Space a new thread opened from a Space starts in. The picker takes it once:
// from session storage when the composer mounts, or from the event when it's
// already open. A null project matches whichever project the composer shows.
const HANDOFF_KEY = "studio:new-thread-space";

export function handOffNewThreadSpace(spaceId: string, projectId: string | null): void {
  const detail = { spaceId, projectId, at: Date.now() };
  try { sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(detail)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(HANDOFF_KEY, { detail }));
}

// The Space By space shows, when one Space is shown and it has a default
// project, so Studio Navigation's New thread starts there too. Session
// storage keeps it per window: each BB window shows its own Space, and one
// window's sidebar unmounting must not clear another's.
const TARGET_KEY = "bb-studio:space-new-thread";

export interface SpaceNewThreadTarget {
  spaceId: string;
  projectId: string;
}

export function setSpaceNewThreadTarget(target: SpaceNewThreadTarget | null): void {
  try {
    if (target) sessionStorage.setItem(TARGET_KEY, JSON.stringify(target));
    else sessionStorage.removeItem(TARGET_KEY);
  } catch { /* storage unavailable */ }
}

export function spaceNewThreadTarget(): SpaceNewThreadTarget | null {
  try {
    const raw = sessionStorage.getItem(TARGET_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SpaceNewThreadTarget> | null;
    return typeof value?.spaceId === "string" && typeof value.projectId === "string"
      ? { spaceId: value.spaceId, projectId: value.projectId }
      : null;
  } catch {
    return null;
  }
}
