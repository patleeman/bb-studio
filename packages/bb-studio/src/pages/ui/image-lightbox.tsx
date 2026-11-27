import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../kit/ui/index";
import {
  clampView,
  doubleClickView,
  fitView,
  isFit,
  KEY_STEP,
  panBy,
  stepIndex,
  wheelFactor,
  zoomBy,
  type Size,
  type View,
} from "./lightbox-math";

export type LightboxImage = { src: string; alt: string; caption: string };

/** Fired by an image block's expand button; PageEditor opens the lightbox on it. */
export const PAGE_IMAGE_OPEN_EVENT = "pages-image-open";

/** The images in a page's editor, in document order. */
export function pageImages(root: ParentNode): { images: LightboxImage[]; elements: HTMLImageElement[] } {
  const elements = [...root.querySelectorAll<HTMLImageElement>('[data-content-type="image"] img.bn-visual-media')];
  const images = elements.map((img) => ({
    src: img.currentSrc || img.src,
    alt: img.alt,
    caption: img.closest(".bn-file-block-content-wrapper")?.querySelector(".bn-file-caption")?.textContent ?? "",
  }));
  return { images, elements };
}

/** Zoom steps from keys and double-clicks ease; wheel, pinch and drag follow the hand. */
const EASE = "transform 160ms cubic-bezier(0.2, 0, 0, 1)";

/**
 * A page image over the page. The image is one element moved by one
 * translate+scale transform, written straight to its style so zooming and
 * dragging never re-render React. The image is laid out at its own pixel
 * size, and the transform scales it, so a 4K image stays one GPU layer.
 */
