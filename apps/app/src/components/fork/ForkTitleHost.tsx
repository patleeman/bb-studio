import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export const FORK_TITLE_ROWS_ATTRIBUTE = "data-fork-title-rows";
export const FORK_TITLE_HOST_ATTRIBUTE = "data-fork-title-host";
export const FORK_TITLE_BOX_ATTRIBUTE = "data-fork-title-box";

const HOST_SELECTOR = `[${FORK_TITLE_HOST_ATTRIBUTE}]`;
const HOST_CLASS = {
  page: undefined,
  tools: "mx-auto box-border w-full max-w-5xl px-4 md:px-5",
} as const;

function subscribeTitleRows(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [FORK_TITLE_ROWS_ATTRIBUTE],
  });
  return () => observer.disconnect();
}

function readTitleRows(): boolean {
  return document.documentElement.hasAttribute(FORK_TITLE_ROWS_ATTRIBUTE);
}

export function useForkTitleRows(): boolean {
  return useSyncExternalStore(subscribeTitleRows, readTitleRows, () => false);
}

export function forkTitleScope(home: Element): Element | null {
  return home.closest("header")?.parentElement ?? null;
}

function createTitleBox(): HTMLDivElement {
  const box = document.createElement("div");
  box.setAttribute(FORK_TITLE_BOX_ATTRIBUTE, "");
  box.style.display = "contents";
  return box;
}

export function ForkHeaderTitle({ children }: { children: ReactNode }) {
  const home = useRef<HTMLSpanElement>(null);
  const [box] = useState(createTitleBox);
  const titleRows = useForkTitleRows();
  useLayoutEffect(() => {
    const anchor = home.current;
    if (anchor === null) return;
    const scope = titleRows ? forkTitleScope(anchor) : null;
    const place = () => {
      const target = scope?.querySelector(HOST_SELECTOR) ?? anchor;
      if (box.parentElement !== target) target.appendChild(box);
    };
    place();
    if (scope === null) return () => box.remove();
    const observer = new MutationObserver(place);
    observer.observe(scope, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      box.remove();
    };
  }, [box, titleRows]);
  return (
    <>
      <span ref={home} data-fork-title-home="" className="contents" />
      {createPortal(children, box)}
    </>
  );
}

export function ForkTitleHost({ kind }: { kind: keyof typeof HOST_CLASS }) {
  return (
    <div
      {...{ [FORK_TITLE_HOST_ATTRIBUTE]: kind }}
      className={HOST_CLASS[kind]}
    />
  );
}
