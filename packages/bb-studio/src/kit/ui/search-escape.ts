// "Esc clears search", the same in every Studio search and filter field: the
// first Escape empties the field, and only an Escape on an empty field goes
// on to close what the field is in (a popover, a dialog, a picker) or, where
// it is in nothing, to leave the field.
import { useCallback, useEffect, useRef } from "react";

/** The parts of a key event the handlers read; React's and the DOM's both fit. */
export interface EscapeKeyEvent {
  key: string;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
  currentTarget?: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface SearchEscapeOptions {
  /**
   * Escape on an empty field: "pass" (the default) lets the key through, so
   * the popover, dialog or picker around the field closes; "blur" leaves the
   * field, for one that is in nothing.
   */
  whenEmpty?: "pass" | "blur";
}

const composing = (event: EscapeKeyEvent) => Boolean(event.isComposing ?? event.nativeEvent?.isComposing);

/**
 * Handles Escape for a search field holding `value`. True when the key was
 * used up here: the field was cleared (and the key stopped, so nothing around
 * it closes). False for every other key, and for Escape on an empty field.
 */
export function handleSearchEscape(event: EscapeKeyEvent, value: string, clear: () => void, options: SearchEscapeOptions = {}): boolean {
  // Escape while composing text (an IME) cancels the composition, nothing else.
  if (event.key !== "Escape" || composing(event)) return false;
  if (value) {
    event.preventDefault();
    event.stopPropagation();
    clear();
    return true;
  }
  if (options.whenEmpty === "blur") (event.currentTarget as { blur?(): void } | null | undefined)?.blur?.();
  return false;
}

/** An `onKeyDown` for a search field: `<input value={q} onKeyDown={searchEscape(q, () => setQ(""))} />`. */
export function searchEscape(value: string, clear: () => void, options: SearchEscapeOptions = {}): (event: EscapeKeyEvent) => void {
  return (event) => { handleSearchEscape(event, value, clear, options); };
}

/**
 * The same for a search field inside a dialog, popover or drawer that closes
 * on Escape by listening on the document (Radix does, before any `onKeyDown`
 * runs): returns a ref for the field. Escape in the field while it holds text
 * clears it and never reaches the layer; on an empty field it does, and the
 * layer closes.
 */
export function useSearchEscape<Field extends HTMLElement = HTMLInputElement>(value: string, clear: () => void): (field: Field | null) => void {
  const field = useRef<Field | null>(null);
  const latest = useRef({ value, clear });
  latest.current = { value, clear };
  useEffect(() => {
    // The window hears a key before the document does.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!field.current || event.target !== field.current) return;
      handleSearchEscape(event, latest.current.value, latest.current.clear);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
  return useCallback((element: Field | null) => { field.current = element; }, []);
}
