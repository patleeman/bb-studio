import { studioSchemas, type StudioKind } from "@bb-studio/kit/contract";
import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { LocalProvider } from "../hub";
import { ModuleServices } from "./services";

export const moduleProviderContract = studioSchemas(z).provider;
type Contract = typeof moduleProviderContract;
type Method = keyof Contract;

/** Presents module kinds as one Studio provider while keeping their stores separate. */
export class ModuleProvider implements LocalProvider {
  readonly kinds: StudioKind[] = [];
  readonly aliases = new Set<string>();
  private readonly owners = new Map<string, string>();
  private readonly modules: string[] = [];
  constructor(private readonly services: ModuleServices) {}

  async add(module: string) {
    const info = await this.moduleCall(module, "studio_describe", null);
    for (const kind of info.kinds) {
      if (this.owners.has(kind.id)) throw new Error(`Duplicate Studio kind: ${kind.id}`);
      this.owners.set(kind.id, module); this.kinds.push(kind);
    }
    this.modules.push(module); this.aliases.add(module);
  }

  private moduleCall<M extends Method>(module: string, method: M, input: z.input<Contract[M]["input"]>): Promise<z.output<Contract[M]["output"]>> {
    return this.services.client(module, moduleProviderContract).call(method, input) as Promise<z.output<Contract[M]["output"]>>;
  }
  private async owner(id: string): Promise<string> {
    const matches = await Promise.all(this.modules.map(async module => {
      const { items } = await this.moduleCall(module, "studio_get", { ids: [id] });
      return items.length ? module : null;
    }));
    const owners = matches.filter((entry): entry is string => entry !== null);
    if (owners.length !== 1) throw new Error(owners.length ? `Ambiguous Studio item: ${id}` : `Studio item not found: ${id}`);
    return owners[0];
  }
  private async groups(ids: string[]) {
    const groups = new Map<string, string[]>();
    for (const id of ids) {
      const owner = await this.owner(id);
      groups.set(owner, [...groups.get(owner) ?? [], id]);
    }
    return groups;
  }
  private async bulk(method: "studio_move" | "studio_archive" | "studio_delete", input: { ids: string[] }) {
    const results = await Promise.all([...await this.groups(input.ids)].map(([module, ids]) =>
      this.moduleCall(module, method, { ...input, ids } as z.input<Contract[typeof method]["input"]>)));
    return { done: results.flatMap(result => result.done), failed: results.flatMap(result => result.failed) };
  }
  readonly handlers: PluginRpcHandlers<Contract> = {
    studio_describe: () => ({ pluginId: "studio", version: 2, panel: "studio", kinds: this.kinds }),
    studio_list: async () => {
      const results = await Promise.all(this.modules.map(module => this.moduleCall(module, "studio_list", null)));
      return { items: results.flatMap(result => result.items), truncated: results.some(result => result.truncated) };
    },
    studio_get: async input => ({ items: (await Promise.all(this.modules.map(module => this.moduleCall(module, "studio_get", input)))).flatMap(result => result.items) }),
    studio_read: async input => this.moduleCall(await this.owner(input.id), "studio_read", input),
    studio_search: async input => {
      const results = await Promise.all(this.modules.map(module => this.moduleCall(module, "studio_search", input)));
      return { ids: results.flatMap(result => result.ids), snippets: Object.assign({}, ...results.map(result => result.snippets ?? {})) };
    },
    studio_create: input => {
      const owner = this.owners.get(input.kind);
      if (!owner) throw new Error(`Unknown Studio kind: ${input.kind}`);
      return this.moduleCall(owner, "studio_create", input);
    },
    studio_move: input => this.bulk("studio_move", input),
    studio_archive: input => this.bulk("studio_archive", input),
    studio_delete: input => this.bulk("studio_delete", input),
    studio_action: async input => {
      const results = await Promise.all([...await this.groups(input.ids)].map(([module, ids]) => this.moduleCall(module, "studio_action", { ...input, ids })));
      return { message: results.map(result => result.message).filter(Boolean).join("\n") || null, text: results.map(result => result.text).filter(Boolean).join("\n") || null };
    },
    studio_duplicate: async input => this.moduleCall(await this.owner(input.id), "studio_duplicate", input),
    studio_template: async input => this.moduleCall(await this.owner(input.id), "studio_template", input),
    studio_instantiate: async input => this.moduleCall(await this.owner(input.id), "studio_instantiate", input),
    studio_export: async input => this.moduleCall(await this.owner(input.id), "studio_export", input),
  };
  async call<M extends Method>(method: M, input: z.input<Contract[M]["input"]>): Promise<z.output<Contract[M]["output"]>> {
    // All entry points use the same schemas as public provider RPCs.
    const parsed = moduleProviderContract[method].input.parse(input);
    const handler = this.handlers[method] as (input: unknown) => unknown;
    return moduleProviderContract[method].output.parse(await handler(parsed)) as z.output<Contract[M]["output"]>;
  }
  async items() { return (await this.call("studio_list", null)).items.map(item => ({ ...item, pluginId: "studio" })); }
}
