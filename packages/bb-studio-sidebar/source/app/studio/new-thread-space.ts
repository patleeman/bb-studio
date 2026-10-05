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
