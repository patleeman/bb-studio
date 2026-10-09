import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SIDEBAR_CONTENT_SELECTOR } from "../ui/sidebar.js";
import { spaceDotDropId, type StudioSpace } from "./space-groups.js";

/** Studio's New space dialog; no detail. */
export const NEW_SPACE_EVENT = "studio:new-space";
/** One of a Space's dialogs; detail `{ spaceId, dialog }`. */
export const SPACE_DIALOG_EVENT = "studio:space-dialog";

/** Studio's Space dialogs: Threads and Projects move threads and projects into the Space. */
export type SpaceDialog = "edit" | "delete" | "heartbeat" | "threads" | "projects";

export function openSpaceDialog(spaceId: string, dialog: SpaceDialog): void {
  window.dispatchEvent(new CustomEvent(SPACE_DIALOG_EVENT, { detail: { spaceId, dialog }, cancelable: true }));
}

/** The `currentSpace` value for All, which stacks every Space. */
export const ALL_SPACES = "all";

/** The view before or after `currentId` (All, then each Space), wrapping around. */
export function neighbourSpaceId(spaces: readonly StudioSpace[], currentId: string | null, step: -1 | 1): string | null {
  if (!spaces.length) return null;
  const ids = [ALL_SPACES, ...spaces.map((space) => space.id)];
  const index = ids.indexOf(currentId ?? "");
  return ids[((index < 0 ? 1 : index) + step + ids.length) % ids.length]!;
}

/** Whether `target` takes typed text: an input, textarea, select or editable element. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest("[contenteditable]:not([contenteditable=false])")) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/**
 * ⌃⌥← / ⌃⌥→ outside text fields, and a horizontal two-finger swipe over `area`, step
 * through the Spaces. A swipe switches once per gesture.
 */
export function useSpaceSwitchGestures(area: RefObject<HTMLElement | null>, step: (direction: -1 | 1) => void): void {
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey) return;
      // Text fields keep their keys, and an IME composition its arrows.
      if (event.isComposing || event.keyCode === 229 || isTextEntryTarget(event.target)) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      stepRef.current(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    let travel = 0;
    let spent = false;
    let idle: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 2) return;
      // The gesture (and its momentum) ends after a short quiet spell.
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => { travel = 0; spent = false; }, 250);
      if (spent) return;
      travel += event.deltaX;
      if (Math.abs(travel) < 120) return;
      spent = true;
      stepRef.current(travel > 0 ? 1 : -1);
    };
    element.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      element.removeEventListener("wheel", onWheel);
      if (idle) clearTimeout(idle);
    };
  }, [area]);
}

/**
 * Lets `element` fill the rest of the sidebar's scroll area, so a switcher
 * at its end sits at the bottom even when the list is short.
 */
export function useFillSidebar(element: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const target = element.current;
    const content = target?.closest<HTMLElement>(SIDEBAR_CONTENT_SELECTOR);
    if (!target || !content || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const style = getComputedStyle(content);
      const offset = target.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
      const room = content.clientHeight - offset - (Number.parseFloat(style.paddingBottom) || 0);
      target.style.minHeight = `${Math.max(0, Math.floor(room))}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(content);
    return () => {
      observer.disconnect();
      target.style.minHeight = "";
    };
  }, [element]);
}

/** A Space's emoji, or a dot in its colour. */
/** A Space heading's mark: its emoji or colour dot, or Home's house, on a small tinted square. */
export function SpaceHeadingMark({ space }: { space: StudioSpace }) {
  return (
    <span aria-hidden="true" className="mr-0.5 grid size-5 shrink-0 place-items-center rounded bg-sidebar-accent/70">
      {space.isDefault ? <Icon name="Home" className="size-3" /> : <SpaceMark space={space} />}
    </span>
  );
}

export function SpaceMark({ space, size = "sm" }: { space: StudioSpace; size?: "sm" | "md" }) {
  return (
    <span data-sidebar-space-mark="" aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center">
      {space.icon
        ? <span className={cn("leading-none", size === "md" ? "text-[15px]" : "text-[13px]")}>{space.icon}</span>
        : <span className={cn("rounded-full", size === "md" ? "size-2.5" : "size-2")} style={{ background: space.color }} />}
    </span>
  );
}

/**
 * Arc-style dots at the bottom of the list: All first, then Home for the top
 * level (the default Space), then one per other Space in
 * Studio's order, the current one highlighted, a small dot on any with a thread that needs
 * the user, and + for a new Space.
 */
export function SpaceSwitcher({ spaces, currentId, attention, onSelect }: {
  spaces: readonly StudioSpace[];
  currentId: string | null;
  attention: ReadonlySet<string>;
  onSelect(spaceId: string): void;
}) {
  return (
    <nav
      aria-label="Spaces"
      data-sidebar-space-switcher=""
      className="sticky bottom-0 z-40 mt-auto flex items-center justify-center gap-0.5 bg-sidebar px-2 pt-1.5 pb-2"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="All Spaces"
            aria-current={currentId === ALL_SPACES ? "true" : undefined}
            data-space-id={ALL_SPACES}
            onClick={() => onSelect(ALL_SPACES)}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              currentId === ALL_SPACES ? "bg-sidebar-accent text-sidebar-foreground" : "opacity-60 hover:bg-sidebar-accent/60 hover:opacity-100",
            )}
          >
            <Icon name="GridView" className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">All Spaces</TooltipContent>
      </Tooltip>
      {spaces.map((space) => (
        <SpaceDot
          key={space.id}
          space={space}
          current={space.id === currentId}
          needsYou={attention.has(space.id)}
          onSelect={onSelect}
        />
      ))}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="New Space"
            onClick={() => window.dispatchEvent(new CustomEvent(NEW_SPACE_EVENT, { cancelable: true }))}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-60 outline-none transition-colors hover:bg-sidebar-accent/60 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Icon name="Plus" className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">New Space</TooltipContent>
      </Tooltip>
    </nav>
  );
}

/** One Space's dot, or Home for the default Space; a thread dragged onto it moves into the Space. */
function SpaceDot({ space, current, needsYou, onSelect }: {
  space: StudioSpace;
  current: boolean;
  needsYou: boolean;
  onSelect(spaceId: string): void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: spaceDotDropId(space.id) });
  const name = space.isDefault ? "Home" : space.name;
  return (
    <span ref={setNodeRef} className="inline-flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={needsYou ? `${name}, needs you` : name}
            aria-current={current ? "true" : undefined}
            data-space-id={space.id}
            data-drop-target={isOver ? "" : undefined}
            onClick={() => onSelect(space.id)}
            className={cn(
              "relative inline-flex size-7 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              isOver ? "bg-sidebar-accent opacity-100 ring-2 ring-sidebar-ring"
                : current ? "bg-sidebar-accent" : "opacity-60 hover:bg-sidebar-accent/60 hover:opacity-100",
            )}
          >
            {space.isDefault ? <Icon name="Home" className="size-3.5" /> : <SpaceMark space={space} size="md" />}
            {needsYou ? <span data-space-needs-you="" aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-warning" /> : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{isOver ? `Move to ${name}` : name}</TooltipContent>
      </Tooltip>
    </span>
  );
}
