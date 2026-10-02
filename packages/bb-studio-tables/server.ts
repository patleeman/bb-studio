import { studioSchemas, type StudioItem, type StudioKind } from "@bb-studio/kit/contract";
import { parseFlags, subcommand } from "@bb-studio/kit/cli";
import { createChangeBus, createStoreProvider, defineItemMention, studioIndex, studioServices } from "@bb-studio/kit/server";
import {
  columnSchema,
  csv,
  filterSchema,
  markdown,
  queryRows,
  sortSchema,
  TABLES_CHANNEL,
  TABLES_PANEL,
  TABLES_PLUGIN_ID,
  tableHref,
  tablesContract,
  valuesSchema,
  type Filter,
  type Sort,
  type Table,
  type View,
} from "@bb-studio/kit/tables";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MIGRATIONS, TableStore } from "./src/store";

const id = z.string().min(1).max(100);

const KIND: StudioKind = {
  id: "table",
  label: "Table",
  plural: "Tables",
  icon: "Rows2",
  columns: [{ id: "rows", label: "Rows" }],
  actions: [],
  create: { mode: "rpc" },
  canArchive: true,
  capabilities: {
    create: true,
    move: true,
    archive: true,
    delete: true,
    rename: true,
    duplicate: false,
    export: true,
    comments: false,
    versions: false,
    links: false,
  },
  mentionProviderId: "table",
  blurb: "Structured data for you and your agents.",
  agentHint:
    "Use tables_schema to inspect columns and tables_query to read rows.",
};
function item(table: Table): StudioItem {
  return {
    id: table.id,
    kind: "table",
    title: table.title,
    icon: null,
    projectId: table.projectId,
    parentId: null,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
    updatedBy: null,
    preview: `${table.rows.length} rows · ${table.columns.length} columns`,
    facts: [
      { id: "rows", value: String(table.rows.length), sort: table.rows.length },
    ],
    badge: null,
    thumbnailUrl: null,
    href: tableHref({ tableId: table.id }),
    archived: table.archived,
  };
}
export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new TableStore(db);
  const studio = studioSchemas(z);
  const changes = createChangeBus({
    bb,
    channel: TABLES_CHANNEL,
    pluginId: TABLES_PLUGIN_ID,
    schemas: studio,
    event: (tableId) => ({ tableId }),
  });
  const changed = (tableId: string) => changes.changed(tableId);
  const services = studioServices(bb.sdk);
  /** Tells Studio an agent made a table, so it joins the thread's spaces. */
  const created = (tableId: string, threadId: string) => void services.created({ pluginId: TABLES_PLUGIN_ID, id: tableId }, threadId).catch(() => { /* Studio is optional. */ });
  const index = studioIndex(bb.sdk, studio);
  const query = (table: Table, viewId?: string, filters?: Filter[], sorts?: Sort[]) => {
    const view: View | undefined = viewId ? table.views.find((item) => item.id === viewId) : undefined;
    if (viewId && !view) throw new Error("View not found.");
    return queryRows(table, view, filters ?? view?.filters, sorts ?? view?.sorts);
  };
  const importCsv = (tableId: string, source: string) => {
    const imported = store.importCsv(tableId, source);
    if (imported) changed(tableId);
    return imported;
  };
  bb.rpc.register(tablesContract, {
    list: () => ({ tables: store.list() }),
    get: ({ id }) => ({ table: store.get(id) }),
    create: ({ title, projectId, columns, rows }) => {
      const table = store.create(title, projectId ?? null, columns, rows);
      changed(table.id);
      return { table };
    },
    update: ({ id, ...changes }) => {
      const table = store.update(id, changes);
      changed(id);
      return { table };
    },
    remove: ({ id }) => {
      store.delete(id);
      changed(id);
      return { ok: true };
    },
    insert: ({ id, values }) => {
      const row = store.insert(id, values);
      changed(id);
      return { row };
    },
    updateRow: ({ id, rowId, values }) => {
      const row = store.updateRow(id, rowId, values);
      changed(id);
      return { row };
    },
    deleteRow: ({ id, rowId }) => {
      store.deleteRow(id, rowId);
      changed(id);
      return { ok: true };
    },
    patchRows: ({ id, ...patch }) => {
      const { table } = store.patchRows(id, patch);
      changed(id);
      return { table };
    },
    query: ({ id, viewId, filters, sorts, limit }) => {
      const rows = query(store.require(id), viewId, filters, sorts);
      return { rows: rows.slice(0, limit), total: rows.length };
    },
    exportCsv: ({ id, viewId }) => {
      const table = store.require(id);
      return { csv: csv(table, query(table, viewId)) };
    },
    importCsv: ({ id, csv }) => ({ imported: importCsv(id, csv) }),
    items: async () => ({
      items: (await index.items()).map((item) => ({
        pluginId: item.pluginId,
        itemId: item.id,
        title: item.title,
        kindLabel: item.kindLabel,
        kindIcon: item.kindIcon,
        icon: item.icon,
        href: item.href,
      })),
    }),
  });
  createStoreProvider(
    bb,
    studio,
    {
      studio_describe: () => ({
        pluginId: TABLES_PLUGIN_ID,
        version: 2,
        panel: TABLES_PANEL,
        kinds: [KIND],
      }),
      studio_get: ({ ids }) => ({
        items: ids.flatMap((id) => {
          const table = store.get(id);
          return table ? [item(table)] : [];
        }),
      }),
      studio_read: ({ id }) => {
        const table = store.get(id);
        return {
          content: table ? markdown(table, table.rows.slice(0, 200)) : null,
        };
      },
      studio_list: () => ({ items: store.list().map(item) }),
      studio_create: ({ kind, projectId }) => {
        if (kind !== "table") throw new Error("Unknown kind.");
        const table = store.create("Untitled table", projectId);
        changed(table.id);
        return { item: item(table) };
      },
      studio_action: () => ({
        message: "No table actions available.",
        text: null,
      }),
    },
    {
      move: (id, projectId) => {
        store.update(id, { projectId });
        changed(id);
      },
      archive: (id, archived) => {
        store.update(id, { archived });
        changed(id);
      },
      delete: (id) => {
        store.delete(id);
        changed(id);
      },
    },
    {
      find: (needle) =>
        store
          .list()
          .filter((table) =>
            `${table.title} ${markdown(table)}`
              .toLowerCase()
              .includes(needle.toLowerCase()),
          )
          .slice(0, 200),
      text: (table) => markdown(table),
    },
  );
  bb.ui.registerMentionProvider(
    defineItemMention({
      id: "table",
      label: "Tables",
      search: ({ query }) =>
        store
          .list()
          .filter(
            (table) =>
              !table.archived &&
              table.title.toLowerCase().includes(query.toLowerCase()),
          )
          .map((table) => ({
            id: table.id,
            title: table.title,
            subtitle: `${table.rows.length} rows`,
          })),
      resolve: (tableId) => ({
        context: markdown(
          store.require(tableId),
          store.require(tableId).rows.slice(0, 200),
        ),
      }),
    }),
  );
  bb.agents.registerTool({
    name: "tables_list",
    description: "List Studio Tables and their IDs.",
    parameters: z.object({}),
    execute: () =>
      store
        .list()
        .filter((table) => !table.archived)
        .map(
          (table) => `${table.id}\t${table.title}\t${table.rows.length} rows`,
        )
        .join("\n") || "No tables.",
  });
  bb.agents.registerTool({
    name: "tables_schema",
    description:
      "Read a table's columns and views before querying or editing rows.",
    parameters: z.object({ id }),
    execute: ({ id }) => {
      const { title, columns, views } = store.require(id);
      return JSON.stringify({ title, columns, views });
    },
  });
  bb.agents.registerTool({
    name: "tables_query",
    description:
      "Query table rows with optional filters and sorts. Returns up to 100 rows.",
    parameters: z.object({
      id,
      viewId: id.optional(),
      filters: z.array(filterSchema).optional(),
      sorts: z.array(sortSchema).optional(),
    }),
    execute: ({ id, viewId, filters, sorts }) =>
      JSON.stringify(
        query(store.require(id), viewId, filters, sorts).slice(0, 100),
      ),
  });
  bb.agents.registerTool({
    name: "tables_create",
    description:
      "Create a table with typed columns and starting rows. Rows are values by column ID; select options are added from the rows.",
    parameters: z.object({
      title: z.string().trim().min(1).max(200),
      columns: z.array(columnSchema).min(1),
      rows: z.array(valuesSchema).max(1000).optional(),
    }),
    execute: ({ title, columns, rows }, ctx) => {
      const table = store.create(title, ctx.projectId ?? null, columns, rows);
      changed(table.id);
      created(table.id, ctx.threadId);
      return JSON.stringify({ id: table.id, href: tableHref({ tableId: table.id }), rows: table.rows.length });
    },
  });
  bb.agents.registerTool({
    name: "tables_insert",
    description:
      "Insert a row. Read tables_schema first for typed column IDs and options.",
    parameters: z.object({ id, values: valuesSchema }),
    execute: ({ id, values }) => {
      const row = store.insert(id, values);
      changed(id);
      return JSON.stringify(row);
    },
  });
  bb.agents.registerTool({
    name: "tables_update",
    description: "Update cells in a table row by row ID.",
    parameters: z.object({ id, rowId: id, values: valuesSchema }),
    execute: ({ id, rowId, values }) => {
      const row = store.updateRow(id, rowId, values);
      changed(id);
      return JSON.stringify(row);
    },
  });
  bb.agents.configure(() => ({
    tools: [
      "tables_list",
      "tables_create",
      "tables_schema",
      "tables_query",
      "tables_insert",
      "tables_update",
    ],
    skills: [],
  }));
  bb.cli.register({
    name: "tables",
    summary: "Create and query Studio Tables",
    commands: [
      { name: "list", summary: "List tables", usage: "bb tables list" },
      {
        name: "create",
        summary: "Create a table",
        usage: "bb tables create <title>",
      },
      {
        name: "schema",
        summary: "Show columns and views",
        usage: "bb tables schema <id>",
      },
      {
        name: "query",
        summary: "Query rows",
        usage: "bb tables query <id> [--view <id>]",
      },
      {
        name: "insert",
        summary: "Insert JSON values",
        usage: "bb tables insert <id> <json>",
      },
      {
        name: "update",
        summary: "Update JSON values",
        usage: "bb tables update <id> <row-id> <json>",
      },
      { name: "export", summary: "Export CSV", usage: "bb tables export <id>" },
      {
        name: "import",
        summary: "Import CSV from stdin",
        usage: "bb tables import <id> --csv <text>",
      },
    ],
    run: (argv, ctx) => {
      const { command, rest } = subcommand(argv);
      const flags = parseFlags(rest);
      const [tableId, rowId, raw] = flags.positional;
      try {
        let output: unknown;
        switch (command) {
          case "list":
            output = store
              .list()
              .map(
                (table) =>
                  `${table.id}\t${table.title}\t${table.rows.length} rows`,
              )
              .join("\n");
            break;
          case "create": {
            const table = store.create(
              flags.positional.join(" "),
              ctx.projectId ?? null,
            );
            changed(table.id);
            if (ctx.threadId) created(table.id, ctx.threadId);
            output = `${table.id}\t${table.title}`;
            break;
          }
          case "schema":
            output = {
              columns: store.require(tableId!).columns,
              views: store.require(tableId!).views,
            };
            break;
          case "query":
            output = query(store.require(tableId!), flags.values.view).slice(
              0,
              100,
            );
            break;
          case "insert": {
            const row = store.insert(
              tableId!,
              valuesSchema.parse(JSON.parse(rowId!)),
            );
            changed(tableId!);
            output = row;
            break;
          }
          case "update": {
            const row = store.updateRow(
              tableId!,
              rowId!,
              valuesSchema.parse(JSON.parse(raw!)),
            );
            changed(tableId!);
            output = row;
            break;
          }
          case "export": {
            const table = store.require(tableId!);
            output = csv(table);
            break;
          }
          case "import":
            output = { imported: importCsv(tableId!, flags.values.csv ?? "") };
            break;
          default:
            return {
              exitCode: 1,
              stderr:
                "usage: bb tables <list|create|schema|query|insert|update|export|import>\n",
            };
        }
        return {
          exitCode: 0,
          stdout:
            typeof output === "string"
              ? `${output}\n`
              : `${JSON.stringify(output, null, 2)}\n`,
        };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `${error instanceof Error ? error.message : String(error)}\n`,
        };
      }
    },
  });
  return () => changes.dispose();
}
