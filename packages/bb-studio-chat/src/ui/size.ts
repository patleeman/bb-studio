// The card's size. It's anchored bottom right, so dragging its top-left
// corner up and left makes it bigger. The size is the same in every window.
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

export interface CardSize {
  width: number;
  height: number;
}

const KEY = "bb-studio-chat:size";
export const DEFAULT_SIZE: CardSize = { width: 460, height: 620 };
const MIN: CardSize = { width: 340, height: 320 };

/** Keeps the card on screen, clear of the edge and of the top bar. */
export function clampSize(size: CardSize, viewport: CardSize): CardSize {
  const limit = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
  return {
    width: limit(size.width, MIN.width, viewport.width - 40),
    height: limit(size.height, MIN.height, viewport.height - 112),
  };
}

function read(): CardSize {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<CardSize> | null;
    if (typeof saved?.width === "number" && typeof saved.height === "number") {
      return { width: saved.width, height: saved.height };
    }
  } catch {
    /* Fall back to the default. */
  }
  return DEFAULT_SIZE;
}

const viewport = (): CardSize => ({ width: window.innerWidth, height: window.innerHeight });

/** The card's size, and pointer handlers for its resize grip. Double-click resets it. */
export function useCardSize() {
  const [size, setSize] = useState<CardSize>(() => clampSize(read(), viewport()));
  const drag = useRef<{ x: number; y: number; start: CardSize } | null>(null);
  const latest = useRef(size);
  latest.current = size;

  useEffect(() => {
    const onResize = () => setSize((current) => clampSize(current, viewport()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const save = (next: CardSize) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* The size just won't survive a reload. */
    }
  };

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, start: size };
    },
    [size],
  );
  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const from = drag.current;
    if (!from) return;
    setSize(
      clampSize(
        { width: from.start.width + from.x - event.clientX, height: from.start.height + from.y - event.clientY },
        viewport(),
      ),
    );
  }, []);
  const onPointerUp = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    save(latest.current);
  }, []);
  const onDoubleClick = useCallback(() => {
    const next = clampSize(DEFAULT_SIZE, viewport());
    setSize(next);
    save(DEFAULT_SIZE);
  }, []);

  return { size, grip: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick } };
}
