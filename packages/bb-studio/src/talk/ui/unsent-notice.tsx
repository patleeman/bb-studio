// Points at audio this device kept because the server refused it. Studio's
// library shows it when filtered to recordings (Talk's own Recordings page
// did before Talk was built into Studio), and a recording's page shows it
// for that recording.
import { OUTLINE_BUTTON, useOpenMain } from "@bb-studio/kit/app";
import { Icon, cn } from "@bb-studio/kit/ui";
import { RECORDINGS_ROOT, UNSENT_PATH } from "../shared/format";
import { useTalkState } from "./controller";

export function UnsentNotice({ recordingId, className }: { recordingId?: string; className?: string }) {
  const setAside = useTalkState().setAside ?? [];
  const open = useOpenMain();
  const count = setAside.filter((segment) => !recordingId || segment.recordingId === recordingId).length;
  if (count === 0) return null;
  const what = count === 1 ? "A piece of audio" : `${count} pieces of audio`;
  return (
    <div data-talk-unsent-notice className={cn("flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm max-md:flex-wrap", className)}>
      <Icon name="CloudOff" className="size-4 shrink-0 text-amber-600" />
      <span className="min-w-0 flex-1">
        {what}
        {recordingId ? " from this recording" : ""} couldn't be uploaded and {count === 1 ? "is" : "are"} kept on this device.
      </span>
      <button type="button" className={OUTLINE_BUTTON} onClick={() => open({ kind: "path", path: `${RECORDINGS_ROOT}/${UNSENT_PATH}` })}>
        Review
      </button>
    </div>
  );
}
