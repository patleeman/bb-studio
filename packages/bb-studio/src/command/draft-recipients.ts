// Command's composer is BB's own, so the view can't read its draft. Studio
// keeps the latest draft of each Space's Command composer here, so "To" can
// name whoever the draft addresses before it's sent, including a draft BB
// restored before anyone focused the composer.
import { createElement, useEffect, useState } from "react";
import { useComposerView, type ComposerStructuredDraft } from "@get-bb/plugin-sdk/app";
import type { CommandThread } from "./command-contract";
import { typedAliases } from "./mentions";

const EVENT = "studio:command-draft";
const drafts = new Map<string, ComposerStructuredDraft>();

/** The Space of the Command composer an element is in, if any. */
export const commandComposerSpace = (element: Element | null | undefined) =>
  element?.closest("[data-command-composer]")?.getAttribute("data-command-space") || null;

function store(spaceId: string, draft: ComposerStructuredDraft) {
  drafts.set(spaceId, draft);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: spaceId }));
}

/**
 * For app.tsx's composer customization: BB's structured draft, with its
 * mentions. BB doesn't say which composer it came from, so only a draft typed
 * in a Command composer (it has focus) counts.
 */
export function publishCommandDraft(draft: ComposerStructuredDraft) {
  if (typeof document === "undefined") return;
  const spaceId = commandComposerSpace(document.activeElement);
  if (spaceId) store(spaceId, draft);
}

/**
 * Rendered inside a Space's Command composer (ComposerSpaces): follows the
 * draft's text whether or not the composer has focus, so a restored draft
 * addresses its threads as soon as the view opens. Pills keep the mentions
 * BB last reported while their labels are still in the text.
 */
export function CommandDraftWatch({ spaceId }: { spaceId: string }) {
  const text = useComposerView().draft?.text ?? "";
  useEffect(() => {
    const previous = drafts.get(spaceId);
    if (previous?.text === text) return;
    store(spaceId, { text, mentions: (previous?.mentions ?? []).filter(mention => text.includes(mention.label)) });
  }, [spaceId, text]);
  return createElement("span", { hidden: true });
}

/** The latest draft of a Space's Command composer. */
export function useCommandDraft(spaceId: string): ComposerStructuredDraft | null {
  const [draft, setDraft] = useState<ComposerStructuredDraft | null>(() => drafts.get(spaceId) ?? null);
  useEffect(() => {
    setDraft(drafts.get(spaceId) ?? null);
    const onDraft = (event: Event) => { if ((event as CustomEvent<string>).detail === spaceId) setDraft(drafts.get(spaceId) ?? null); };
    window.addEventListener(EVENT, onDraft);
    return () => window.removeEventListener(EVENT, onDraft);
  }, [spaceId]);
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
