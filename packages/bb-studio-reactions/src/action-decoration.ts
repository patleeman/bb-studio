import { parseEmojiItems } from "./emoji-items";
import type { MenuSettings } from "./settings";

const ICON = 'span[data-plugin-icon-asset*="plugins/emoji-react/assets/icon"]';

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
    }
    return null;
  };

  const sweep = () => {
    if (disposed) return;
    for (const icon of document.querySelectorAll(ICON)) {
      const button = icon.closest("button");
      if (!button || edited.has(button)) continue;
      const title = button.getAttribute("aria-label")?.trim() || button.textContent?.trim() || "";
      if (!titles.has(title)) continue;
      const selection = Boolean(button.textContent?.trim());
      const role = selection ? null : roleOf(button);
      const hidden = selection ? !settings.showInSelectionMenu
        : role === "assistant" ? !settings.showInAssistantBar
        : role === "user" ? !settings.showInUserBar
        : !settings.showInAssistantBar && !settings.showInUserBar;
      const original = { icon, next: icon.nextSibling, glyph: null as Element | null, display: button.style.display, hidden: button.hidden, hid: hidden };
      edited.set(button, original);
      if (hidden) { button.style.display = "none"; button.hidden = true; continue; }
      if (selection) icon.remove();
      else {
        const glyph = document.createElement("span");
        glyph.setAttribute("aria-hidden", "true");
        glyph.setAttribute("data-emoji-react-glyph", "");
        glyph.textContent = title;
        original.glyph = glyph;
        icon.replaceWith(glyph);
      }
    }
  };
  const schedule = () => {
    if (disposed || frame !== undefined) return;
    frame = requestAnimationFrame(() => { frame = undefined; sweep(); });
  };
  const observer = new MutationObserver(schedule);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
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
  sweep();
  return dispose;
}
