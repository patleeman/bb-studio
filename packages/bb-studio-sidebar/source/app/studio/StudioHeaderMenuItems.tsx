import { showSidebarSection, useHiddenSidebarSections } from "@bb-studio/kit/app";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";

export function StudioNewProjectItem({ onSelect, disabled }: {
  onSelect?: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuItem disabled={!onSelect || disabled} onSelect={onSelect}>
      <Icon name="FolderPlus" />
      New project
    </DropdownMenuItem>
  );
}

export function HiddenStudioSectionItems() {
  const hidden = useHiddenSidebarSections();
  return hidden.map((section) => (
    <DropdownMenuItem key={section.key} onSelect={() => showSidebarSection(section.key)}>
      <Icon name="Eye" />
      Show {section.title}
    </DropdownMenuItem>
  ));
}
