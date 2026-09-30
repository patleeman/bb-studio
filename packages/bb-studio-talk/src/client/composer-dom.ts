// DOM-level integration with BB's composer. The plugin SDK has no hook to
// replace the built-in microphone, and plugin composer actions are hidden in
// the compact (phone) layout, so Talk works on the rendered composer:
//
// - A capture-phase click listener on window claims presses on BB's own
//   "Start voice input" buttons before React sees them, and starts Talk.
// - Dictated text is typed into the composer's editor with the browser's
//   insertText command, which the TipTap editor handles like typing.
//
// These selectors track BB's PromptBox markup. If BB changes it, the mic
// falls back to built-in dictation and Talk stays reachable from its
// commands and the recordings page.

export const BUILT_IN_MIC_SELECTOR = '[data-promptbox] button[aria-label="Start voice input"]';
const EDITOR_SELECTOR = '[contenteditable="true"]';
const ACTIVE_ATTR = "data-talk-dictating";
const BUSY_ATTR = "data-talk-busy";
const CLAIMED_ATTR = "data-talk-mic";

/**
 * `active` is the composer Talk is dictating into; `busy` is every other
 * composer while Talk is capturing somewhere else.
 */
export interface MicState {
  mode: "idle" | "active" | "busy";
  title: string;
}

export interface MicInterceptOptions {
  enabled(): boolean;
  stateFor(promptbox: HTMLElement): MicState;
  onPress(promptbox: HTMLElement): void;
  /** Calls the listener whenever `enabled` or `stateFor` may have changed. */
  subscribe(listener: () => void): () => void;
}

export function interceptBuiltInMic(options: MicInterceptOptions, signal: AbortSignal): void {
  const onClick = (event: MouseEvent) => {
    if (!options.enabled()) return;
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>(BUILT_IN_MIC_SELECTOR);
    const promptbox = button?.closest<HTMLElement>("[data-promptbox]");
    if (!button || !promptbox || button.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    options.onPress(promptbox);
  };
  window.addEventListener("click", onClick, { capture: true, signal });

  // Mark the buttons Talk owns, and show the dictating state on them.
  const style = document.createElement("style");
  style.textContent = `
    button[${CLAIMED_ATTR}][${ACTIVE_ATTR}] { color: var(--destructive, #e5484d) !important; }
    button[${CLAIMED_ATTR}][${ACTIVE_ATTR}] svg { animation: bb-talk-pulse 1.4s ease-in-out infinite; }
    button[${CLAIMED_ATTR}][${BUSY_ATTR}] { opacity: .4; }
    @keyframes bb-talk-pulse { 50% { opacity: .45; } }
    @media (prefers-reduced-motion: reduce) { button[${CLAIMED_ATTR}] svg { animation: none !important; } }
  `;
  document.head.append(style);
  const sync = () => {
    const enabled = options.enabled();
    for (const button of document.querySelectorAll<HTMLButtonElement>(BUILT_IN_MIC_SELECTOR)) {
      const promptbox = button.closest<HTMLElement>("[data-promptbox]");
      const state = enabled && promptbox ? options.stateFor(promptbox) : null;
      button.toggleAttribute(CLAIMED_ATTR, state !== null);
      button.toggleAttribute(ACTIVE_ATTR, state?.mode === "active");
      button.toggleAttribute(BUSY_ATTR, state?.mode === "busy");
      if (state) button.title = state.title;
    }
  };
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = window.setInterval(sync, 1000);
  const unsubscribe = options.subscribe(sync);
  sync();
  signal.addEventListener(
    "abort",
    () => {
      observer.disconnect();
      clearInterval(timer);
      unsubscribe();
      style.remove();
      for (const button of document.querySelectorAll(`[${CLAIMED_ATTR}]`)) {
        button.removeAttribute(CLAIMED_ATTR);
        button.removeAttribute(ACTIVE_ATTR);
        button.removeAttribute(BUSY_ATTR);
        button.removeAttribute("title");
      }
    },
    { once: true },
  );
}

/**
 * Types `text` into a composer at its caret, or at the end when the caret
 * is elsewhere. Returns false when no editor accepted the text.
 */
export function insertIntoComposer(promptbox: HTMLElement | null, text: string): boolean {
  const editor = promptbox?.isConnected ? promptbox.querySelector<HTMLElement>(EDITOR_SELECTOR) : null;
  if (!editor || text.trim() === "") return false;
  editor.focus();
  const selection = window.getSelection();
  if (selection && (!selection.anchorNode || !editor.contains(selection.anchorNode))) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  const before = textBeforeCaret(editor);
  const spaced = before !== "" && !/\s$/.test(before) ? ` ${text}` : text;
  const beforeLength = editor.textContent?.length ?? 0;
  // Deprecated but still the one input path every engine routes through the
  // editor's own input handling, so undo and mentions keep working.
  const ok = document.execCommand("insertText", false, spaced);
  return ok && (editor.textContent?.length ?? 0) > beforeLength;
}

function textBeforeCaret(editor: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return editor.textContent ?? "";
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(editor);
  range.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
  return range.toString();
}

/** The last visible composer on screen. */
export function findComposer(): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>("[data-promptbox]")].filter(
    (element) => element.offsetParent !== null,
  );
  return all.at(-1) ?? null;
}
