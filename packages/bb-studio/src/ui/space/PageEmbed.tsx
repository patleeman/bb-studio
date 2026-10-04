// The real Pages editor, drawn into this element through the float registry:
// the Pages plugin renders its page view wherever a body is published for it.
import { floatWindowKey, publishFloatBody, type FloatTarget } from "@bb-studio/kit/app";
import { useLayoutEffect, useMemo, useRef } from "react";

export function PageEmbed({ pageId }: { pageId: string }) {
  const element = useRef<HTMLDivElement>(null);
  const target = useMemo<FloatTarget>(() => ({ kind: "path", path: `/plugins/pages/pages/${encodeURIComponent(pageId)}` }), [pageId]);
  useLayoutEffect(() => {
    if (!element.current) return;
    const windowKey = floatWindowKey(target);
    publishFloatBody({ windowKey, target, element: element.current, placement: "workbench" });
    return () => publishFloatBody({ windowKey, element: null });
  }, [target]);
  return <div ref={element} className="h-full min-h-0 overflow-auto" />;
}
