import { useEffect, useMemo, useRef, useState } from "react";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { AddOnCollection, BAR_BUTTON, BarTitle, ICON_BUTTON, Icon, ItemHeader, ItemMenu, openAppPath, ThreadItemsPanel, useAddOnPanel } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { TABLES_CHANNEL, TABLES_PANEL, TABLES_PLUGIN_ID, parseTableSubPath, tableHref, tableSubPath, type TableTarget, type TablesContract } from "@bb-studio/kit/tables";
import { TableView, type TableApi, type TableHost, type TableItem } from "@bb-studio/kit/table-grid";
import { toast } from "sonner";
import { loadTable, type TableLoad } from "./load-table";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Editor({ target, onTargetChange, backLabel, onBack, compact = false }: {
  target: TableTarget;
  /** The view or row the grid moved to. */
  onTargetChange(target: TableTarget): void;
  backLabel: string;
  onBack(): void;
  /** A thread's narrow side panel: icon buttons, and no New thread. */
  compact?: boolean;
}) {
  const rpc = useRpc<TablesContract>();
  const { tableId } = target;
  const [{ table, error }, setLoad] = useState<TableLoad>({ table: null, error: "" });
  const [items, setItems] = useState<TableItem[]>([]);
  const [version, setVersion] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  useRealtime(TABLES_CHANNEL, (event) => {
    const changed = (event as { tableId?: string } | null)?.tableId;
    if (!changed || changed === tableId) setVersion((n) => n + 1);
  });
  useEffect(() => loadTable(() => rpc.call("get", { id: tableId }), setLoad), [rpc, tableId, version]);
  useEffect(() => {
    void rpc.call("items", null).then(({ items }) => setItems(items), () => undefined);
  }, [rpc]);

  const api = useMemo<TableApi>(
    () => ({
      update: (meta) => rpc.call("update", { id: tableId, ...meta }),
      patchRows: (patch) => rpc.call("patchRows", { id: tableId, ...patch }),
    }),
    [rpc, tableId],
  );
  const go = (next: Partial<TableTarget>) => onTargetChange({ ...target, ...next });
  const host = useMemo<TableHost>(
    () => ({
      openUrl: (url) => window.open(url, "_blank", "noopener"),
      openItem: (relation) => {
        const href = items.find((item) => item.pluginId === relation.pluginId && item.itemId === relation.itemId)?.href;
        if (href) openAppPath(href);
      },
      items,
      copyLink: ({ viewId, rowId }) =>
        void navigator.clipboard.writeText(new URL(tableHref({ tableId, viewId, rowId }), window.location.origin).href).then(
          () => toast.success(rowId ? "Copied a link to the row." : viewId ? "Copied a link to the view." : "Copied a link to the table."),
          (error) => toast.error(errorMessage(error)),
        ),
      onError: (error) => toast.error(errorMessage(error)),
    }),
    [items, tableId],
  );

  const importCsv = async (source: File) => {
    try {
      const { imported } = await rpc.call("importCsv", { id: tableId, csv: await source.text() });
      toast.success(imported === 1 ? "Imported 1 row." : `Imported ${imported} rows.`);
      setVersion((n) => n + 1);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const exportCsv = async () => {
    try {
      const { csv } = await rpc.call("exportCsv", { id: tableId, ...(target.viewId ? { viewId: target.viewId } : {}) });
      download(`${table?.title ?? "Table"}.csv`, csv);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const rename = (title: string) =>
    void rpc.call("update", { id: tableId, title }).then(
      () => setVersion((n) => n + 1),
      (error) => toast.error(errorMessage(error)),
    );

  if (error || !table)
    return (
      <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
        <ItemHeader backLabel={backLabel} onBack={() => onBack()} />
        <div className="space-y-3 p-6">
          <p role={error ? "alert" : "status"} className={`text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>
            {error || "Loading table…"}
          </p>
          {error && (
            <button
              type="button"
              className={BAR_BUTTON}
              onClick={() => {
                setLoad({ table: null, error: "" });
                setVersion((n) => n + 1);
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
      <ItemHeader
        backLabel={backLabel}
        onBack={() => onBack()}
        leading={
          <BarTitle title={table.title} label="Table title" placeholder="Untitled table" onRename={(title) => { if (title) rename(title); }} />
        }
        thread={compact ? undefined : { title: table.title, href: tableHref({ tableId }) }}
        trailing={
          <>
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(event) => {
                const picked = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (picked) void importCsv(picked);
              }}
            />
            <button type="button" className={ICON_BUTTON} title="Import CSV: add rows, matching its headers to columns" aria-label="Import CSV" onClick={() => file.current?.click()}>
              <Icon name="PackageReceive" className="size-4" />
            </button>
            <button type="button" className={ICON_BUTTON} title="Export this view as CSV" aria-label="Export CSV" onClick={() => void exportCsv()}>
              <Icon name="Download" className="size-4" />
            </button>
            <ItemMenu reference={{ title: table.title, href: tableHref({ tableId }) }} />
          </>
        }
      />
      <TableView
        className="min-h-0 flex-1"
        table={table}
        api={api}
        host={host}
        viewId={target.viewId}
        onViewChange={(viewId) => go({ viewId, rowId: null })}
        rowId={target.rowId}
        onRowChange={(rowId) => go({ rowId })}
      />
    </div>
  );
}

export function TablesPanel({ subPath }: { subPath: string }) {
  const { call, refreshKey, studio, toCollection } = useAddOnPanel(TABLES_CHANNEL, TABLES_PANEL, "table");
  const navigate = useBbNavigate();
  const target = parseTableSubPath(subPath);
  if (target)
    return (
      <Editor
        key={target.tableId}
        target={target}
        onTargetChange={(next) => navigate.toPluginPanel(TABLES_PANEL, { subPath: tableSubPath(next), replace: true })}
        backLabel={studio ? "Studio" : "Tables"}
        onBack={toCollection}
      />
    );
  return <AddOnCollection pluginId={TABLES_PLUGIN_ID} title="Tables" kind="table" call={call} refreshKey={refreshKey} />;
}

/** Tables in a thread's side panel: the thread's tables and recent ones, and the grid. */
export function ThreadTablesPanel({ threadId }: { threadId: string }) {
  return (
    <ThreadItemsPanel
      threadId={threadId}
      pluginId={TABLES_PLUGIN_ID}
      kind="table"
      channel={TABLES_CHANNEL}
      renderItem={(id, { backLabel, onBack }) => <ThreadTable key={id} tableId={id} backLabel={backLabel} onBack={onBack} />}
    />
  );
}

function ThreadTable({ tableId, backLabel, onBack }: { tableId: string; backLabel: string; onBack(): void }) {
  const [target, setTarget] = useState<TableTarget>({ tableId });
  return <Editor target={target} onTargetChange={setTarget} backLabel={backLabel} onBack={onBack} compact />;
}
