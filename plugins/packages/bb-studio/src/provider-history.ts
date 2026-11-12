import { createHash } from "node:crypto";
import { z } from "zod";
import type { Ref, ItemVersion } from "./services";

type Sdk = { plugins: { callRpc<T>(args: { pluginId: string; method: string; input: never; outputSchema: z.ZodType<T>; signal?: AbortSignal }): Promise<T> } };
const bytesSchema = z.object({ bytes: z.string().nullable() });

/** A built-in kind's own version history, read in-process. */
export interface LocalHistory {
  versions(id: string): { id: string; name: string; createdAt: number }[];
  bytes(id: string, versionId: string): Uint8Array | null;
}

/** Existing provider histories stay in their source stores. */
export class ProviderHistory {
  constructor(private readonly sdk: Sdk, private readonly local: Readonly<Record<string, LocalHistory>> = {}) {}

  private call<T>(pluginId: string, method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> {
    return this.sdk.plugins.callRpc({ pluginId, method, input: input as never, outputSchema, signal: AbortSignal.timeout(10_000) });
  }

  async versions(ref: Ref): Promise<ItemVersion[] | null> {
    if (ref.pluginId === "pages") {
      const { snapshots } = await this.call("studio", "pages.snapshots", { id: ref.id }, z.object({ snapshots: z.array(z.object({ id: z.string(), label: z.string(), actor: z.string(), createdAt: z.number() })) }));
      return Promise.all(snapshots.map(async (snapshot) => {
        const bytes = await this.read(ref, snapshot.id);
        return {
          id: snapshot.id, ref, label: snapshot.label, createdAt: snapshot.createdAt,
          sha256: bytes ? createHash("sha256").update(bytes).digest("hex") : "",
          actor: snapshot.actor.startsWith("bot:") ? { kind: "bot" as const, id: snapshot.actor.slice(4) }
            : snapshot.actor.startsWith("agent:") ? { kind: "agent" as const, id: snapshot.actor.slice(6) } : { kind: "user" as const },
        };
      }));
    }
    const local = this.local[ref.pluginId];
    if (local) {
      const versions = local.versions(ref.id);
      return Promise.all(versions.map(async (version) => {
        const bytes = await this.read(ref, version.id);
        return { id: version.id, ref, label: version.name, createdAt: version.createdAt,
          sha256: bytes ? createHash("sha256").update(bytes).digest("hex") : "", actor: { kind: "app" as const } };
      }));
    }
    return null;
  }

  async read(ref: Ref, id: string): Promise<Uint8Array | null> {
    if (ref.pluginId === "pages") {
      const { bytes } = await this.call("studio", "pages.snapshotBytes", { id: ref.id, snapshotId: id }, bytesSchema);
      return bytes ? Buffer.from(bytes, "base64") : null;
    }
    const local = this.local[ref.pluginId];
    if (local) return local.bytes(ref.id, id);
    return null;
  }
}
