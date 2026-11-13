import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { POOL_PLUGIN_ID } from "../auth/contract";
import type { AuthService } from "../auth/service";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import { LiveBbPool, liveBbUrl } from "./bb-source";
import { ACCOUNTS_CHANNEL, accountsContract } from "./contract";
import { isMirrored, readPins, readPoolSignals, sourceDataDir } from "./local-data";
import { localUsageWindows, poolStatusSchema, type LocalUsage } from "./pool-view";
import { AccountsService, WarningStore } from "./service";

export interface AccountsRuntime {
  service: AccountsService;
  live: LiveBbPool;
}

export function createLiveBbPool(dataDir: string, ownUrl: string | null): LiveBbPool {
  let cached: { at: number; url: string | null } | null = null;
  return new LiveBbPool(() => {
    if (!cached || Date.now() - cached.at > 30_000) cached = { at: Date.now(), url: liveBbUrl(sourceDataDir(dataDir), dataDir, ownUrl) };
    return cached.url;
  });
}

export function registerAccounts(bb: BbPluginApi, db: Database.Database, auth: AuthService, live: LiveBbPool): AccountsRuntime {
  const dataDir = bb.server.experimental_dataDir;
  const source = sourceDataDir(dataDir);
  const service = new AccountsService({
    studioPool: () => bb.sdk.plugins.callRpc({ pluginId: POOL_PLUGIN_ID, method: "status.get", input: null, outputSchema: poolStatusSchema }) as Promise<z.infer<typeof poolStatusSchema>>,
    bbPool: live,
    studioSignals: (ids) => readPoolSignals(dataDir, ids),
    pins: (which) => (which === "studio" ? readPins(dataDir) : source ? readPins(source) : new Map()),
    providers: async () => {
      const { primaryHostId } = await bb.sdk.system.config();
      const { providers } = await bb.sdk.system.providerStates(primaryHostId ? { hostId: primaryHostId } : undefined);
      return providers.map((state) => ({ providerId: state.providerId, displayName: state.displayName, status: state.status, planLabel: state.planLabel, accountEmail: state.accountEmail, loginCommand: state.loginCommand ?? null }));
    },
    auth: () => auth.status(),
    usage: async () => {
      const { primaryHostId } = await bb.sdk.system.config();
      const usage = await bb.sdk.system.usageLimits({ ...(primaryHostId ? { hostId: primaryHostId } : {}), signal: AbortSignal.timeout(15_000) });
      return localUsageWindows(usage as LocalUsage);
    },
    reorder: async (provider, accountIds) => {
      await bb.sdk.plugins.callRpc({ pluginId: POOL_PLUGIN_ID, method: "account.reorder", input: { provider, accountIds }, outputSchema: z.null() });
    },
    thread: async (threadId) => {
      const thread = (await bb.sdk.threads.get({ threadId })) as { providerId?: string | null };
      return { providerId: thread.providerId ?? null, mirrored: isMirrored(dataDir, threadId) };
    },
    store: new WarningStore(db),
    changed: () => bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" }),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  bb.rpc.register(accountsContract, {
    "accounts.status": ({ refresh }) => service.status(refresh === true),
    "accounts.dismiss": ({ id }) => service.dismiss(id),
    "accounts.useOther": ({ accountKey }) => service.useOther(accountKey),
    "accounts.thread": ({ threadId }) => service.thread(threadId),
    "accounts.request": ({ signIn }) => {
      void bb.realtime.publish(ACCOUNTS_CHANNEL, { open: true, signIn });
      return { ok: true as const };
    },
  });
  const timer = setInterval(() => { void service.status(true).catch(() => {}); }, 120_000);
  bb.onDispose(() => clearInterval(timer));
  return { service, live };
}
