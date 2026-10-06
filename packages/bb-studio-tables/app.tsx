import { RetainedPanels, retainPanel, StudioBarSlot } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TABLES_TAB, TableCard } from "./src/card";
import { TablesPanel, ThreadTablesPanel } from "./src/panel";
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tables",
    title: "Tables",
    icon: "Rows2",
    path: "tables",
    component: retainPanel("tables", TablesPanel),
    headerContent: StudioBarSlot,
  });
  // Keeps the panel's views alive across route changes (with retainPanel).
  app.slots.experimental_appOverlay({ id: "retained", component: () => <RetainedPanels path="tables" render={(subPath) => <TablesPanel subPath={subPath} />} /> });
  // Tables beside a conversation: the thread's tables, or one with `{ tableId }`.
  app.slots.threadPanelAction({
    id: TABLES_TAB,
    title: "Tables",
    icon: "Rows2",
    layout: "flush",
    component: ThreadTablesPanel,
  });
  // `::table{id="tbl_…"}` in a reply: a card that opens the table beside the chat.
  app.slots.messageDirective({ id: "table", component: TableCard });
});
