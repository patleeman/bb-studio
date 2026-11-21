// The strand selected in a conversation (a chip, a tag or a tab row clicked),
// shared by the strip above the composer, the message tags and the
// workbench tab, which render in separate slots of one app.
import { useSyncExternalStore } from "react";

export interface Selection { strandId: string; seq: number | null }

const selected = new Map<string, Selection>();
const listeners = new Set<() => void>();
const DIM_STYLE_ID = "studio-strand-dim-style";

export function select(threadId: string, value: Selection | null): void {
  if (value) selected.set(threadId, value); else selected.delete(threadId);
  for (const listener of listeners) listener();
}

export function selectionOf(threadId: string): Selection | null { return selected.get(threadId) ?? null; }

const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };

export function useSelection(threadId: string): Selection | null {
  return useSyncExternalStore(subscribe, () => selected.get(threadId) ?? null, () => null);
}

/** The rule that dims the other strands' messages while one is selected (once per document). */
export function ensureDimStyle(doc: Document = document): void {
  if (doc.getElementById(DIM_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = DIM_STYLE_ID;
  style.textContent = "[data-studio-strand-dim]{opacity:.3;transition:opacity .2s}@media (prefers-reduced-motion:reduce){[data-studio-strand-dim]{transition:none}}";
  doc.head.appendChild(style);
}
