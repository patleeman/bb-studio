import type { SystemMessageKind } from "@bb/domain";
import { usePluginMessageClassification } from "@/lib/fork-reply-classifiers";

const HEADER_END = /^[^\n]*\bcompleted[^\n]*:\s*\n\s*\n/u;
const SKIPPED_LINE = /^\s*(?:\||#{1,6}(?:\s|$)|(?:[-*_]\s*){3,}$|```|~~~|$)/u;

export function childCompletedPreviewStart(
  systemMessageKind: SystemMessageKind,
  text: string,
): number {
  if (systemMessageKind !== "child-completed") return 0;
  const match = HEADER_END.exec(text);
  if (match === null) return 0;
  const bodyStart = match[0].length;
  if (text.slice(bodyStart).trim().length === 0) return 0;
  let offset = bodyStart;
  while (offset < text.length) {
    const lineEnd = text.indexOf("\n", offset);
    const end = lineEnd === -1 ? text.length : lineEnd;
    if (!SKIPPED_LINE.test(text.slice(offset, end))) return offset;
    offset = end + 1;
  }
  return bodyStart;
}

export function useGeneratedPreviewStart(
  systemMessageKind: SystemMessageKind,
  text: string,
): number {
  const childStart = childCompletedPreviewStart(systemMessageKind, text);
  const classification = usePluginMessageClassification(text, {
    part: "body",
    initiator: null,
  });
  if (childStart > 0) return childStart;
  const start = classification?.previewStart ?? 0;
  return text.slice(start).trim().length === 0 ? 0 : start;
}
