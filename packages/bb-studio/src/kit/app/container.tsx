// Which container a Studio surface is in: a thread (its workbench tabs and its
// transcript) or the Studio app. Links open in the container they're clicked
// in (src/ui/studio-open.tsx has the rule). Kept in the kit, free of Studio's
// kinds, so kit pieces such as the item header can follow it too.
import { createContext, useContext, type ReactNode } from "react";
import { threadLinkId } from "./studio-item";

export type StudioContainer =
  | { kind: "thread"; threadId: string | null }
  | { kind: "studio" };

const ContainerContext = createContext<StudioContainer | null>(null);

/** The DOM mark for a container, so app overlays (ItemGestures) can tell where a click was. */
export const CONTAINER_ATTR = "data-studio-container";
const CONTAINER_THREAD_ATTR = "data-studio-container-thread";

/** Wraps a surface that is a container: a thread's Studio tab, the Studio app. */
export function StudioContainerProvider({ value, children }: { value: StudioContainer; children: ReactNode }) {
  const marks = { [CONTAINER_ATTR]: value.kind, ...(value.kind === "thread" && value.threadId ? { [CONTAINER_THREAD_ATTR]: value.threadId } : {}) };
  return (
    <ContainerContext.Provider value={value}>
      <div className="contents" {...marks}>{children}</div>
    </ContainerContext.Provider>
  );
}

/** The container a component renders in; null outside both. */
export function useStudioContainer(): StudioContainer | null {
  return useContext(ContainerContext);
}

/** The container marked around `element`, for code outside React's tree. */
export function containerAt(element: Element | null): StudioContainer | null {
  const marked = element?.closest(`[${CONTAINER_ATTR}]`);
  if (!marked) return null;
  if (marked.getAttribute(CONTAINER_ATTR) === "studio") return { kind: "studio" };
  return { kind: "thread", threadId: marked.getAttribute(CONTAINER_THREAD_ATTR) };
}

/**
 * The container BB's main view shows, for global surfaces (search, the Talk
 * pill, content scripts): a thread's address is that thread, Studio's panel is
 * Studio. Null elsewhere (Settings, a project, another plugin).
 */
export function routeContainer(pathname: string = typeof window === "undefined" ? "" : window.location.pathname): StudioContainer | null {
  const threadId = threadLinkId(pathname);
  if (threadId) return { kind: "thread", threadId };
  return /^\/plugins\/studio\/studio(?:\/|$)/.test(pathname) ? { kind: "studio" } : null;
}

/** Whether a click asks for the other place: ⌘ on a Mac, Ctrl elsewhere. */
export const wantsAlternate = (event?: { metaKey?: boolean; ctrlKey?: boolean } | null): boolean => Boolean(event?.metaKey || event?.ctrlKey);
