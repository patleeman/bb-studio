// One design as a Studio page: /plugins/studio/studio/designs/<id>, in a
// workspace tab or the main view. Loaded on demand by app.tsx.
import { openAppPath, WORKSPACE_PATH } from "../../kit/app/index";
import { openCollection } from "../../ui/StudioPanel";
import { DesignPage } from "./design-view";

export default function DesignRoute({ id }: { id: string }) {
  return (
    <DesignPage
      key={id}
      designId={id}
      backLabel="Studio"
      onBack={(replace) => {
        openCollection("design");
        openAppPath(WORKSPACE_PATH, { replace });
      }}
    />
  );
}
