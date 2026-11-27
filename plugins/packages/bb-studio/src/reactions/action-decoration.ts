import { parseEmojiItems } from "./emoji-items";
import type { MenuSettings } from "./settings";

// Studio's plugin icon. BB serves it at /api/v1/plugins/studio/assets/icon
// (the manifest icon) or, in some surfaces, at .../assets/icons/studio.svg.
const ICON = 'span[data-plugin-icon-asset*="/plugins/studio/assets/icon"]';

/** Stable hosts expose action registration but no per-surface emoji renderer.
 * Keep the DOM dependency here, touch only positively identified plugin icons,
 * and restore every owned mutation when the frontend generation ends. */
export function mountActionDecoration(settings: MenuSettings, signal: AbortSignal): () => void {
  const titles = new Set(parseEmojiItems(settings.emojiItems).map((item) => item.emoji || item.label || item.text));
  const edited = new Map<HTMLButtonElement, { icon: Element; next: ChildNode | null; glyph: Element | null; display: string; hidden: boolean; hid: boolean }>();
  let frame: number | undefined;
  let disposed = false;

  const roleOf = (button: Element): "assistant" | "user" | null => {
    for (let node: Element | null = button.parentElement, depth = 0; node && depth < 10; node = node.parentElement, depth++) {
      for (const attribute of ["data-role", "data-message-role", "data-conversation-role", "data-testid"]) {
        const role = node.getAttribute(attribute)?.toLowerCase();
        if (role === "assistant" || role === "assistant-message" || role === "message-assistant") return "assistant";
        if (role === "user" || role === "user-message" || role === "message-user") return "user";
      }
      // Stable BB 0.45 uses this exact message wrapper without role attributes.
      if (node.classList.contains("group/message")) {
        if (node.classList.contains("ml-auto")) return "user";
        if (node.classList.contains("w-full")) return "assistant";
      }
    }
    return null;
  };

  const decorateIcon = (icon: Element) => {
    const button = icon.closest("button");
    if (!button || edited.has(button)) return;
    const title = button.getAttribute("aria-label")?.trim() || button.textContent?.trim() || "";
    if (!titles.has(title)) return;
    const selection = Boolean(button.textContent?.trim());
    const role = selection ? null : roleOf(button);
    const hidden = selection ? !settings.showInSelectionMenu
      : role === "assistant" ? !settings.showInAssistantBar
      : role === "user" ? !settings.showInUserBar
      : !settings.showInAssistantBar && !settings.showInUserBar;
    const original = { icon, next: icon.nextSibling, glyph: null as Element | null, display: button.style.display, hidden: button.hidden, hid: hidden };
    edited.set(button, original);
    if (hidden) { button.style.display = "none"; button.hidden = true; return; }
    if (selection) icon.remove();
    else {
      const glyph = document.createElement("span");
      glyph.setAttribute("aria-hidden", "true");
      glyph.setAttribute("data-emoji-react-glyph", "");
      glyph.textContent = title;
      original.glyph = glyph;
      icon.replaceWith(glyph);
    }
  };

  const pendingRoots = new Set<Element>();
  let needsPrune = false;

  const sweepRoot = (root: Document | Element) => {
    if (root instanceof Element && root.matches(ICON)) decorateIcon(root);
    for (const icon of root.querySelectorAll(ICON)) decorateIcon(icon);
  };

  const sweep = (full = false) => {
    if (disposed) return;
    if (full || needsPrune) {
      needsPrune = false;
      // Buttons the host unmounted have nothing left to restore.
      for (const button of edited.keys()) if (!button.isConnected) edited.delete(button);
    }
    if (full) {
      pendingRoots.clear();
      sweepRoot(document);
      return;
    }
    if (!pendingRoots.size) return;
    const roots = [...pendingRoots];
    pendingRoots.clear();
    for (const root of roots) {
      if (root.isConnected) sweepRoot(root);
    }
  };
  const schedule = () => {
    if (disposed || frame !== undefined) return;
    frame = requestAnimationFrame(() => { frame = undefined; sweep(false); });
  };
  const observer = new MutationObserver((records) => {
    let addedAny = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element && !node.hasAttribute("data-emoji-react-glyph")) {
          pendingRoots.add(node);
          addedAny = true;
        }
      }
      if (!needsPrune && record.removedNodes.length > 0) {
        for (const node of record.removedNodes) {
          if (node instanceof Element) { needsPrune = true; break; }
        }
      }
    }
    if (addedAny || needsPrune) schedule();
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    pendingRoots.clear();
    signal.removeEventListener("abort", dispose);
    if (frame !== undefined) cancelAnimationFrame(frame);
    for (const [button, original] of edited) {
      if (original.hid) {
        if (button.style.display === "none") button.style.display = original.display;
        if (button.hidden) button.hidden = original.hidden;
      }
      if (original.glyph?.parentNode) original.glyph.replaceWith(original.icon);
      else if (!original.icon.parentNode) button.insertBefore(original.icon, original.next?.parentNode === button ? original.next : button.firstChild);
    }
    edited.clear();
  };
  if (signal.aborted) { dispose(); return dispose; }
  observer.observe(document.body, { childList: true, subtree: true });
  signal.addEventListener("abort", dispose, { once: true });
  sweep(true);
  return dispose;
}
