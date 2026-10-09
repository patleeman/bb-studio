// Command's composer is BB's own, so the view can't read its draft. Studio
// keeps the latest draft of each Space's Command composer here, so "To" can
// name whoever the draft addresses before it's sent, including a draft BB
// restored before anyone focused the composer.
import { createElement, useEffect, useState } from "react";
import { useComposer, type ComposerMention } from "@get-bb/plugin-sdk/app";
import type { CommandThread } from "./command-contract";
import { typedAliases } from "./mentions";

/** A Command composer's draft: its text and the pills in it. */
export interface CommandDraft {
  text: string;
  mentions: readonly { provider: string; id: string; label: string }[];
}

const EVENT = "studio:command-draft";
const drafts = new Map<string, CommandDraft>();

/** The Space of the Command composer an element is in, if any. */
export const commandComposerSpace = (element: Element | null | undefined) =>
  element?.closest("[data-command-composer]")?.getAttribute("data-command-space") || null;

function store(spaceId: string, draft: CommandDraft) {
  drafts.set(spaceId, draft);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: spaceId }));
}

/** BB's thread and plugin pills; the rest can't address a thread. */
function pill(mention: ComposerMention): CommandDraft["mentions"][number] | null {
  if (mention.kind === "thread") return { provider: "thread", id: mention.threadId, label: mention.label };
  if (mention.kind === "plugin") return { provider: mention.provider, id: mention.id, label: mention.label };
  return null;
}

/**
 * Rendered inside a Space's Command composer (ComposerSpaces): follows the
 * draft whether or not the composer has focus, so a restored draft addresses
 * its threads as soon as the view opens.
 */
export function CommandDraftWatch({ spaceId }: { spaceId: string }) {
  const draft = useComposer().draft;
  const text = draft.text;
  const mentions = draft.mentions.map(pill).filter(mention => mention !== null);
  const key = JSON.stringify(mentions);
  useEffect(() => {
    const previous = drafts.get(spaceId);
    if (previous?.text === text && JSON.stringify(previous.mentions) === key) return;
    store(spaceId, { text, mentions });
    // `key` stands for `mentions`, which is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, text, key]);
  return createElement("span", { hidden: true });
}

/** The latest draft of a Space's Command composer. */
export function useCommandDraft(spaceId: string): CommandDraft | null {
  const [draft, setDraft] = useState<CommandDraft | null>(() => drafts.get(spaceId) ?? null);
  useEffect(() => {
    setDraft(drafts.get(spaceId) ?? null);
    const onDraft = (event: Event) => { if ((event as CustomEvent<string>).detail === spaceId) setDraft(drafts.get(spaceId) ?? null); };
    window.addEventListener(EVENT, onDraft);
    return () => window.removeEventListener(EVENT, onDraft);
  }, [spaceId]);
  return draft;
}

/** Who a draft addresses: everyone, the threads it mentions by pill or @alias, or nobody yet. */
export function draftRecipients(draft: CommandDraft | null, threads: readonly CommandThread[]): "everyone" | string[] {
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
