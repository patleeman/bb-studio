export const TAB_WINDOW_STATE_PREFIX = "tab-window:";

export function tabWindowPanelStateId(
  threadId: string,
  windowId: string,
): string {
  return `${TAB_WINDOW_STATE_PREFIX}${windowId}:${threadId}`;
}

export function isTabWindowPanelState(panelStateId: string): boolean {
  return panelStateId.startsWith(TAB_WINDOW_STATE_PREFIX);
}

export function threadIdOfTabWindowState(panelStateId: string): string | null {
  if (!isTabWindowPanelState(panelStateId)) return null;
  const rest = panelStateId.slice(TAB_WINDOW_STATE_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator === -1) return null;
  const threadId = rest.slice(separator + 1);
  return threadId === "" ? null : threadId;
}
