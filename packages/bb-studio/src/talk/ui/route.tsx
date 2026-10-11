// One recording as a Studio page: /plugins/studio/studio/recordings/<id>, in a
// workspace tab or the main view, and the unsent-audio page at
// recordings/unsent. Loaded on demand by app.tsx.
import { UNSENT_PATH } from "../shared/format";
import { RecordingDetail, UnsentAudio } from "./recordings-panel";

export default function RecordingRoute({ id }: { id: string }) {
  return id === UNSENT_PATH ? <UnsentAudio /> : <RecordingDetail key={id} id={id} />;
}
