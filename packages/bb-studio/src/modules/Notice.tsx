import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState, type ComponentType } from "react";
import { moduleStatusContract } from "./status";

function useModules() {
  const rpc = useRpc<typeof moduleStatusContract>();
  const [status, setStatus] = useState<{ active: string[]; legacyInstalled: string[] } | null>(null);
  useEffect(() => { let live = true; void rpc.call("modules_status", null).then(value => { if (live) setStatus(value); }).catch(() => {}); return () => { live = false; }; }, [rpc]);
  return status;
}
export function ModuleNotice() {
  const status = useModules();
  if (!status?.legacyInstalled.length) return null;
  return <aside role="status" className="fixed bottom-4 left-4 z-50 max-w-lg rounded-lg border border-border bg-background p-4 text-sm shadow-lg">
    Studio now includes {status.legacyInstalled.join(", ")}. Disable these old plugins in Settings → Plugins, then reload Studio to import their data and settings. After the import, uninstall the old plugins. Their database files are kept.
  </aside>;
}
export function moduleComponent<P extends object>(name: string, Component: ComponentType<P>): ComponentType<P> {
  return function ModuleComponent(props: P) {
    return useModules()?.active.includes(name) ? <Component {...props} /> : null;
  };
}
