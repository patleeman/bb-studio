import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { POOL_PLUGIN_ID, authContract, poolAccountSchema, poolCancelSchema, poolClaudeStartSchema, poolCodexPollSchema, poolCodexStartSchema, poolSavedSchema } from "./contract";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import { AuthService, type AuthPool, type AuthTerminal } from "./service";

type Sdk = BbPluginApi["sdk"];

export function poolAdapter(sdk: Pick<Sdk, "plugins">): AuthPool {
  const call = <T>(method: string, input: Record<string, string> | null, outputSchema: z.ZodType<T>) => sdk.plugins.callRpc({ pluginId: POOL_PLUGIN_ID, method, input, outputSchema }) as Promise<T>;
  const relogin = (accountId: string) => ({ kind: "relogin", accountId });
  return {
    list: () => call("account.list", null, z.array(poolAccountSchema)).catch(() => null),
    codexStart: (accountId) => call("codexLogin.start", relogin(accountId), poolCodexStartSchema),
    codexPoll: (sessionId) => call("codexLogin.poll", { sessionId }, poolCodexPollSchema),
    codexCancel: (sessionId) => call("codexLogin.cancel", { sessionId }, poolCancelSchema),
    claudeStart: (accountId) => call("login.start", relogin(accountId), poolClaudeStartSchema),
    claudeComplete: (sessionId, pasted) => call("login.complete", { sessionId, pasted }, poolSavedSchema),
  };
}

export function terminalAdapter(sdk: Pick<Sdk, "terminals" | "system">): AuthTerminal {
  return {
    async create({ command, title }) {
      const { primaryHostId } = await sdk.system.config();
      if (!primaryHostId) throw new Error("This server has no machine of its own.");
      const session = await sdk.terminals.create({ cols: 120, rows: 30, title, scope: { kind: "host_path", hostId: primaryHostId, cwd: null }, start: { mode: "command", command } });
      return { id: session.id };
    },
    async output(id, sinceSeq) {
      const result = await sdk.terminals.output({ terminalId: id, sinceSeq });
      return { text: Buffer.concat(result.chunks.map((chunk) => Buffer.from(chunk.dataBase64, "base64"))).toString("utf8"), nextSeq: result.nextSeq };
    },
    async state(id) {
      const session = await sdk.terminals.get({ terminalId: id });
      return { running: session.status === "starting" || session.status === "running", exitCode: session.exitCode };
    },
    async input(id, text) {
      await sdk.terminals.input({ terminalId: id, dataBase64: Buffer.from(text, "utf8").toString("base64") });
    },
    async close(id) {
      await sdk.terminals.close({ terminalId: id, mode: "force" });
    },
  };
}

export function registerAuth(bb: BbPluginApi, every: (name: string, everyMs: number, work: () => void) => void = (_name, everyMs, work) => {
  const timer = setInterval(work, everyMs);
  bb.onDispose(() => clearInterval(timer));
}, bbPool: AuthPool | null = null): AuthService {
  const service = new AuthService({
    pool: poolAdapter(bb.sdk),
    bbPool,
    providers: {
      async states() {
        const { primaryHostId } = await bb.sdk.system.config();
        const { providers } = await bb.sdk.system.providerStates(primaryHostId ? { hostId: primaryHostId } : undefined);
        return providers.map((state) => ({ providerId: state.providerId, displayName: state.displayName, status: state.status, planLabel: state.planLabel, accountEmail: state.accountEmail, loginCommand: state.loginCommand ?? null }));
      },
    },
    terminal: terminalAdapter(bb.sdk),
    kv: bb.storage.kv,
    changed: () => bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" }),
    log: (message) => bb.log.info(message),
  });
  bb.rpc.register(authContract, {
    "auth.status": ({ refresh }) => service.status(refresh === true),
    "auth.login.start": ({ target }) => service.start(target),
    "auth.login.poll": ({ sessionId }) => service.poll(sessionId),
    "auth.login.complete": ({ sessionId, code }) => service.complete(sessionId, code),
    "auth.login.cancel": ({ sessionId }) => service.cancel(sessionId),
  });
  bb.events.on("thread.failed", ({ thread, error }) => service.noteTurn(thread.providerId, "failed", error));
  bb.events.on("thread.idle", ({ thread }) => service.noteTurn(thread.providerId, "ok"));
  every("auth", 120_000, () => void service.sweep());
  bb.onDispose(() => void service.dispose());
  return service;
}
