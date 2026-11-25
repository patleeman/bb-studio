import type { MouseEvent } from "react";
import { cn } from "./utils";

const OVERLAY_TRIGGER_CLASS_NAME = "select-none";

type OverlayTriggerClassNameResolver = (className?: string) => string;

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export const getOverlayTriggerClassName: OverlayTriggerClassNameResolver = (
  className,
) => cn(OVERLAY_TRIGGER_CLASS_NAME, className);

function isKeyboardInputElement(element: Element): element is HTMLElement {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return (
      !element.disabled &&
      !element.readOnly &&
      !NON_TEXT_INPUT_TYPES.has(element.type)
    );
  }
  if (!(element instanceof HTMLElement)) return false;

  return (
    element.isContentEditable ||
    element.closest("[contenteditable='true']") !== null
  );
}

export function blurActiveKeyboardInputWithin(container: Element | null): void {
  if (typeof document === "undefined") return;

  const activeElement = document.activeElement;
  if (!activeElement || !isKeyboardInputElement(activeElement)) return;
  if (container !== null && !container.contains(activeElement)) return;

  activeElement.blur();
}

export function blurActiveKeyboardInputBeforeOverlayOpen(): void {
  blurActiveKeyboardInputWithin(null);
}

export function blurActiveKeyboardInputBeforeOverlayClose(): void {
  blurActiveKeyboardInputWithin(null);
}

export function preventOverlayTriggerSelection(event: MouseEvent): void {
  event.preventDefault();
}

// Window-global input modality tracker: first bundle to load wins across
// plugins, and a same-plugin reload replaces only its own listeners (not tied
// to a single plugin's unload).
const MODALITY_KEY = Symbol.for("bb-studio.overlay-modality");
const DEFAULT_OWNER = "studio";
type ModalityState = { owner: string; modality: "pointer" | "keyboard"; dispose: () => void };
type ModalityHost = Document & {
  [MODALITY_KEY]?: true | ModalityState;
};

function isModalityState(value: unknown): value is ModalityState {
  return !!value && typeof value === "object"
    && typeof (value as { owner?: unknown }).owner === "string"
    && typeof (value as { dispose?: unknown }).dispose === "function";
}

export function installOverlayModality(
  doc: Document = document,
  options?: { signal?: AbortSignal; replace?: boolean; owner?: string },
): () => void {
  const host = doc as ModalityHost;
  const owner = options?.owner ?? DEFAULT_OWNER;
  const existing = host[MODALITY_KEY];
  let previousModality: "pointer" | "keyboard" = "pointer";
  if (existing) {
    if (!isModalityState(existing) || existing.owner !== owner) return () => {};
    if (!options?.replace) return existing.dispose;
    previousModality = existing.modality;
    existing.dispose();
  }
  if (options?.signal?.aborted) return () => {};
  const controller = new AbortController();
  const state: ModalityState = {
    owner,
    modality: previousModality,
    dispose: () => {
      controller.abort();
      if (host[MODALITY_KEY] === state) delete host[MODALITY_KEY];
    },
  };
  doc.addEventListener(
    "keydown",
    () => {
      state.modality = "keyboard";
    },
    { capture: true, signal: controller.signal },
  );
  doc.addEventListener(
    "pointerdown",
    () => {
      state.modality = "pointer";
    },
    { capture: true, signal: controller.signal },
  );
  host[MODALITY_KEY] = state;
  options?.signal?.addEventListener("abort", state.dispose, { once: true });
  return state.dispose;
}

if (typeof document !== "undefined") installOverlayModality(document, { replace: true });

export function isLastInputKeyboard(): boolean {
  if (typeof document === "undefined") return false;
  const existing = (document as ModalityHost)[MODALITY_KEY];
  return isModalityState(existing) && existing.modality === "keyboard";
}
