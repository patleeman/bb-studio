// One drawing as a Studio page: /plugins/studio/studio/drawings/<id>, in a
// workspace tab or the main view. A drawing is a whiteboard in a page, and
// this is its full editor, so Back returns to that page. Loaded on demand by
// app.tsx: it brings Excalidraw.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { openAppPath, WORKSPACE_PATH } from "../../kit/app/index";
import { openCollection } from "../../ui/StudioPanel";
import type { rpcContract } from "../contract";
import { DrawingEditor } from "./drawing-editor";

export default function DrawingRoute({ id }: { id: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [page, setPage] = useState<{ title: string; href: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPage(null);
    // A drawing in no page goes back to the library, as before.
    rpc.call("drawings.whiteboardPage", { id }).then(({ page }) => { if (!cancelled) setPage(page); }, () => {});
    return () => { cancelled = true; };
  }, [rpc, id]);
  return (
    <DrawingEditor
      key={id}
      drawingId={id}
      backLabel={page?.title ?? "Studio"}
      onBack={(replace) => {
        if (page) return openAppPath(page.href, { replace });
        openCollection("drawing");
        openAppPath(WORKSPACE_PATH, { replace });
      }}
    />
  );
}
