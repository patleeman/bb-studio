// The ▾ beside the tab strip's +: Studio's New menu (create-menu.ts), always
// in reach. + opens a new tab; this makes an item.
import { useCallback, useEffect, useState } from "react";
import { useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Icon, useProjects } from "../kit/app/index";
import type { ProviderView, rpcContract } from "../contract";
import { newItemProject, runCreateEntry, startsGroup, useCreateEntries } from "./create-menu";
import { readLibraryQuery } from "./library-query";

export function NewItemMenu({ className }: { className: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const context = useBbContext();
  const projects = useProjects();
  const [providers, setProviders] = useState<ProviderView[]>([]);
  // Loaded up front so the menu opens full; again on open, for add-ons that came or went.
  const load = useCallback(() => { rpc.call("overview", null).then(({ providers }) => setProviders(providers ?? []), () => {}); }, [rpc]);
  useEffect(load, [load]);
  const entries = useCreateEntries(rpc, providers, providers);
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) load(); }}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={className} aria-label="New item" title="New item" disabled={!entries.length}><Icon name="ChevronDown" className="size-3" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {entries.map((entry, index) => [
          startsGroup(entries, index) ? <DropdownMenuSeparator key={`${entry.key}:separator`} /> : null,
          <DropdownMenuItem key={entry.key} onSelect={() => void runCreateEntry(entry, { rpc, projectId: newItemProject(context.projectId, readLibraryQuery(), projects) })}>
            <Icon name={entry.icon} className="size-4" /> {entry.label}
          </DropdownMenuItem>,
        ])}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
