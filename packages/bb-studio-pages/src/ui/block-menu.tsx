// The block handle's menu: BlockNote's own items, plus "Turn into database"
// on a basic table, which moves its cells into a new Studio table and embeds
// that live in the table's place.
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
import { errorMessage } from "@bb-studio/kit/format";
import { Icon } from "@bb-studio/kit/ui";
import { useMemo } from "react";
import { toast } from "sonner";
import type { PageSchema } from "./blocks";
import { usePagesUi } from "./context";
import { databaseFromGrid, tableBlockGrid, type TableBlockContent } from "./database";

type Editor = ReturnType<typeof useBlockNoteEditor<PageSchema["blockSchema"], PageSchema["inlineContentSchema"], PageSchema["styleSchema"]>>;

const isEmptyParagraph = (block: Editor["document"][number] | undefined) =>
  block?.type === "paragraph" && Array.isArray(block.content) && block.content.length === 0;

/**
 * Puts an embed in place of an empty paragraph, or after any other block,
 * and leaves the cursor in a paragraph below it so writing can carry on.
 */
export function placeEmbed(editor: Editor, blockId: string, props: { kind: "table" | "task" | "board" | "drawing" | "artifact" | "recording" | "item"; target: string }) {
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

function TurnIntoDatabaseItem({ pageId, pageTitle }: { pageId: string; pageTitle: string }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<PageSchema["blockSchema"], PageSchema["inlineContentSchema"], PageSchema["styleSchema"]>();
  const ui = usePagesUi();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (block?.type !== "table") return null;
  const convert = async () => {
    const { columns, rows } = databaseFromGrid(tableBlockGrid(block.content as TableBlockContent), () => `col_${crypto.randomUUID().slice(0, 12)}`);
    if (!columns.length) return void toast.error("This table has no columns to turn into a database.");
    try {
      const table = await ui.createTable({ pageId, title: pageTitle.trim() || "Untitled table", columns, rows });
      if (!editor.getBlock(block.id)) return void toast.error("The table was removed while it was converting; it's saved in Tables.");
      editor.updateBlock(block.id, { type: "embed", props: { kind: "table", target: table.id } });
      toast.success(rows.length === 1 ? "Turned 1 row into a database." : `Turned ${rows.length} rows into a database.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  return (
    <Components.Generic.Menu.Item className="bn-menu-item whitespace-nowrap" icon={<Icon name="Rows2" className="size-4" />} onClick={() => void convert()}>
      Turn into database
    </Components.Generic.Menu.Item>
  );
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
export function PageSideMenu({ pageId, pageTitle }: { pageId: string; pageTitle: string }) {
  const menu = useMemo(() => () => <PageBlockMenu pageId={pageId} pageTitle={pageTitle} />, [pageId, pageTitle]);
  return <SideMenuController sideMenu={(props) => <SideMenu {...props} dragHandleMenu={menu} />} />;
}

function PageBlockMenu({ pageId, pageTitle }: { pageId: string; pageTitle: string }) {
  const dict = useDictionary();
  return (
    <DragHandleMenu>
      <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
      <BlockColorsItem>{dict.drag_handle.colors_menuitem}</BlockColorsItem>
      <TableRowHeaderItem>{dict.drag_handle.header_row_menuitem}</TableRowHeaderItem>
      <TableColumnHeaderItem>{dict.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
      <TurnIntoDatabaseItem pageId={pageId} pageTitle={pageTitle} />
      <HandToAgentItem pageId={pageId} />
    </DragHandleMenu>
  );
}