export function ImageLightbox({ images, index, onIndex, onClose }: {
  images: LightboxImage[];
  index: number;
  onIndex(index: number): void;
  onClose(): void;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const view = useRef<View>({ scale: 1, x: 0, y: 0 });
  const natural = useRef<Size>({ width: 0, height: 0 });
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const image = images[index];

  const viewport = (): Size => ({ width: overlay.current?.clientWidth ?? 0, height: overlay.current?.clientHeight ?? 0 });

  const apply = useCallback((next: View, ease = false) => {
    view.current = next;
    const element = img.current;
    if (!element) return;
    element.style.transition = ease ? EASE : "none";
    element.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
    element.dataset.zoom = next.scale.toFixed(4);
    const fitted = isFit(next, natural.current, viewport());
    element.dataset.fit = String(fitted);
    element.style.cursor = fitted ? "zoom-in" : drag.current?.moved ? "grabbing" : "grab";
    if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(next.scale * 100)}%`;
  }, []);

  const fit = useCallback((ease = false) => apply(fitView(natural.current, viewport()), ease), [apply]);

  // A new image starts hidden until its size is known, then fits.
  useLayoutEffect(() => {
    setLoaded(false);
    natural.current = { width: 0, height: 0 };
    const element = img.current;
    if (element?.complete && element.naturalWidth) onLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.src]);

  function onLoad() {
    const element = img.current;
    if (!element) return;
    natural.current = { width: element.naturalWidth, height: element.naturalHeight };
    element.style.width = `${element.naturalWidth}px`;
    element.style.height = `${element.naturalHeight}px`;
    fit();
    setLoaded(true);
  }

  // The window resizing keeps a fitted image fitted and a zoomed one in bounds.
  useEffect(() => {
    const onResize = () => {
      if (!natural.current.width) return;
      if (isFit(view.current, natural.current, viewport())) fit();
      else apply(clampView(view.current, natural.current, viewport()));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [apply, fit]);

  // Focus moves into the viewer and back to where it was when it closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    overlay.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  const center = () => {
    const size = viewport();
    return { x: size.width / 2, y: size.height / 2 };
  };

  const step = useCallback((delta: number) => {
    const next = stepIndex(index, delta, images.length);
    if (next !== null) onIndex(next);
  }, [index, images.length, onIndex]);

  // Keys are the viewer's while it is open: they never reach the page behind.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && !["=", "+", "-"].includes(event.key)) return;
      let handled = true;
      switch (event.key) {
        case "Escape": onClose(); break;
        case "ArrowLeft": step(-1); break;
        case "ArrowRight": step(1); break;
        case "+": case "=": apply(zoomBy(view.current, KEY_STEP, center(), natural.current, viewport()), true); break;
        case "-": case "_": apply(zoomBy(view.current, 1 / KEY_STEP, center(), natural.current, viewport()), true); break;
        case "0": fit(true); break;
        default: handled = false;
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [apply, fit, onClose, step]);

  // Wheel: a pinch (Chromium sends it as ctrl-wheel) or Ctrl/Cmd-scroll zooms
  // on the pointer; a plain scroll pans a zoomed image. Never scrolls the page.
  useEffect(() => {
    const element = overlay.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!natural.current.width) return;
      const rect = element.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (event.ctrlKey || event.metaKey) {
        apply(zoomBy(view.current, wheelFactor(event.deltaY, event.deltaMode), anchor, natural.current, viewport()));
      } else if (!isFit(view.current, natural.current, viewport())) {
        apply(panBy(view.current, -event.deltaX, -event.deltaY, natural.current, viewport()));
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [apply]);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    if (event.target === img.current && !isFit(view.current, natural.current, viewport())) {
      event.preventDefault();
      img.current?.setPointerCapture?.(event.pointerId);
    }
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 3) return;
    current.moved = true;
    current.x = event.clientX;
    current.y = event.clientY;
    if (isFit(view.current, natural.current, viewport())) return;
    apply(panBy(view.current, dx, dy, natural.current, viewport()));
  };
  const onPointerUp = (event: React.PointerEvent) => {
    if (drag.current?.id !== event.pointerId) return;
    img.current?.releasePointerCapture?.(event.pointerId);
    // Read by the click that follows, then cleared.
    setTimeout(() => { drag.current = null; }, 0);
    if (img.current) img.current.style.cursor = isFit(view.current, natural.current, viewport()) ? "zoom-in" : "grab";
  };

  // A click on the backdrop closes; a click that ended a drag doesn't.
  const onClick = (event: React.MouseEvent) => {
    if (drag.current?.moved) return;
    if (event.target === overlay.current) onClose();
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    if (event.target !== img.current || !natural.current.width) return;
    const rect = overlay.current!.getBoundingClientRect();
    apply(doubleClickView(view.current, { x: event.clientX - rect.left, y: event.clientY - rect.top }, natural.current, viewport()), true);
  };

  if (!image) return null;
  const many = images.length > 1;
  return createPortal(
    <div
      ref={overlay}
      role="dialog"
      aria-modal="true"
      aria-label={image.alt || image.caption || "Image"}
      tabIndex={-1}
      data-pages-lightbox=""
      className="pages-lightbox"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <img
        ref={img}
        key={image.src}
        src={image.src}
        alt={image.alt}
        draggable={false}
        decoding="async"
        onLoad={onLoad}
        className="pages-lightbox-image"
        // Inline: the view's x and y are the image's top-left corner.
        style={{ transformOrigin: "0 0", opacity: loaded ? 1 : 0 }}
      />
      <div className="pages-lightbox-bar">
        <span className="pages-lightbox-chip pages-lightbox-caption">
          {many ? `${index + 1} / ${images.length}` : null}
          {many && image.caption ? " · " : null}
          {image.caption}
        </span>
        <span className="pages-lightbox-tools">
          <span ref={zoomLabel} className="pages-lightbox-chip pages-lightbox-zoom" />
          <button
            type="button"
            aria-label="Close"
            title="Close (Esc)"
            className="pages-lightbox-button"
            onClick={(event) => { event.stopPropagation(); onClose(); }}
          >
            <Icon name="X" className="size-4" />
          </button>
        </span>
      </div>
      {many ? (
        <>
          <LightboxStep side="left" disabled={index === 0} onStep={() => step(-1)} />
          <LightboxStep side="right" disabled={index === images.length - 1} onStep={() => step(1)} />
        </>
      ) : null}
    </div>,
    document.body,
  );
}

function LightboxStep({ side, disabled, onStep }: { side: "left" | "right"; disabled: boolean; onStep(): void }) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous image" : "Next image"}
      title={side === "left" ? "Previous (←)" : "Next (→)"}
      disabled={disabled}
      className="pages-lightbox-button pages-lightbox-step"
      data-side={side}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); onStep(); }}
    >
      <Icon name={side === "left" ? "ChevronLeft" : "ChevronRight"} className="size-5" />
    </button>
  );
}
