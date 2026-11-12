// The Studio frontend kit: the shared collection, item header, and the
// pieces they are built from.
// Every Studio surface shows `title` attributes as fast tooltips.
import "../ui/fast-title";
export {
  CollectionPage,
  itemKey,
  type ActionResults,
  type CollectionHandlers,
  type CollectionItem,
  type CollectionKind,
  type CollectionTag,
  type CreateMenuItem,
} from "./collection";
export type { ProviderCall } from "./provider-call";
export { BarCrumb, BarSeparator, BarTitle, EditableTitle, ItemHeader, StudioBar, StudioBarSlot, openNewItemThread, useInTabRow, type ItemThread } from "./item-header";
export { CopyReferenceMenuItem, ItemDeleteConfirm, ItemMenu, LinkedThreadMenuItems } from "./item-menu";
export { canOpenInWindow, OpenInWindowMenuItem, setItemWindowOpener, type ItemWindowOpener } from "./item-window";
export { itemReferenceFrom } from "./item-reference";
export { ItemDirectiveCard, remember } from "./directive-card";
export { openAppPath, studioPath, panelHref } from "./nav";
export { containerAt, routeContainer, StudioContainerProvider, useStudioContainer, wantsAlternate, type StudioContainer } from "./container";
export { createStudioItem } from "./create-item";
export {
  Badge,
  Checkbox,
  DANGER_BUTTON,
  EmptyState,
  FLOATING,
  BAR_BUTTON,
  GHOST_BUTTON,
  Highlight,
  COMPOSER_BUTTON,
  ICON_BUTTON,
  ItemTile,
  ITEM_TITLE,
  OUTLINE_BUTTON,
  PageColumn,
  PAGE_TITLE,
  PRIMARY_BUTTON,
  projectName,
  SECTION_TITLE,
  THUMBNAIL,
  useProjects,
  type Project,
} from "./pieces";
export { TagDot } from "./tags";
export { RetainedPanels, retainPanel } from "./retained";
export {
  STUDIO_ITEM_CLICKS_OFF,
  studioItemProps,
  studioTargetAt,
  studioThreadProps,
  targetHref,
  threadLinkId,
} from "./studio-item";
export { useOpenMain, useOpenTarget, type OpenPlace, type OpenTarget } from "./move";
export { usePathname } from "./route";
export { HostRouteBridge } from "./host-bridge";
export { hostPanes, isHostSidePane, subscribeHostPanes } from "./host-panes";
export { hostTheme, subscribeHostTheme } from "./host-theme";
export {
  setItemChatHost,
  itemChatChanged,
  useHomeThread,
  useItemChat,
  type HomeThread,
  type ItemChatHost,
  type ItemChatRef,
} from "./item-chat";
export { itemStarsChanged, setItemStarHost, useItemStarHost, useItemStarred, type ItemStarHost, type ItemStarRef } from "./item-star";
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
export { Tooltip } from "../ui/tooltip";
export { cn } from "../ui/utils";

export { WORKSPACE_PATH, WORKSPACE_DRAG, setWorkspaceActive, workspaceActivePath, registerWorkspaceCloser, workspaceItemPath, canOpenWorkspaceItem, openWorkspaceItem, registerWorkspaceOpener, registerWorkspaceProvider, publishWorkspaceAnchor, subscribeWorkspace, workspaceRevision, type WorkspaceItem, type WorkspacePlacement } from "./workspace";
