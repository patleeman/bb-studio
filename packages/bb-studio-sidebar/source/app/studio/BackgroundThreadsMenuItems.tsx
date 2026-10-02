import { useAtom, useSetAtom } from "jotai";
import { Icon } from "@/components/ui/icon";
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { sidebarBackgroundCollapsedAtom, sidebarBackgroundThreadsAtom } from "../preferences/atoms.js";

export function BackgroundThreadsMenuItems() {
  const [mode, setMode] = useAtom(sidebarBackgroundThreadsAtom);
  const setCollapsed = useSetAtom(sidebarBackgroundCollapsedAtom);
  return <>
    <DropdownMenuSeparator />
    <DropdownMenuGroup aria-label="Background threads">
      <DropdownMenuLabel>Background threads</DropdownMenuLabel>
      {([
        ["grouped", "Group in Background"],
        ["updates", "Only show updates"],
        ["hidden", "Hide background threads"],
        ["all", "Show with other threads"],
      ] as const).map(([value, label]) => <DropdownMenuItem key={value} role="menuitemradio" aria-checked={mode === value} onSelect={(event) => {
        event.preventDefault();
        setMode(value);
        if (value === "updates") setCollapsed(false);
      }}>
        {label}
        <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">{mode === value && <Icon name="Check" className="size-4" />}</span>
      </DropdownMenuItem>)}
    </DropdownMenuGroup>
  </>;
}
