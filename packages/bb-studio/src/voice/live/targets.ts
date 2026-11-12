// Spoken names to threads: "the Bot", "the Larkspur lead", "launch review".
import type { VoiceTarget } from "./live";

export interface TargetCandidates {
  cos: { name: string; threadId: string | null } | null;
  /** Each project's lead thread. */
  leads: { project: string; threadId: string }[];
  /** Recent threads, newest first. */
  threads: { id: string; title: string }[];
}

const words = (text: string) => text.toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\b(the|my|our|a|an|thread|chat|please)\b/g, " ").replace(/\s+/g, " ").trim();
const COS = /^(bot|cos|chief of staff|chief|assistant)$/;

/** Every thread a spoken name could mean; one is a match, more means ask which. */
export function resolveTarget(name: string, candidates: TargetCandidates): VoiceTarget[] {
  const spoken = words(name);
  if (!spoken) return [];
  const { cos } = candidates;
  if (cos?.threadId && (COS.test(spoken) || spoken === words(cos.name))) return [{ threadId: cos.threadId, title: cos.name }];
  const lead = spoken.match(/^(.+?) (project )?lead$/)?.[1] ?? (spoken.startsWith("lead ") ? spoken.slice(5) : null);
  if (lead) {
    const leads = candidates.leads.filter((each) => words(each.project) === lead);
    const loose = leads.length ? leads : candidates.leads.filter((each) => words(each.project).includes(lead));
    return loose.map((each) => ({ threadId: each.threadId, title: `the ${each.project} lead` }));
  }
  const exact = candidates.threads.filter((thread) => words(thread.title) === spoken);
  if (exact.length) return exact.map((thread) => ({ threadId: thread.id, title: thread.title }));
  return candidates.threads.filter((thread) => words(thread.title).includes(spoken)).slice(0, 5).map((thread) => ({ threadId: thread.id, title: thread.title }));
}
