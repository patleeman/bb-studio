// The Studio frontend kit: the shared collection, item header, sidebar
// sections, and the pieces they are built from.
export {
  CollectionPage,
  type CollectionFilter,
  itemKey,
  sortItems,
  toggleSelection,
  type ActionResults,
  type CollectionHandlers,
  type CollectionItem,
  type CollectionKind,
  type CollectionTag,
} from "./collection";
export { AddOnCollection, type ProviderCall } from "./add-on";
export { AddOnPanel, useAddOnPanel } from "./add-on-panel";
export { ThreadItemsPanel } from "./thread-items";
export { EditableTitle, ItemHeader, openNewItemThread, useNewItemThread, type ItemThread } from "./item-header";
export { RelatedPanel, type RelatedRef } from "./related-panel";
export { SpaceMark, SpaceMenuItems, SpacePicker, type MenuSpace } from "./space-picker";
export { spaceMembership, type SpaceHolder, type SpaceMembership } from "./space-state";
export { ItemDeleteConfirm, ItemMenu } from "./item-menu";
export { ItemDirectiveCard } from "./directive-card";
export { openAppPath, studioPath } from "./nav";
export {
  Badge,
  Checkbox,
  DANGER_BUTTON,
  EmptyState,
  FLOATING,
  FLOATING_BUTTON,
  GHOST_BUTTON,
  Highlight,
  ICON_BUTTON,
  ItemTile,
  OUTLINE_BUTTON,
  PageColumn,
  PILL,
  PRIMARY_BUTTON,
  projectName,
  THUMBNAIL,
  useProjects,
  type Project,
} from "./pieces";
export { TagDot } from "./tags";
export {
  FloatDockPortal,
  FloatPanels,
  FloatThreadLeading,
  openFloat,
  useCanFloat,
  useFloatAvailable,
  useInFloat,
} from "./float";
export {
  FLOAT_WINDOW_ATTRIBUTE,
  floatPanelFor,
  floatWindowKey,
  navigateFromFloat,
  publishFloatBody,
  publishFloatDock,
  publishFloatLeading,
  setFloatHost,
  type FloatOpenOptions,
  type FloatTarget,
} from "./float-registry";
export {
  dropTarget,
  openPathInSplit,
  pluginViewPath,
  setDragTarget,
  STUDIO_ITEM_CLICKS_OFF,
  STUDIO_TARGET_TYPE,
  studioItemProps,
  studioTargetAt,
  studioThreadProps,
  targetHref,
  threadLinkId,
  type StudioItemLink,
} from "./studio-item";
export { useOpenTarget, type OpenPlace } from "./move";
export { COMPOSER_MORE_ITEM, ComposerMore, useComposerMoreSide } from "./composer-more";
export { usePluginPresent, useStudioChatPresent, useStudioPresent } from "./presence";
export { usePathname } from "./route";
export {
  SIDEBAR_ROW,
  SIDEBAR_ROW_SELECTED,
  SidebarAnchors,
  SidebarDisplayMenuItems,
  SidebarGroupHeading,
  SidebarNote,
  SidebarPortal,
  SidebarSection,
  showSidebarSection,
  useHiddenSidebarSections,
  useExpandSidebarSection,
  useSidebarDisplay,
  useSidebarHosted,
  useSidebarNavigated,
  type SidebarDirection,
  type SidebarDisplay,
  type SidebarSectionAction,
} from "./sidebar";
export { publishThreadBadges, useThreadBadge, type ThreadBadge } from "./thread-badges";
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
export { Icon } from "../ui/icon";
export { cn } from "../ui/utils";
