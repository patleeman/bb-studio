// Renders a composer action in the row under the composer, beside its
// project, machine and branch. BB has no slot in that row: the action portals
// into it, and stays in the action row if the row isn't found. Studio's
// spaces chip does the same (bb-studio/src/ui/ComposerSpaces.tsx).
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PLUGIN_ID } from "./studio-provider";

/** The project, machine and branch group in the row under `anchor`'s composer. */
function footerGroup(anchor: HTMLElement): HTMLElement | null {
  const footer = anchor.closest("[data-promptbox]")?.nextElementSibling;
  return footer?.firstElementChild instanceof HTMLElement ? footer.firstElementChild : null;
}

export function ComposerFooter({ children }: { children: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const shell = anchor?.closest("[data-promptbox]")?.parentElement;
    if (!anchor || !shell) return;
    const host = document.createElement("span");
    host.style.display = "contents";
    host.setAttribute("data-bb-plugin", PLUGIN_ID);
    host.setAttribute("data-bb-plugin-root", "");
    // The footer can re-render or remount; keep the node in it.
    const place = () => {
      const group = footerGroup(anchor);
      if (group && host.parentElement !== group) group.appendChild(host);
      setSlot(group ? host : null);
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(shell, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      host.remove();
    };
  }, [anchor]);
  return (
    <>
      <span ref={setAnchor} hidden />
      {slot ? createPortal(<span data-composer-footer="" style={{ display: "contents" }}>{children}</span>, slot) : children}
    </>
  );
}
