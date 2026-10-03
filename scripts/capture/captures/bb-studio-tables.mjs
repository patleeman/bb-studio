export default ({ projectId, pluginRpc, sleep }) => [{
  id: "studio-tables", packageDir: "bb-studio/src/modules/tables", privateSidebar: true,
  setup: async (client) => {
    const { table } = await pluginRpc("studio", "tables_create", { title: "QA Inventory", projectId, columns: [
      { id: "name", name: "Name", type: "text", options: [] },
      { id: "status", name: "Status", type: "select", options: ["Ready", "In review"] },
      { id: "quantity", name: "Quantity", type: "number", options: [] },
      { id: "checked", name: "Checked", type: "checkbox", options: [] },
    ] });
    const cleanup = async () => { await pluginRpc("studio", "tables_remove", { id: table.id }).catch(() => {}); };
    try {
      for (const values of [
        { name: "Sample kits", status: "Ready", quantity: 24, checked: true },
        { name: "Review notes", status: "In review", quantity: 8, checked: false },
      ]) await pluginRpc("studio", "tables_insert", { id: table.id, values });
      await client.navigate(`/plugins/studio/tables/${table.id}`);
      await client.waitForInputValue("Table title", "QA Inventory");
      // Text cells render as text until you edit them; the seeded row shows in the grid.
      await client.waitForSelector('[role="checkbox"][aria-label="Checked"][aria-checked="true"]');
      await client.waitForText("Sample kits");
      await client.waitForText("Review notes");
      await client.waitForText("Quantity");
      await client.waitForText("New row");
      const result = await pluginRpc("studio", "tables_get", { id: table.id });
      if (result.table?.rows.length !== 2) throw new Error("Seeded rows are missing");
      await sleep(700);
    } catch (error) { await cleanup(); throw error; }
    return cleanup;
  },
}];
