export type UnsentAudioState = "error" | "checking" | "uploaded" | "items";

export function unsentAudioState(setAside: readonly unknown[] | null, error: string | null): UnsentAudioState {
  if (error) return "error";
  if (setAside === null) return "checking";
  return setAside.length ? "items" : "uploaded";
}
