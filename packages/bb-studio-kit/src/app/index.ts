// The Studio frontend kit: the shared collection, item header, sidebar
// sections, and the pieces they are built from.
// Every Studio surface shows `title` attributes as fast tooltips.
import "../ui/fast-title";
export {
  CollectionPage,
  type CollectionFilter,
  itemKey,
  type ActionResults,
  type CollectionHandlers,
  type CollectionItem,
  type CollectionKind,
  type CollectionTag,
} from "./collection";
export { AddOnCollection, type ProviderCall } from "./add-on";
export { AddOnPanel, useAddOnPanel } from "./add-on-panel";
export { ThreadItemsPanel } from "./thread-items";
export { BarCrumb, BarSeparator, BarTitle, ChatButton, EditableTitle, ItemHeader, StudioBar, StudioBarSlot, ViewMoveMenu, openNewItemThread, type ChatMenuItem, type ItemThread } from "./item-header";
export { type RelatedRef } from "./related-panel";
export { CopyReferenceMenuItem, ItemDeleteConfirm, ItemMenu } from "./item-menu";
export { ITEM_LINK_PILLS, ItemLinkText, ItemLinkTextarea } from "./item-links";
export { itemReferenceFrom } from "./item-reference";
export { ItemDirectiveCard } from "./directive-card";
export { openAppPath, studioPath, panelHref } from "./nav";
export {
  Badge,
  Checkbox,
  DANGER_BUTTON,
  EmptyState,
  FLOATING,
  BAR_BUTTON,
  GHOST_BUTTON,
  Highlight,
  ICON_BUTTON,
  ItemTile,
  ITEM_TITLE,
  OUTLINE_BUTTON,
  PageColumn,
  PAGE_TITLE,
  PILL,
  PRIMARY_BUTTON,
  projectName,
  SECTION_TITLE,
  THUMBNAIL,
  useProjects,
  type Project,
} from "./pieces";
export { TagDot } from "./tags";
export {
  FloatDockPortal,
  FloatPanels,
  retainPanel,
  FloatThreadLeading,
  openFloat,
  useCanFloat,
  useFloatAvailable,
  useInFloat,
  useCompanionNavigate,
} from "./float";
export {
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
export { MoveToItems, MoveToSubmenu, moveToSpace, spaceOfProject, useMoveSpaces, type MoveSpace } from "./move-to";
export { CompanionView, CompanionOutlet, companionWorkbenchAvailable, openCompanion, useOpenCompanion, type CompanionPlacement, type CompanionViewProps } from "./companion";
export { useStudioChatPresent, useStudioPresent } from "./presence";
export { usePathname } from "./route";
export { NewConversationComposer, type NewConversationProps, type ConversationSubmit } from "./new-conversation";
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
  useSidebarDisplay,
  useSidebarHosted,
  useSidebarNavigated,
  type SidebarDirection,
  type SidebarDisplay,
  type SidebarSectionAction,
} from "./sidebar";
export {
  setItemChatHost,
  itemChatChanged,
  useHomeThread,
  useItemChat,
  type HomeThread,
  type ItemChatHost,
  type ItemChatRef,
} from "./item-chat";
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
