// The one look of a Tasks page row that opens its task: Your to-do, In
// flight (and its subtasks), an area card's open item, the Done list. Each is
// a button named by the task's title; it takes the same hover and focus
// state, and shows the same chevron on hover and focus. The row whose task is
// open in the side panel stays highlighted.
import { Icon, cn } from "../../kit/ui/index";

export const OPEN_ROW = "group/open cursor-pointer rounded-md text-left hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const OPEN_ROW_SELECTED = "bg-state-active hover:bg-state-active";

export function openRowClass(selected: boolean | undefined, ...rest: (string | false | null | undefined)[]): string {
  return cn(OPEN_ROW, selected && OPEN_ROW_SELECTED, ...rest);
}

/** The chevron at the end of an open row: hidden until hover or focus, always shown where there is no hover, and on the open row. */
export function OpenChevron({ selected = false, className }: { selected?: boolean; className?: string }) {
  return (
    <Icon name="ChevronRight" aria-hidden data-testid="row-open-chevron"
      className={cn("size-3.5 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover/open:opacity-100 group-focus-visible/open:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none", selected && "opacity-100", className)} />
  );
}

/** Which task's detail is open beside the page, if any. */
export type IsOpen = (taskId: string) => boolean;
export const noneOpen: IsOpen = () => false;
