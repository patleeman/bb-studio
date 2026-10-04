// BB puts plugin composer actions at the right of the composer's action row.
// The bot a thread works as belongs with its model, so this moves a control to
// just after the model picker on the left. BB has no slot there, so it goes by
// the markup; the control stays where BB put it if the picker isn't found.
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const MODEL_PICKER = '[aria-label^="Provider, model and reasoning"]';
const PLUS = '[aria-label="Prompt actions"]';

/** The model picker's node in the left group of `box`'s action row. */
function modelSlot(box: Element): Element | null {
  let node = box.querySelector(MODEL_PICKER);
  while (node?.parentElement && node.parentElement !== box && !node.parentElement.querySelector(PLUS)) node = node.parentElement;
  return node?.parentElement && node.parentElement !== box ? node : null;
}

/** Renders `children` right after the model picker of this action's composer. */
export function ComposerLeading({ pluginId, children }: { pluginId: string; children: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const box = anchor?.closest("[data-promptbox]");
    if (!anchor || !box) return;
    const host = document.createElement("span");
    host.style.display = "contents";
    host.setAttribute("data-bb-plugin", pluginId);
    host.setAttribute("data-bb-plugin-root", "");
    // The row can re-render or remount; keep the node after the picker.
    const place = () => {
      const model = modelSlot(box);
      if (model && model.nextSibling !== host) model.after(host);
      else if (!model) host.remove();
      setSlot(model ? host : null);
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(box, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      host.remove();
    };
  }, [anchor, pluginId]);
  return (
    <>
      <span ref={setAnchor} hidden />
      {slot ? createPortal(children, slot) : children}
    </>
  );
}
