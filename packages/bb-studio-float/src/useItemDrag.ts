import { setDragTarget, STUDIO_TARGET_TYPE, studioTargetAt } from "@bb-studio/kit/app";
import { useEffect, useState } from "react";

export function useItemDrag(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let pendingDrop: ReturnType<typeof setTimeout> | undefined;
    const onDragStart = (event: DragEvent) => {
      const target = studioTargetAt(event.target instanceof Element ? event.target : null);
      if (!target || !event.dataTransfer) return;
      setDragTarget(event.dataTransfer, target);
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes(STUDIO_TARGET_TYPE)) setDragging(true);
    };
    const stop = () => setDragging(false);
    const onDrop = () => { pendingDrop = setTimeout(stop, 0); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") stop(); };
    const onPointerMove = (event: MouseEvent) => { if (event.buttons === 0) stop(); };
    const onDragLeave = (event: DragEvent) => {
      if ((event.target === document.documentElement || event.target === document) && !event.relatedTarget) stop();
    };
    const onVisibility = () => { if (document.hidden) stop(); };
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("dragend", stop, true);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", stop, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("mousemove", onPointerMove, true);
    window.addEventListener("blur", stop);
    return () => {
      clearTimeout(pendingDrop);
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("dragend", stop, true);
      window.removeEventListener("drop", onDrop, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", stop, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("mousemove", onPointerMove, true);
      window.removeEventListener("blur", stop);
    };
  }, []);
  return dragging;
}
