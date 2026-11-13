import type { SystemMessageKind } from "@bb/domain";

const HEADER_END = /^[^\n]*\bcompleted[^\n]*:\s*\n\s*\n/u;

export function childCompletedPreviewStart(
  systemMessageKind: SystemMessageKind,
  text: string,
): number {
  if (systemMessageKind !== "child-completed") return 0;
  const match = HEADER_END.exec(text);
  if (match === null) return 0;
  const rest = text.slice(match[0].length);
  return rest.trim().length > 0 ? match[0].length : 0;
}
