import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract } from "./client-contract";
import type { Bot } from "./contract";
import type { Store } from "./store";

export function registerTeamsCli(bb: BbPluginApi, store: Store, handlers: PluginRpcHandlers<typeof rpcContract>, approveCreate: (input: z.infer<typeof rpcContract.create.input>, threadId: string, signal?: AbortSignal) => Promise<{ approved: boolean; bot: Bot | null }>) {
  const tools = ["bots_create"];
  bb.agents.registerTool({ name: "bots_create", description: "Create a persistent bot with its profile and mission. A bot proposing another bot waits for owner approval.", parameters: rpcContract.create.input, execute: async (input, context) => {
    const result = await approveCreate(input, context.threadId, context.signal);
    if (!result.approved) return "Bot creation was not approved.";
    return JSON.stringify(result.bot ?? await handlers.create(input));
  } });
  bb.cli.register({
    name: "bots", summary: "Manage persistent bot profiles",
    commands: [
      { name: "list", summary: "List bots", usage: "[options]" }, { name: "show", summary: "Read a bot profile", usage: "<id>" },
      { name: "create", summary: "Create a bot", usage: "[options]" },
      { name: "mission", summary: "Read or save the bot's mission", usage: "[options]" }, { name: "memory", summary: "Read or save durable bot memory", usage: "[options]" },
      { name: "wake", summary: "Run the bot's mission now", usage: "[options]" }, { name: "message", summary: "Open the bot's normal thread", usage: "[options]" },
      { name: "update", summary: "Update a bot's profile", usage: "[options]" },
    ],
    async run(argv, context) {
      const options = { json: { type: "boolean" }, input: { type: "string" }, "input-file": { type: "string" }, name: { type: "string" }, description: { type: "string" }, avatar: { type: "string" }, provider: { type: "string" }, model: { type: "string" }, reasoning: { type: "string" }, permissions: { type: "string" }, interval: { type: "string" }, mission: { type: "string" }, "mission-file": { type: "string" }, "fallback-provider": { type: "string" }, "fallback-model": { type: "string" }, "fallback-reasoning": { type: "string" }, machine: { type: "string" }, file: { type: "string" }, text: { type: "string" }, "text-file": { type: "string" }, version: { type: "string" }, help: { type: "boolean" } } as const;
      try {
        const { values: v, positionals: args } = parseArgs({ args: argv, options, allowPositionals: true });
        if (!args.length || v.help) return { exitCode: 0, stdout: "bb bots list | show <bot> | create --name NAME --mission TEXT | update <bot> --input JSON | mission|memory <bot> [--text TEXT --version HASH] | wake <bot> | message <bot>\nBot profiles run in ordinary BB threads. Use bb automation for schedules and bb feed for reports." };
        const [command, id] = args;
        const parsed = v["input-file"] ? JSON.parse(await readFile(v["input-file"], "utf8")) : v.input ? JSON.parse(v.input) : {};
        let method: keyof typeof rpcContract, input: unknown;
        const botId = () => { const matches = store.all().filter(b => b.id === id || (id?.startsWith("@") ? b.handle === id.slice(1) : b.name.toLowerCase() === id?.toLowerCase())); if (matches.length > 1) throw new Error("Bot name is ambiguous. Use a handle or ID."); const bot = matches[0]; if (!bot) throw new Error("Bot not found."); const author = context.threadId ? store.byThread(context.threadId) : null; if (author && author.botId !== bot.id) throw new Error("Use your own bot profile for private state."); return bot.id; };
        const readText = async (path: string) => {
          let hostId = v.machine;
          if (!hostId && context.threadId) { const thread = await bb.sdk.threads.get({threadId:context.threadId}); if(thread.environmentId)hostId=(await bb.sdk.environments.get({environmentId:thread.environmentId})).hostId ?? undefined; }
          if(!hostId) throw new Error("Provide --machine for a file, or run in a thread with a connected machine.");
          const file = await bb.sdk.files.read({hostId,path:resolve(context.cwd ?? "/",path),signal:context.signal});
          return file.contentEncoding === "base64" ? Buffer.from(file.content,"base64").toString("utf8") : file.content;
        };
        if(v.text !== undefined && (v.file || v["text-file"]))throw new Error("Choose --text or --file.");
        const text = v.file || v["text-file"] ? await readText(v.file ?? v["text-file"]!) : v.text;
        switch (command) {
          case "list": method = "list"; input = null; break;
          case "show": method = "get"; input = { id: botId() }; break;
          case "create": {
            method = "create"; input = rpcContract.create.input.parse({ ...parsed, ...(v.name || id ? { name: v.name ?? id } : {}), ...(v.description ? { description: v.description } : {}), ...(v.avatar ? { avatar: v.avatar } : {}), ...(v.provider ? { providerId: v.provider } : {}), ...(v.model ? { model: v.model } : {}), ...(v.reasoning ? { reasoningLevel: v.reasoning } : {}), ...(v.permissions ? { permissionMode: v.permissions } : {}), ...(v.interval ? { intervalMinutes: Number(v.interval) } : {}), ...(v["fallback-provider"] ? { fallbackProviderId: v["fallback-provider"] } : {}), ...(v["fallback-model"] ? { fallbackModel: v["fallback-model"] } : {}), ...(v["fallback-reasoning"] ? { fallbackReasoningLevel: v["fallback-reasoning"] } : {}), mission: v["mission-file"] ? await readText(v["mission-file"]) : v.mission ?? parsed.mission });
            if (context.threadId) { const approved = await approveCreate(input as z.infer<typeof rpcContract.create.input>, context.threadId, context.signal); if (!approved.approved) throw new Error("Bot creation was not approved."); if (approved.bot) return { exitCode: 0, stdout: JSON.stringify(approved.bot) }; }
            break;
          }
          case "update": method = "update"; input = { ...parsed, id: botId(),
            ...(v.name !== undefined ? { name: v.name } : {}), ...(v.description !== undefined ? { description: v.description } : {}), ...(v.avatar !== undefined ? { avatar: v.avatar } : {}),
            ...(v.provider !== undefined ? { providerId: v.provider } : {}), ...(v.model !== undefined ? { model: v.model } : {}), ...(v.reasoning !== undefined ? { reasoningLevel: v.reasoning } : {}),
            ...(v.permissions !== undefined ? { permissionMode: v.permissions } : {}), ...(v.interval !== undefined ? { intervalMinutes: Number(v.interval) } : {}),
            ...(v["fallback-provider"] !== undefined ? { fallbackProviderId: v["fallback-provider"] } : {}), ...(v["fallback-model"] !== undefined ? { fallbackModel: v["fallback-model"] } : {}), ...(v["fallback-reasoning"] !== undefined ? { fallbackReasoningLevel: v["fallback-reasoning"] } : {}) }; break;
          case "swap": method = "swapModel"; input = { id: botId() }; break;
          case "retire": case "restore": method = "retire"; input = { id: botId(), retired: command === "retire" }; break;
          case "wake": method = "wake"; input = { id: botId() }; break;
          case "message": method = "conversation"; input = { id: botId() }; break;
          case "mission": case "memory": {
            const documentInput = { id: botId(), file: command === "mission" ? "MISSION.md" as const : "MEMORY.md" as const };
            method = text === undefined ? "document" : "saveDocument";
            const version = text === undefined ? undefined : v.version ?? (await handlers.document(documentInput)).version;
            input = { ...documentInput, ...(text === undefined ? {} : { text, version }) };
            break;
          }
          default: throw new Error(`Unknown bots command: ${command}`);
        }
        let data = await (handlers[method] as (input: never) => Promise<unknown>)(rpcContract[method].input.parse(input) as never);
        if (command === "show") data = (data as {bot:Bot}).bot;
        return { exitCode: 0, stdout: !v.json && ["mission", "memory"].includes(command!) && text === undefined ? (data as { text: string }).text : JSON.stringify(data) };
      } catch (cause) { return { exitCode: 1, stderr: cause instanceof Error ? cause.message : String(cause) }; }
    },
  });
  return tools;
}
