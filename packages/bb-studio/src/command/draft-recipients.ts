// Command's composer is BB's own, so the view can't read its draft. Studio
// watches every new-thread composer's draft (app.tsx) and passes the Command
// composer's on, so "To" can name whoever the draft addresses before it's sent.
import { useEffect, useState } from "react";
import type { ComposerStructuredDraft } from "@get-bb/plugin-sdk/app";
import type { CommandThread } from "./command-contract";
import { typedAliases } from "./mentions";

const EVENT = "studio:command-draft";

/** For app.tsx's composer customization: only the draft being typed in Command's composer. */
export function publishCommandDraft(draft: ComposerStructuredDraft) {
  if (typeof document === "undefined" || !document.activeElement?.closest("[data-command-composer]")) return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: draft }));
}

/** The latest Command composer draft. */
export function useCommandDraft(): ComposerStructuredDraft | null {
  const [draft, setDraft] = useState<ComposerStructuredDraft | null>(null);
  useEffect(() => {
    const onDraft = (event: Event) => setDraft((event as CustomEvent<ComposerStructuredDraft>).detail);
    window.addEventListener(EVENT, onDraft);
    return () => window.removeEventListener(EVENT, onDraft);
  }, []);
  return draft;
}

/** Who a draft addresses: everyone, the threads it mentions by pill or @alias, or nobody yet. */
export function draftRecipients(draft: ComposerStructuredDraft | null, threads: readonly CommandThread[]): "everyone" | string[] {
  if (!draft) return [];
  const all = /(^|[^a-zA-Z0-9_.-])@(all|everyone)(?![a-zA-Z0-9_.-])/i;
  if (all.test(draft.text) || draft.mentions.some(mention => /broadcasts/.test(mention.provider + mention.id) || all.test(mention.label))) return "everyone";
  const ids = new Set<string>();
  for (const mention of draft.mentions) {
    // A picked "This Space" item is space-threads:<id>; BB's own thread mentions use the id.
    const id = mention.id.split(":").at(-1)!;
    if (threads.some(thread => thread.id === id)) ids.add(id);
  }
  for (const alias of typedAliases(draft.text)) {
    const named = threads.find(thread => thread.alias === alias);
    if (named) ids.add(named.id);
  }
  return [...ids];
}
