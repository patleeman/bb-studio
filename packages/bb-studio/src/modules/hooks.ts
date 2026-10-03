import type { BbPluginApi, PluginHookHandler } from "@get-bb/plugin-sdk";

type Dispatch = PluginHookHandler<"message.dispatch">;
/** The host allows one handler; modules retain an ordered admission chain. */
export class ModuleHooks {
  private readonly dispatch: Dispatch[] = [];
  constructor(private readonly host: BbPluginApi["experimental_hooks"]) {}
  scope(): BbPluginApi["experimental_hooks"] {
    return { ...this.host, on: (_hook, handler) => { this.dispatch.push(handler); } };
  }
  register(): void {
    if (!this.dispatch.length) return;
    this.host.on("message.dispatch", async context => {
      const waits: Extract<Awaited<ReturnType<Dispatch>>, { action: "wait" }>[] = [];
      for (const handler of this.dispatch) {
        const result = await handler(context);
        if (result.action === "reject") return result;
        if (result.action === "wait") waits.push(result);
      }
      if (!waits.length) return { action: "proceed" };
      const due = waits.flatMap(wait => typeof wait.sendAt === "number" ? [wait.sendAt] : []);
      return { action: "wait", reason: waits.map(wait => wait.reason).join("; "), ...(due.length ? { sendAt: Math.min(...due) } : {}) };
    });
  }
}
