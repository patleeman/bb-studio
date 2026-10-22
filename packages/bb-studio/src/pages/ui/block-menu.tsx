// The block handle's menu: BlockNote's own items, plus handing a checklist
// item to an agent.
import { SideMenuExtension } from "@blocknote/core";
import {
  BlockColorsItem,
  DragHandleMenu,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtensionState,
} from "@blocknote/react";
import { errorMessage } from "../../kit/format";
import { Icon } from "../../kit/ui/index";
import { useMemo } from "react";
import { toast } from "sonner";
import type { PageSchema } from "./blocks";
import { usePagesUi } from "./context";

type Editor = ReturnType<typeof useBlockNoteEditor<PageSchema["blockSchema"], PageSchema["inlineContentSchema"], PageSchema["styleSchema"]>>;

const isEmptyParagraph = (block: Editor["document"][number] | undefined) =>
  block?.type === "paragraph" && Array.isArray(block.content) && block.content.length === 0;

/**
 * Puts an embed in place of an empty paragraph, or after any other block,
 * and leaves the cursor in a paragraph below it so writing can carry on.
 */
export function placeEmbed(editor: Editor, blockId: string, props: { kind: "drawing" | "artifact" | "recording" | "mini" | "item"; target: string }) {
  const block = editor.getBlock(blockId);
  const embed = { type: "embed" as const, props };
  const placed = !block
    ? editor.insertBlocks([embed], editor.document[editor.document.length - 1]!, "after")[0]!
    : isEmptyParagraph(block)
      ? editor.updateBlock(block, embed)
      : editor.insertBlocks([embed], block, "after")[0]!;
  let next = editor.getNextBlock(placed);
  if (!isEmptyParagraph(next)) next = editor.insertBlocks([{ type: "paragraph" }], placed, "after")[0]!;
  editor.setTextCursorPosition(next!, "start");
}

/** On a checklist item: start an agent on it, linked back on the item. */
function HandToAgentItem({ pageId }: { pageId: string }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<PageSchema["blockSchema"], PageSchema["inlineContentSchema"], PageSchema["styleSchema"]>();
  const ui = usePagesUi();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (block?.type !== "checkListItem") return null;
  return (
    <Components.Generic.Menu.Item className="bn-menu-item whitespace-nowrap" icon={<Icon name="Sent" className="size-4" />} onClick={() => void handOffChecklist(ui, pageId, block.id)}>
      Hand to agent
    </Components.Generic.Menu.Item>
  );
}

export async function handOffChecklist(ui: ReturnType<typeof usePagesUi>, pageId: string, blockId: string) {
  try {
    await ui.handOffChecklist(pageId, blockId);
    toast.success("An agent is on it. Its thread is linked on the item.");
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

/** BlockNote's side menu, with the page's block handle menu. */
export function PageSideMenu({ pageId }: { pageId: string }) {
  const menu = useMemo(() => () => <PageBlockMenu pageId={pageId} />, [pageId]);
  return <SideMenuController sideMenu={(props) => <SideMenu {...props} dragHandleMenu={menu} />} />;
}

function PageBlockMenu({ pageId }: { pageId: string }) {
  const dict = useDictionary();
  return (
    <DragHandleMenu>
      <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
      <BlockColorsItem>{dict.drag_handle.colors_menuitem}</BlockColorsItem>
      <TableRowHeaderItem>{dict.drag_handle.header_row_menuitem}</TableRowHeaderItem>
      <TableColumnHeaderItem>{dict.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
      <HandToAgentItem pageId={pageId} />
    </DragHandleMenu>
  );
}
