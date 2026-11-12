// Which on-canvas text edit the user actually started. A screen's own script
// (agent-written, untrusted) can post any message, so a "text" edit counts only
// in Edit mode, from the frame where the user just clicked to start editing
// (the click gives the canvas a user activation), and for that same element.

export type EditGate = {
  /** A frame reports the user clicked an element to edit it. */
  start(key: string, before: string, state: { editing: boolean; activated: boolean }): void;
  /** Whether a finished edit is the one the user started; it can be taken once. */
  take(key: string, before: string, editing: boolean): boolean;
  /** Leaving Edit mode forgets an edit in progress. */
  reset(): void;
};

export function createEditGate(): EditGate {
  let open: { key: string; before: string } | null = null;
  return {
    start(key, before, { editing, activated }) {
      open = editing && activated ? { key, before } : null;
    },
    take(key, before, editing) {
      const ok = editing && open !== null && open.key === key && open.before === before;
      if (ok || open?.key === key) open = null;
      return ok;
    },
    reset() {
      open = null;
    },
  };
}
