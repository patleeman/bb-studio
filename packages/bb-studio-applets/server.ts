// @bb-studio/applets — backend entry. Experimental.
//
// Applets are small native apps that agents write as plain folders and one
// signed shell (apps/applets) runs. This plugin owns the folders, the
// approved capabilities, and the API applets use to reach BB. It works
// without the shell: agents can still write and check applets, and the
// settings page says the shell isn't running.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract, type AppletRow } from "./contract";
import { APPLET_API, CAPABILITIES } from "./src/manifest";
import { shellStatus } from "./src/shell";
import { AppletStore, defaultRoot, type AppletInfo } from "./src/store";
import { getThread, listThreads, openThread, stopThread, tellThread, threadTimeline } from "./src/threads";

const AGENT_INSTRUCTIONS = [
  "Studio Applets (experimental) are small native macOS apps: a folder with manifest.json and HTML/JS/CSS, run by the signed Studio Applets shell. Create one with applets_create and change it with applets_update.",
  `An applet has no Node or Electron. It reaches the desktop and BB only through \`window.studio\` (API ${APPLET_API}), and only for capabilities its manifest lists and the user approved. Capabilities: ${CAPABILITIES.join(", ")}, and bb.rpc:<plugin-id>:<method>.`,
  "`window.studio.bb.threads` has list, get, timeline (recent messages and tool calls), tell (with { mode: \"steer\" } to join a running turn) and stop (needs bb.threads.tell). Load studio://kit/boot.js for BB's look and import React, html, render and the Studio kit components from studio://kit/ui.js; inline scripts are blocked.",
  "Every window in `windows` needs the matching window.<kind> capability; shortcuts need shortcut.global. Ask for as few capabilities as the applet needs. New capabilities wait for the user's approval in the Studio Applets settings page.",
].join("\n");

function row(info: AppletInfo): AppletRow {
  return {
    id: info.id,
    name: info.manifest?.name ?? null,
    version: info.manifest?.version ?? null,
    description: info.manifest?.description ?? null,
    capabilities: info.manifest?.capabilities ?? [],
    granted: info.granted,
    pending: info.pending,
    errors: info.errors,
  };
}

function describe(info: AppletInfo): string {
  const lines = [`${info.manifest?.name ?? info.id} (${info.id}) at ${info.dir}`];
  if (info.errors.length) lines.push(`Problems:\n${info.errors.map((e) => `- ${e}`).join("\n")}`);
  if (info.pending.length) lines.push(`Waiting for the user's approval in Studio Applets settings: ${info.pending.join(", ")}`);
  else if (info.manifest) lines.push("All capabilities approved.");
  return lines.join("\n");
}

