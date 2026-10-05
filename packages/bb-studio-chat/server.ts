import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { defineItemMention } from "@bb-studio/kit/server";
import { legacyChatContract, rpcContract, schemas, MENTION_PROVIDER_ID } from "@bb-studio/kit/chat-contract";
import { STUDIO_ITEM_AT_METHOD, STUDIO_PLUGIN_ID, type StudioItem, type StudioKind } from "@bb-studio/kit/contract";
import { untitled } from "@bb-studio/kit/format";
import { ref } from "@bb-studio/kit/chat-schemas";
import { z } from "zod";

const linkSchema = z.object({ threadId: z.string().min(1).max(200).nullable(), at: z.number().finite().nonnegative() });
const importedLink = linkSchema.extend({ item: ref });
/** Prefix of the per-link record of what was copied to Studio; never under `link:`. */
const MIGRATED = "migrated:";
const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 10 * 60_000;

const GENERIC_HINT = "Find it with studio_list_items; its link is above.";

/** What the agent is told about a mentioned item: a pointer, not the content. Mirrors Studio's chat/context.ts. */
function pointerNote(item: StudioItem & { pluginId: string }, kind: StudioKind | null): string {
  const label = (kind?.label ?? item.kind).toLowerCase();
  return [
    `The user has this Studio ${label} open while they talk to you: "${untitled(item.title)}" (${label} id ${item.id}, from the ${item.pluginId} plugin, link ${item.href}).`,
    `When they say "this" or "here", they mean it. ${kind?.agentHint ?? GENERIC_HINT}`,
    "Read it fresh before you answer about it; don't guess its content.",
  ].join("\n");
}

function missingNote(key: string): string {
  return `The user had a Studio item open (${key}), but it can't be found now. It may have been deleted. ${GENERIC_HINT}`;
}

/** Upgrade-only bridge. Studio owns the UI, new links, and all chat behavior. */
export default async function plugin(bb: BbPluginApi) {
  const call = <K extends keyof typeof rpcContract>(method: K, input: z.input<(typeof rpcContract)[K]["input"]>) =>
    bb.sdk.plugins.callRpc<z.output<(typeof rpcContract)[K]["output"]>>({ pluginId: "studio", method, input, outputSchema: rpcContract[method].output as unknown as z.ZodType<z.output<(typeof rpcContract)[K]["output"]>>, signal: AbortSignal.timeout(60_000) });

  /**
   * Copies saved links into Studio. Each copied link gets a `migrated:` marker
   * holding what was sent, so a rerun skips it unless the original changed.
   * Malformed records are kept and reported, never sent or thrown on.
   */
  const migrate = async () => {
    const keys = await bb.storage.kv.list("link:");
    const skipped: string[] = [];
    const pending: { key: string; link: z.output<typeof importedLink> }[] = [];
    for (const key of keys) {
      const raw = key.slice(5);
      const colon = raw.indexOf(":");
      const item = ref.safeParse({ pluginId: raw.slice(0, colon), id: raw.slice(colon + 1) });
      const link = linkSchema.safeParse(await bb.storage.kv.get(key));
      if (colon <= 0 || !item.success || !link.success) { skipped.push(key); continue; }
      const done = linkSchema.safeParse(await bb.storage.kv.get(`${MIGRATED}${key}`));
      if (done.success && done.data.threadId === link.data.threadId && done.data.at === link.data.at) continue;
      pending.push({ key, link: { item: item.data, ...link.data } });
    }
    let imported = 0;
    for (let offset = 0; offset < pending.length; offset += 250) {
      const batch = pending.slice(offset, offset + 250);
      imported += (await call("chat.importLinks", { links: batch.map(each => each.link) })).imported;
      for (const { key, link } of batch) await bb.storage.kv.set(`${MIGRATED}${key}`, { threadId: link.threadId, at: link.at });
    }
    if (skipped.length) bb.log.warn(`Skipped ${skipped.length} malformed saved chat links (originals kept): ${skipped.join(", ")}`);
    return { imported, checked: keys.length, skipped };
  };

  // The bridge never writes links, so one complete pass covers every later call.
  let migrated = false;
  let running: ReturnType<typeof migrate> | null = null;
  const runMigration = () => running ??= migrate().then(result => { migrated = true; return result; }).finally(() => { running = null; });

  bb.ui.registerMentionProvider(defineItemMention({
    id: MENTION_PROVIDER_ID, label: "On screen", search: () => [],
    // Archived items still get a pointer, and any failure falls back to the
    // missing note, as the mention did before Studio took chat over.
    async resolve(key) {
      const colon = key.indexOf(":");
      if (colon <= 0 || colon === key.length - 1) return { context: missingNote(key) };
      const { item, kind } = await bb.sdk.plugins.callRpc({
        pluginId: STUDIO_PLUGIN_ID, method: STUDIO_ITEM_AT_METHOD, input: { pluginId: key.slice(0, colon), id: key.slice(colon + 1) },
        outputSchema: schemas.itemAt.output, signal: AbortSignal.timeout(10_000),
      }).catch(() => ({ item: null, kind: null }));
      return { context: item ? pointerNote(item, kind) : missingNote(key) };
    },
  }));

  const ready = async () => { if (!migrated) await runMigration(); };
  bb.rpc.register(legacyChatContract, {
    viewing: async input => { await ready(); return call("chat.viewing", input); },
    subject: async input => { await ready(); return call("chat.subject", input); },
    start: async input => { await ready(); return call("chat.start", input); },
    home: async input => { await ready(); return call("chat.home", input); },
    link: async input => { await ready(); return call("chat.link", input); },
    unlink: async input => { await ready(); return call("chat.unlink", input); },
    send: async input => { await ready(); return call("chat.send", input); },
  });
  bb.cli.register({
    name: "studio-chat", summary: "Migrate legacy chat links into Studio",
    async run(argv) {
      if (argv[0] !== "migrate") return { exitCode: 1, stderr: "usage: bb studio-chat migrate\n" };
      try {
        const result = await runMigration();
        const skipped = result.skipped.length ? `Skipped ${result.skipped.length} malformed links, kept as they were: ${result.skipped.join(", ")}\n` : "";
        return { exitCode: 0, stdout: `${skipped}Checked ${result.checked} saved links; imported ${result.imported} into Studio. Migration complete.\n` };
      } catch (error) { return { exitCode: 1, stderr: `Update and enable Studio, then retry: ${String(error)}\n` }; }
    },
  });

  // Studio may be missing, disabled, or still starting: retry with backoff
  // until one pass completes (a legacy call or the CLI may finish it first).
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = async (delay: number): Promise<void> => {
    if (disposed || migrated) return;
    await runMigration().catch(error => {
      if (disposed || migrated) return;
      bb.log.warn(`Chat link migration will retry in ${Math.round(delay / 1000)}s: ${String(error)}`);
      timer = setTimeout(() => { void attempt(Math.min(delay * 2, MAX_RETRY_MS)); }, delay);
    });
  };
  bb.onDispose(() => { disposed = true; clearTimeout(timer); });
  await attempt(FIRST_RETRY_MS);
}
