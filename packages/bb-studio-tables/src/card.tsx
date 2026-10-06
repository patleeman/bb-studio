// `::table{id="tbl_…"}` in a reply: a card that opens the table in the
// thread's workbench, beside the chat.
import { useCallback, useEffect, useState } from "react";
import { ItemDirectiveCard } from "@bb-studio/kit/app";
import { relativeTime } from "@bb-studio/kit/format";
import { TABLES_CHANNEL, TABLES_PANEL } from "@bb-studio/kit/tables";
import { useBbNavigate, useRealtime, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import type { StudioItem, StudioSchemas } from "@bb-studio/kit/contract";

/** The workbench tab's action id; reply cards open it with `{ tableId }`. */
export const TABLES_TAB = "tables";

export const isTableId = (value: string) => /^tbl_[\w-]+$/.test(value);

/** The table's Studio item, kept current as it changes. Null once it's gone. */
function useTableItem(id: string): StudioItem | null | undefined {
  const rpc = useRpc<StudioSchemas["provider"]>();
  const [item, setItem] = useState<StudioItem | null | undefined>(undefined);
  const load = useCallback(() => {
    if (!id) return;
    rpc.call("studio_get", { ids: [id] }).then(
      ({ items }) => setItem(items[0] ?? null),
      () => setItem(null),
    );
  }, [rpc, id]);
  useEffect(load, [load]);
  useRealtime(TABLES_CHANNEL, (event) => {
    const changed = (event as { tableId?: string } | null)?.tableId;
    if (changed === id) load();
  });
  return item;
}

export function TableCard({ attributes }: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const id = attributes.id ?? "";
  const valid = isTableId(id);
  const item = useTableItem(valid ? id : "");
  if (!valid || item === null) return <ItemDirectiveCard state="deleted" kind="table" icon="Rows2" />;
  if (!item) return <ItemDirectiveCard state="loading" kind="table" icon="Rows2" />;
  const title = item.title.trim() || "Untitled table";
  return (
    <ItemDirectiveCard
      state="ready"
      kind="table"
      icon="Rows2"
      title={title}
      details={`Table · ${item.preview ?? ""} · ${relativeTime(item.updatedAt)}`}
      onOpen={() => {
        // The workbench when there is one; the main area otherwise.
        if (!navigate.openThreadPanel({ actionId: TABLES_TAB, title, params: { tableId: id } }))
          navigate.toPluginPanel(TABLES_PANEL, { subPath: id });
      }}
    />
  );
}
