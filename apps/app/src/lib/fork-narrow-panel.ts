import { useMediaQuery } from "@bb/shared-ui/hooks/use-media-query";

export const NARROW_WINDOW_PANEL_QUERY = "(max-width: 999px)";

export function useForkPanelDrawer(isCompactViewport: boolean): boolean {
  const isNarrowWindow = useMediaQuery(NARROW_WINDOW_PANEL_QUERY);
  return isCompactViewport || isNarrowWindow;
}
