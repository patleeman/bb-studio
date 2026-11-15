import { useState } from "react";
import { errorMessage } from "../../kit/format";
import { useCall, type RpcInput } from "../../ui/live";

export function useTaskActions(refresh?: () => void) {
  const call = useCall();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const act = async (input: RpcInput<"tasks.act">) => {
    setBusy(true); setError(null); setNote(null);
    try { const out = await call("tasks.act", input); setNote(out.note); refresh?.(); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
    finally { setBusy(false); }
  };
  return { act, busy, error, note };
}
