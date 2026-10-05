// Makes a space from anywhere that offers New Space (the Spaces sidebar
// section, or Studio Sidebar by NEW_SPACE_EVENT). Nothing is preselected: a
// new space gets its own folder unless the user picks a project to move in.
import { useProjects } from "@bb-studio/kit/app";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { rpcContract } from "../contract";
import { NEW_SPACE_EVENT } from "../ids";
import { SpaceDialog } from "./Spaces";

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
      onSaved={() => setMaking(false)}
    />
  );
}
