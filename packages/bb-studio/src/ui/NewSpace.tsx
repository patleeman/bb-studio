// Makes a space from anywhere that offers New Space (the Spaces sidebar
// section, the Spaces panel), then opens it. Nothing is preselected: a new
// space gets its own folder unless the user picks a project to move in.
import { openAppPath, useProjects } from "@bb-studio/kit/app";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { rpcContract } from "../contract";
import { NEW_SPACE_EVENT } from "../ids";
import { SpaceDialog, spaceLink } from "./Spaces";

export function NewSpace() {
  const rpc = useRpc<typeof rpcContract>();
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
      onClose={() => setMaking(false)}
      onSaved={(saved) => {
        setMaking(false);
        openAppPath(spaceLink(saved));
      }}
    />
  );
}
