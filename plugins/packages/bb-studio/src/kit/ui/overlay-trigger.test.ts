// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { installOverlayModality, isLastInputKeyboard } from "./overlay-trigger";

const MODALITY_KEY = Symbol.for("bb-studio.overlay-modality");

afterEach(() => {
  const host = document as Document & { [MODALITY_KEY]?: unknown };
  const existing = host[MODALITY_KEY] as { dispose?: () => void } | undefined;
  if (existing && typeof existing.dispose === "function") existing.dispose();
  delete host[MODALITY_KEY];
  installOverlayModality(document, { replace: true });
});

it("replaces same-owner listeners on reload so the first install stops firing, and keeps first-wins across owners", () => {
  const signals: AbortSignal[] = [];
  const origAdd = document.addEventListener.bind(document);
  const addSpy = vi.spyOn(document, "addEventListener").mockImplementation((type, listener, options) => {
    if (options && typeof options === "object" && "signal" in options && options.signal) {
      signals.push(options.signal);
    }
    return origAdd(type, listener, options);
  });
  try {
    const disposeFirst = installOverlayModality(document, { replace: true, owner: "studio" });
    expect(signals).toHaveLength(2);
    expect(signals.every((s) => !s.aborted)).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(isLastInputKeyboard()).toBe(true);

    // Same-owner replace aborts the first install's listeners and preserves modality.
    const disposeSecond = installOverlayModality(document, { replace: true, owner: "studio" });
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(true);
    expect(signals[2]!.aborted).toBe(false);
    expect(signals[3]!.aborted).toBe(false);
    expect(isLastInputKeyboard()).toBe(true);

    // Different owner does NOT replace the active owner ("first wins").
    const disposeOther = installOverlayModality(document, { replace: true, owner: "visual-chat" });
    expect(signals).toHaveLength(4);
    expect(signals[2]!.aborted).toBe(false);
    disposeOther();
    expect(signals[2]!.aborted).toBe(false);

    // Disposing the active owner aborts its listeners and stops tracking.
    disposeSecond();
    expect(signals[2]!.aborted).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(isLastInputKeyboard()).toBe(false);
    disposeFirst();
  } finally {
    addSpy.mockRestore();
  }
});

it("tolerates a legacy `true` marker on document without throwing on import/install", async () => {
  const host = document as Document & { [MODALITY_KEY]?: unknown };
  const existing = host[MODALITY_KEY] as { dispose?: () => void } | undefined;
  if (existing && typeof existing.dispose === "function") existing.dispose();
  host[MODALITY_KEY] = true;

  vi.resetModules();
  await expect(import("./overlay-trigger")).resolves.toBeDefined();
  expect(host[MODALITY_KEY]).toBe(true);
});
