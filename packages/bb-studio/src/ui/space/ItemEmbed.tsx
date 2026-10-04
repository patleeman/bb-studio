// Any Studio item's real view, drawn into this element through the float
// registry: the plugin that owns the path renders its panel wherever a body is
// published for it. An item whose add-on can't show outside its own page gets
// a link instead.
import { floatPanelFor, floatWindowKey, GHOST_BUTTON, Icon, openAppPath, publishFloatBody, type FloatTarget } from "@bb-studio/kit/app";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { rpcContract } from "../../contract";

/** Add-ons register as they load; give them a moment before offering the link. */
const REGISTER_GRACE_MS = 1500;

export function ItemEmbed({ path, title }: { path: string; title?: string }) {
  const element = useRef<HTMLDivElement>(null);
  const rpc = useRpc<typeof rpcContract>();
  // Open beside a lead, it's open like any other: it lists under its Space.
  useEffect(() => { rpc.call("visitTab", { path }).catch(() => {}); }, [path, rpc]);
  const target = useMemo<FloatTarget>(() => ({ kind: "path", path, ...(title ? { title } : {}) }), [path, title]);
  const [unsupported, setUnsupported] = useState(false);
  useLayoutEffect(() => {
    if (!element.current) return;
    const windowKey = floatWindowKey(target);
    publishFloatBody({ windowKey, target, element: element.current, placement: "workbench" });
    return () => publishFloatBody({ windowKey, element: null });
  }, [target]);
  useEffect(() => {
    setUnsupported(false);
    const timer = setTimeout(() => setUnsupported(!floatPanelFor(path)), REGISTER_GRACE_MS);
    return () => clearTimeout(timer);
  }, [path]);
  return (
    <div className="relative h-full min-h-0">
      <div ref={element} className="h-full min-h-0 overflow-auto" />
      {unsupported ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">{title ?? "This item"} opens on its own page.</p>
          <button type="button" onClick={() => openAppPath(path, { main: true })} className={GHOST_BUTTON}><Icon name="ArrowUpRight" className="size-4" />Open</button>
        </div>
      ) : null}
    </div>
  );
}

export function PageEmbed({ pageId }: { pageId: string }) {
  return <ItemEmbed path={`/plugins/pages/pages/${encodeURIComponent(pageId)}`} />;
}
