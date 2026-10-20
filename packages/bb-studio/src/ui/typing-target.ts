// Global key shortcuts (Space to pan, arrows and Space to step a deck) must
// never take keys from a text field: the composer, a comment box or any
// other input elsewhere in BB. Every window or document keydown handler with
// single-key shortcuts checks `isTypingTarget` first.

const TEXT_FIELD = "input, textarea, select, [role='textbox'], [role='combobox'], [role='searchbox'], [contenteditable]:not([contenteditable='false'])";

type KeyLike = Pick<KeyboardEvent, "target"> & Partial<Pick<KeyboardEvent, "isComposing" | "keyCode" | "composedPath">>;

/** Whether `node` is, or sits inside, something that takes typed text. */
export function isTextField(node: EventTarget | null | undefined): boolean {
  if (!node || typeof Element === "undefined") return false;
  const element = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
  if (!element) return false;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  return Boolean(element.closest(TEXT_FIELD));
}

/** The element focus is really in, following open shadow roots. */
function deepActiveElement(doc: Document): Element | null {
  let active = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/**
 * True while a key goes to text the user is typing: the event's target, or
 * the focused element, is a text input, textarea, select, contenteditable,
 * or a textbox or combobox; or an IME is composing.
 */
export function isTypingTarget(event: KeyLike): boolean {
  if (event.isComposing || event.keyCode === 229) return true;
  // Shadow DOM retargets `target` to the host; the path's first node is the real one.
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  if (isTextField(path[0] ?? event.target)) return true;
  if (isTextField(event.target)) return true;
  return typeof document !== "undefined" && isTextField(deepActiveElement(document));
}

/** Whether a key with focus on `target` belongs to `scope`: focus is inside it, or on nothing in particular. */
export function keyInScope(target: EventTarget | null, scope: Element | null): boolean {
  if (!target || (typeof document !== "undefined" && (target === document || target === document.body || target === document.documentElement || target === window))) return true;
  return Boolean(scope && target instanceof Node && scope.contains(target));
}
