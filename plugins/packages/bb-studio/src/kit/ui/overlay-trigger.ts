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

const MODALITY_KEY = Symbol.for("bb-studio.overlay-modality");
type ModalityHost = Document & {
  [MODALITY_KEY]?: { modality: "pointer" | "keyboard"; dispose: () => void };
};

export function installOverlayModality(doc: Document = document, signal?: AbortSignal): () => void {
  const host = doc as ModalityHost;
  host[MODALITY_KEY]?.dispose();
  if (signal?.aborted) return () => {};
  const controller = new AbortController();
  const state: { modality: "pointer" | "keyboard"; dispose: () => void } = {
    modality: host[MODALITY_KEY]?.modality ?? "pointer",
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
  signal?.addEventListener("abort", state.dispose, { once: true });
  return state.dispose;
}

if (typeof document !== "undefined") installOverlayModality();

export function isLastInputKeyboard(): boolean {
  if (typeof document === "undefined") return false;
  return (document as ModalityHost)[MODALITY_KEY]?.modality === "keyboard";
}
