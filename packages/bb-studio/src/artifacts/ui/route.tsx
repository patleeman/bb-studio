// One artifact as a Studio page: /plugins/studio/studio/artifacts/<id>, in a
// workspace tab or the main view. Loaded on demand by app.tsx.
import { openAppPath, WORKSPACE_PATH } from "../../kit/app/index";
import { openCollection } from "../../ui/StudioPanel";
import { ArtifactViewer } from "./artifact-viewer";

export default function ArtifactRoute({ id }: { id: string }) {
  return (
    <ArtifactViewer
      key={id}
      artifactId={id}
      backLabel="Studio"
      onBack={(replace) => {
        openCollection("artifact");
        openAppPath(WORKSPACE_PATH, { replace });
      }}
    />
  );
}