const fileSchema = z.object({ path: z.string().min(1), content: z.string() });

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    folder: {
      type: "string",
      label: "Applets folder",
      default: "",
      description: "Where applet folders live. Leave empty for ~/.bb-studio/applets, where the Studio Applets app looks.",
    },
  });
  const storeFor = (folder: string) => new AppletStore(folder.trim() || defaultRoot());
  // Handlers read `store` on each call, so a changed folder applies at once.
  let store = storeFor((await settings.get()).folder);
  settings.onChange((next) => {
    store = storeFor(next.folder);
  });

  bb.rpc.register(rpcContract, {
    status: async () => ({ root: store.root, shell: await shellStatus(store.root), applets: (await store.list()).map(row) }),
    "applets.list": async () => (await store.list()).map(row),
    "applets.grant": async ({ id, capabilities }) => row(await store.grant(id, capabilities)),
    "applets.revoke": async ({ id }) => (await store.revoke(id), null),
    "applets.remove": async ({ id }) => (await store.remove(id), null),
    "applets.logs": async ({ id }) => ({ text: await store.logs(id) }),
    "threads.list": (input) => listThreads(bb.sdk, input),
    "threads.get": ({ threadId }) => getThread(bb.sdk, threadId),
    "threads.timeline": ({ threadId, limit }) => threadTimeline(bb.sdk, threadId, limit),
    "threads.tell": async ({ threadId, text, mode }) => (await tellThread(bb.sdk, threadId, text, mode), null),
    "threads.stop": async ({ threadId }) => (await stopThread(bb.sdk, threadId), null),
    "threads.open": async ({ threadId }) => (await openThread(bb.sdk, threadId), null),
  });

  bb.agents.contributeInstructions(() => AGENT_INSTRUCTIONS);

  bb.agents.registerTool({
    name: "applets_create",
    description: "Create a Studio Applet (experimental native macOS mini-app): writes its manifest and files to its folder. Fails if the manifest is invalid.",
    parameters: z.object({
      id: z.string().describe("Folder name and manifest id: lowercase letters, digits, dashes"),
      manifest: z.record(z.string(), z.unknown()).describe(`manifest.json: { id, name, version, api: ${APPLET_API}, entry?, description?, windows?, capabilities?, shortcuts? }`),
      files: z.array(fileSchema).describe("Files relative to the applet folder, such as index.html"),
    }),
    async execute({ id, manifest, files }) {
      if (await store.get(id)) return `Applet "${id}" already exists. Use applets_update.`;
      return describe(await store.write(id, files, manifest));
    },
  });

  bb.agents.registerTool({
    name: "applets_update",
    description: "Change a Studio Applet's files, and optionally its manifest. The shell reloads it.",
    parameters: z.object({
      id: z.string(),
      files: z.array(fileSchema).default([]),
      manifest: z.record(z.string(), z.unknown()).optional().describe("The full new manifest.json, if it changes"),
    }),
    async execute({ id, files, manifest }) {
      return describe(await store.write(id, files, manifest));
    },
  });

  bb.agents.registerTool({
    name: "applets_list",
    description: "List Studio Applets with their capabilities, approval state and problems, and whether the shell is running.",
    parameters: z.object({}),
    async execute() {
      const [shell, applets] = await Promise.all([shellStatus(store.root), store.list()]);
      const head = `Shell: ${shell.state}${shell.version ? ` (${shell.version})` : ""}. Applets folder: ${store.root}`;
      return applets.length ? [head, ...applets.map(describe)].join("\n\n") : `${head}\nNo applets yet.`;
    },
  });

  bb.agents.registerTool({
    name: "applets_logs",
    description: "Read the end of a Studio Applet's log: its console output and API errors, written by the shell.",
    parameters: z.object({ id: z.string() }),
    async execute({ id }) {
      return (await store.logs(id)) || `No log for "${id}" yet. The shell writes one once the applet runs.`;
    },
  });

  bb.cli.register({
    name: "applets",
    summary: "Studio Applets (experimental): list applets, read logs, check the shell",
    commands: [
      { name: "list", summary: "List applets and their approval state", usage: "bb applets list" },
      { name: "logs", summary: "Print an applet's log", usage: "bb applets logs <id>" },
      { name: "doctor", summary: "Check the shell and the applets folder", usage: "bb applets doctor" },
    ],
    async run(argv) {
      const [command, id] = argv;
      if (command === "logs" && id) return { exitCode: 0, stdout: await store.logs(id) };
      if (command === "doctor") {
        const shell = await shellStatus(store.root);
        const applets = await store.list();
        return {
          exitCode: 0,
          stdout: [
            `Shell: ${shell.state}${shell.appPath ? ` at ${shell.appPath}` : ""}${shell.version ? ` (${shell.version})` : ""}`,
            `Socket: ${shell.socketPath}`,
            `Applets folder: ${store.root}`,
            `Applets: ${applets.length}, with problems: ${applets.filter((a) => a.errors.length).length}, waiting for approval: ${applets.filter((a) => a.pending.length).length}`,
          ].join("\n") + "\n",
        };
      }
      if (command && command !== "list") return { exitCode: 1, stderr: "Usage: bb applets list | logs <id> | doctor\n" };
      const applets = await store.list();
      return { exitCode: 0, stdout: applets.length ? applets.map(describe).join("\n\n") + "\n" : `No applets in ${store.root}\n` };
    },
  });
}
