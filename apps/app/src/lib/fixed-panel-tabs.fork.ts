import type { Atom, WritableAtom } from "jotai";
import type { FixedPanelTabsState } from "./fixed-panel-tabs-state";
import { withGlobalPanelTabs } from "./fork-global-panel-tabs";
import { hasThreadId } from "./thread-id";

type OwnedAtom = WritableAtom<FixedPanelTabsState, [FixedPanelTabsState], void>;

interface OwnedFamily<A extends OwnedAtom> {
  (threadId: string): A;
  getParams(): Iterable<string>;
}

interface AtomReader {
  get<Value>(atom: Atom<Value>): Value;
}

export function forkFixedPanelTabsAtoms<A extends OwnedAtom, D>(
  family: OwnedFamily<A>,
  disabled: D,
) {
  const merged = withGlobalPanelTabs(family);
  const owned = (threadId: string | null | undefined): A | D =>
    hasThreadId(threadId) ? family(threadId) : disabled;
  return {
    ids: (): string[] => [...family.getParams()],
    owned,
    merged,
    ownedTabs(
      store: AtomReader,
      panelStateId: string | null | undefined,
      write: () => void,
    ) {
      if (!hasThreadId(panelStateId)) {
        write();
        return { before: [], after: [] };
      }
      const atom = family(panelStateId);
      const before = store.get(atom).secondary.tabs;
      write();
      return { before, after: store.get(atom).secondary.tabs };
    },
  };
}
