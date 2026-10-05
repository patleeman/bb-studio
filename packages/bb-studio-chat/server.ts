import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { defineItemMention } from "@bb-studio/kit/server";
import { legacyChatContract, rpcContract, MENTION_PROVIDER_ID } from "@bb-studio/kit/chat-contract";
import { ref } from "@bb-studio/kit/chat-schemas";
import { z } from "zod";

const linkSchema = z.object({ threadId: z.string().min(1).max(200).nullable(), at: z.number().finite().nonnegative() });

/** Upgrade-only bridge. Studio owns the UI, new links, and all chat behavior. */
export default async function plugin(bb: BbPluginApi) {
  const call = <K extends keyof typeof rpcContract>(method: K, input: z.input<(typeof rpcContract)[K]["input"]>) =>
    bb.sdk.plugins.callRpc<z.output<(typeof rpcContract)[K]["output"]>>({ pluginId: "studio", method, input, outputSchema: rpcContract[method].output as unknown as z.ZodType<z.output<(typeof rpcContract)[K]["output"]>>, signal: AbortSignal.timeout(60_000) });

  const migrate = async () => {
    const keys = await bb.storage.kv.list("link:");
    let imported = 0;
    for (let offset = 0; offset < keys.length; offset += 250) {
      const links = [];
      for (const key of keys.slice(offset, offset + 250)) {
        const raw = key.slice(5);
        const colon = raw.indexOf(":");
        const item = ref.safeParse({ pluginId: raw.slice(0, colon), id: raw.slice(colon + 1) });
        const link = linkSchema.safeParse(await bb.storage.kv.get(key));
        if (colon <= 0 || !item.success || !link.success) throw new Error(`Invalid saved link ${key}; the original is preserved.`);
        links.push({ item: item.data, ...link.data });
      }
      if (links.length) imported += (await call("chat.importLinks", { links })).imported;
    }
    return { imported, checked: keys.length };
  };

  bb.ui.registerMentionProvider(defineItemMention({
    id: MENTION_PROVIDER_ID, label: "On screen", search: () => [],
    async resolve(key) {
      const colon = key.indexOf(":");
      const { item } = await call("chat.subject", { pluginId: key.slice(0, colon), id: key.slice(colon + 1) });
      return { context: item
        ? `The user means this Studio ${item.kindLabel.toLowerCase()}: "${item.title}" (${item.pluginId}:${item.id}, ${item.href}). Read it with its plugin's tools before answering.`
        : `The Studio item ${key} is gone. Look for it with studio_list_items.` };
    },
  }));

  const ready = async () => { await migrate(); };
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
        const result = await migrate();
        return { exitCode: 0, stdout: `Checked ${result.checked} saved links; imported ${result.imported} into Studio. Migration complete.\n` };
      } catch (error) { return { exitCode: 1, stderr: `Update and enable Studio, then retry: ${String(error)}\n` }; }
    },
  });
  await migrate().catch(error => bb.log.warn(`Chat link migration will retry: ${String(error)}`));
}
