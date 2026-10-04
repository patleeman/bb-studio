// A space's dialogs, opened from anywhere by a window event: its page's
// widgets in Pages ask for them, since a plugin can't show another's dialogs.
// After a change, a second event tells the page to refetch.
import { openAppPath, useProjects, type CollectionItem, type CollectionKind } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { rpcContract, SpaceView } from "../contract";
import { SPACE_CHANGED_EVENT, SPACE_DIALOG_EVENT } from "../ids";
import { AddItemsDialog, AddThreadsDialog, DeleteSpaceDialog, SpaceDialog, SpaceProjectsDialog } from "./Spaces";

const DIALOGS = ["edit", "delete", "items", "threads", "channels", "projects"] as const;
type Dialog = (typeof DIALOGS)[number];

export function ManageSpace() {
  const rpc = useRpc<typeof rpcContract>();
  const context = useBbContext();
  const projects = useProjects();
  const [open, setOpen] = useState<{ spaceId: string; dialog: Dialog } | null>(null);
  const [space, setSpace] = useState<SpaceView | null>(null);
  const [catalog, setCatalog] = useState<{ items: CollectionItem[]; kinds: CollectionKind[] } | null>(null);

  const load = useCallback(
    (spaceId: string) => rpc.call("spaces", null).then(({ spaces }) => setSpace(spaces.find((each) => each.id === spaceId) ?? null), () => setSpace(null)),
    [rpc],
  );
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: unknown; dialog?: unknown }>).detail;
      if (typeof detail?.spaceId !== "string" || !DIALOGS.includes(detail.dialog as Dialog)) return;
      event.preventDefault();
      setSpace(null);
      setOpen({ spaceId: detail.spaceId, dialog: detail.dialog as Dialog });
      void load(detail.spaceId);
    };
    window.addEventListener(SPACE_DIALOG_EVENT, show);
    return () => window.removeEventListener(SPACE_DIALOG_EVENT, show);
  }, [load]);
  // Adding items picks from every item, so only that dialog lists them.
  useEffect(() => {
    if (open?.dialog !== "items") return;
    rpc.call("overview", null).then(
      ({ items, providers }) =>
        setCatalog({
          items: items.filter((item) => !item.archived),
          kinds: providers.filter((provider) => provider.state === "ready").flatMap((provider) => provider.kinds.map((kind) => ({ ...kind, pluginId: provider.pluginId }))),
        }),
      () => setCatalog({ items: [], kinds: [] }),
    );
  }, [rpc, open?.dialog]);

  if (!open || !space) return null;
  const close = () => setOpen(null);
  const changed = () => {
    void load(space.id);
    window.dispatchEvent(new CustomEvent(SPACE_CHANGED_EVENT, { detail: { spaceId: space.id } }));
  };
  switch (open.dialog) {
    case "edit":
      return (
        <SpaceDialog
          rpc={rpc}
          space={space}
          projects={projects}
          defaultProjectId={context.projectId ?? null}
          onClose={close}
          onSaved={() => {
            close();
            changed();
          }}
          onDelete={() => setOpen({ spaceId: space.id, dialog: "delete" })}
        />
      );
    case "delete":
      return (
        <DeleteSpaceDialog
          space={space}
          onClose={close}
          onConfirm={() => {
            close();
            rpc.call("deleteSpace", { id: space.id }).then(
              () => {
                toast.success(`Deleted the space ${space.name}`);
                openAppPath("/plugins/studio/studio");
              },
              (cause: unknown) => toast.error(`Couldn't delete the space: ${errorMessage(cause)}`),
            );
          }}
        />
      );
    case "items":
      return catalog ? <AddItemsDialog rpc={rpc} space={space} items={catalog.items} kinds={catalog.kinds} projects={projects} onClose={close} onChanged={changed} /> : null;
    case "threads":
    case "channels":
      return <AddThreadsDialog rpc={rpc} space={space} kind={open.dialog === "threads" ? "threads" : "conversations"} projects={projects} onClose={close} onChanged={changed} />;
    case "projects":
      return <SpaceProjectsDialog rpc={rpc} space={space} projects={projects} onClose={close} onChanged={changed} />;
  }
}
