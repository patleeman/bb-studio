// Makes a space from anywhere Studio's New offers one (the collection, Studio
// search), then opens its page. Spaces are Studio items; their open pages
// show as tabs in the sidebar's Studio section.
import { openAppPath, useProjects } from "@bb-studio/kit/app";
import { useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { rpcContract } from "../contract";
import { NEW_SPACE_EVENT } from "../ids";
import { SpaceDialog, spaceLink } from "./Spaces";

export function NewSpace() {
  const rpc = useRpc<typeof rpcContract>();
  const context = useBbContext();
  const projects = useProjects();
  const [making, setMaking] = useState(false);
  useEffect(() => {
    const open = (event: Event) => {
      event.preventDefault();
      setMaking(true);
    };
    window.addEventListener(NEW_SPACE_EVENT, open);
    return () => window.removeEventListener(NEW_SPACE_EVENT, open);
  }, []);
  if (!making) return null;
  return (
    <SpaceDialog
      rpc={rpc}
      space={null}
      projects={projects}
      defaultProjectId={context.projectId ?? null}
      onClose={() => setMaking(false)}
      onSaved={(saved) => {
        setMaking(false);
        openAppPath(spaceLink(saved));
      }}
    />
  );
}
