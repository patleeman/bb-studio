import type {
  PluginRpcContract, PluginRpcHandlers, PluginRpcResult, StandardSchemaV1,
  StandardSchemaV1InferInput,
} from "@get-bb/plugin-sdk";

/** Service objects are shared by modules; calls never traverse plugin RPC. */
export class ModuleServices {
  private readonly services = new Map<string, { contract: PluginRpcContract; handlers: PluginRpcHandlers<PluginRpcContract> }>();

  register<C extends PluginRpcContract>(name: string, contract: C, handlers: PluginRpcHandlers<C>): void {
    if (this.services.has(name)) throw new Error(`Module service already registered: ${name}`);
    this.services.set(name, { contract, handlers: handlers as PluginRpcHandlers<PluginRpcContract> });
  }

  has(name: string): boolean { return this.services.has(name); }

  /** Typed clients retain each module's original input and output schemas. */
  client<C extends PluginRpcContract>(name: string, _contract: C) {
    return {
      call: async <M extends keyof C & string>(method: M, input: StandardSchemaV1InferInput<C[M]["input"]>): Promise<PluginRpcResult<C[M]>> => {
        const output = await this.call(name, method, input);
        return output as PluginRpcResult<C[M]>;
      },
    };
  }

  async call(name: string, method: string, input: unknown): Promise<unknown> {
    const service = this.services.get(name);
    const schema = service?.contract[method];
    const handler = service?.handlers[method];
    if (!schema || !handler) throw new Error(`Unknown module service: ${name}.${method}`);
    const parsed = await validate(schema.input, input);
    return validate(schema.output, await handler(parsed));
  }
}

async function validate(schema: StandardSchemaV1, value: unknown): Promise<unknown> {
  const result = await schema["~standard"].validate(value);
  if (result.issues) throw new Error(result.issues.map(issue => issue.message).join("; "));
  return result.value;
}
