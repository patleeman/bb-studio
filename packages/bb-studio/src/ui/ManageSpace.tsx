// A space's dialogs, opened from anywhere by a window event, such as the
// Space's ⋯ menu in Studio Sidebar, since a plugin can't show another's
// dialogs. After a change, a second event says so.
import { useProjects } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { rpcContract, SpaceView } from "../contract";
import { SPACE_CHANGED_EVENT, SPACE_DIALOG_EVENT } from "../ids";
import { SpaceHeartbeatDialog } from "./SpaceHeartbeat";
import { AddThreadsDialog, DeleteSpaceDialog, SpaceDialog, SpaceProjectsDialog } from "./Spaces";

const DIALOGS = ["edit", "delete", "threads", "projects", "heartbeat"] as const;
type Dialog = (typeof DIALOGS)[number];

export function ManageSpace() {
  const rpc = useRpc<typeof rpcContract>();
  const projects = useProjects();
  const [open, setOpen] = useState<{ spaceId: string; dialog: Dialog } | null>(null);
  const [space, setSpace] = useState<SpaceView | null>(null);

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
              () => toast.success(`Deleted the space ${space.name}`),
              (cause: unknown) => toast.error(`Couldn't delete the space: ${errorMessage(cause)}`),
            );
          }}
        />
      );
    case "threads":
      return <AddThreadsDialog rpc={rpc} space={space} projects={projects} onClose={close} onChanged={changed} />;
    case "projects":
      return <SpaceProjectsDialog rpc={rpc} space={space} projects={projects} onClose={close} onChanged={changed} />;
    case "heartbeat":
      return <SpaceHeartbeatDialog space={space} onClose={close} />;
  }
}
