// One mini app as a Studio page: /plugins/studio/studio/minis/<id>, in a
// workspace tab or the main view. Loaded on demand by app.tsx.
import { openAppPath, WORKSPACE_PATH } from "../../kit/app/index";
import { openCollection } from "../../ui/StudioPanel";
import { MiniPage } from "./mini-view";

export default function MiniRoute({ id }: { id: string }) {
  return (
    <MiniPage
      key={id}
      miniId={id}
      backLabel="Studio"
      onBack={(replace) => {
        openCollection("mini");
        openAppPath(WORKSPACE_PATH, { replace });
      }}
    />
  );
}
