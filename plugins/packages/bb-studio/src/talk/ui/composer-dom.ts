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
import { recordingLink, type RecordingReference } from "./recording-reference";
import { visibleComposers } from "./composer-source";

export const COMPOSER_REFERENCE_EVENT = "bb-talk:composer-reference";

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
    /* An invisible SDK bridge must not leave an empty banner row. */
    [data-promptbox-shell] > div:has(> [data-bb-plugin="studio"] > [data-talk-composer-bridge]):not(:has(> :not([data-bb-plugin="studio"]))):not(:has(> [data-bb-plugin="studio"] > :not([data-talk-composer-bridge]))) { display: none; }
    button[${CLAIMED_ATTR}][${ACTIVE_ATTR}] { color: var(--destructive, #e5484d) !important; }
    button[${CLAIMED_ATTR}][${ACTIVE_ATTR}] svg { animation: bb-talk-pulse 1.4s ease-in-out infinite; }
    button[${CLAIMED_ATTR}][${BUSY_ATTR}] { opacity: .4; }
    @keyframes bb-talk-pulse { 50% { opacity: .45; } }
    @media (prefers-reduced-motion: reduce) { button[${CLAIMED_ATTR}] svg { animation: none !important; } }
  `;
  document.head.append(style);
  const claimed = new Set<HTMLButtonElement>();
  const setAttr = (el: Element, name: string, on: boolean) => {
    if (el.hasAttribute(name) !== on) el.toggleAttribute(name, on);
  };
  const syncButton = (button: HTMLButtonElement, enabled: boolean) => {
    const promptbox = button.closest<HTMLElement>("[data-promptbox]");
    const state = enabled && promptbox ? options.stateFor(promptbox) : null;
    setAttr(button, CLAIMED_ATTR, state !== null);
    setAttr(button, ACTIVE_ATTR, state?.mode === "active");
    setAttr(button, BUSY_ATTR, state?.mode === "busy");
    if (state && button.title !== state.title) button.title = state.title;
    if (state !== null) claimed.add(button);
    else claimed.delete(button);
  };
  const syncAll = () => {
    for (const button of claimed) if (!button.isConnected) claimed.delete(button);
    const enabled = options.enabled();
    for (const button of document.querySelectorAll<HTMLButtonElement>(BUILT_IN_MIC_SELECTOR)) {
      syncButton(button, enabled);
    }
  };
  const syncKnown = () => {
    let missing = claimed.size === 0;
    for (const button of claimed) {
      if (!button.isConnected) {
        claimed.delete(button);
        missing = true;
      }
    }
    if (missing) {
      syncAll();
      return;
    }
    const enabled = options.enabled();
    for (const button of claimed) syncButton(button, enabled);
  };
  const relevantMutation = (records: readonly MutationRecord[]): boolean => {
    for (const button of claimed) if (!button.isConnected) return true;
    for (const record of records) {
      if (record.addedNodes.length === 0) continue;
      const target = record.target instanceof Element ? record.target : null;
      if (target?.closest("[data-promptbox]")) return true;
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.hasAttribute("data-promptbox")) return true;
        if (node.firstElementChild !== null && node.querySelector("[data-promptbox]") !== null) return true;
      }
    }
    return false;
  };
  let queued = false;
  const observer = new MutationObserver((records) => {
    if (queued || !relevantMutation(records)) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncAll();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = window.setInterval(() => {
    if (document.visibilityState === "hidden") return;
    syncKnown();
  }, 1000);
  const unsubscribe = options.subscribe(syncKnown);
  syncAll();
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

/** Keep the saved source beside the transcript, using native mention context. */
export async function insertDictationIntoComposer(promptbox: HTMLElement | null, text: string, recordings: readonly RecordingReference[] = []): Promise<boolean> {
  if (!insertIntoComposer(promptbox, text)) return false;
  for (const recording of recordings) {
    // Let TipTap commit the typed transcript before the SDK reads its draft.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const event = new CustomEvent(COMPOSER_REFERENCE_EVENT, { bubbles: true, cancelable: true, detail: { recording } });
    promptbox?.dispatchEvent(event);
    if (!event.defaultPrevented) {
      insertIntoComposer(promptbox, `\n\n${recordingLink(recording)}`);
    }
  }
  return true;
}

function textBeforeCaret(editor: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return editor.textContent ?? "";
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(editor);
  range.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
  return range.toString();
}

/** The visible composer holding focus, else the last visible composer on screen. */
export function findComposer(focused: Element | null = document.activeElement): HTMLElement | null {
  const all = visibleComposers();
  const owner = focused?.closest<HTMLElement>("[data-promptbox]");
  return (owner && all.includes(owner) ? owner : all.at(-1)) ?? null;
}
