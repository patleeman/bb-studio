import { useAtom } from "jotai";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { sidebarHideEmptyProjectsAtom } from "../preferences/atoms.js";

export function HideEmptyProjectsMenuItems() {
  const [hideEmptyProjects, setHideEmptyProjects] = useAtom(
    sidebarHideEmptyProjectsAtom,
  );
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup aria-label="Projects">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={hideEmptyProjects}
          onSelect={(event) => {
            event.preventDefault();
            setHideEmptyProjects(!hideEmptyProjects);
          }}
        >
          Hide empty projects
          <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
            {hideEmptyProjects && <Icon name="Check" className="size-4" />}
          </span>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
