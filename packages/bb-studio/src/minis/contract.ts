// RPC between Studio's app (a mini app's tab, its frames, and Settings) and
// the server. Frames never call these: the host component (MiniFrame) does,
// for its own frame, after checking each message came from it.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { findSchema, LIMITS } from "./shared";

const id = z.string().min(1).max(100);
const client = z.string().min(8).max(64);
const collection = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/);
const recordId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const data = z.record(z.string(), z.unknown());
const ok = z.object({ ok: z.boolean() });
const files = z.record(z.string().max(200), z.string().max(LIMITS.fileBytes)).refine((value) => Object.keys(value).length <= LIMITS.files);

const record = z.object({ id: z.string(), rev: z.number(), createdAt: z.number(), updatedAt: z.number(), createdBy: z.enum(["user", "agent"]), data });

export const miniMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string().nullable(),
  versionId: z.string().nullable(),
  updatedAt: z.number(),
  archived: z.boolean(),
});

export const miniViewSchema = miniMetaSchema.extend({
  createdAt: z.number(),
  updatedBy: z.string(),
  threadId: z.string().nullable(),
  files,
  manifest: z.object({
    entry: z.string(),
    libs: z.array(z.string()),
    collections: z.record(z.string(), z.object({ indexes: z.array(z.string()) })),
    capabilities: z.array(z.string()),
    size: z.object({ minHeight: z.number().optional(), maxHeight: z.number().optional() }),
    description: z.string().optional(),
  }).nullable(),
  versions: z.array(z.object({ id: z.string(), note: z.string().nullable(), by: z.string(), createdAt: z.number() })),
  /** Capabilities the manifest asks for and the user approved. */
  granted: z.array(z.string()),
  /** Capabilities the manifest asks for that wait for the user. */
  pending: z.array(z.string()),
  secrets: z.array(z.object({ name: z.string(), header: z.string(), updatedAt: z.number() })),
  collections: z.array(z.object({ name: z.string(), count: z.number() })),
});
export type MiniView = z.infer<typeof miniViewSchema>;

export const fetchLogSchema = z.object({ at: z.number(), method: z.string(), url: z.string(), status: z.number().nullable(), error: z.string().nullable(), ms: z.number(), bytes: z.number() });

export const rpcContract = defineRpcContract({
  "minis.list": { input: z.object({}), output: z.object({ minis: z.array(miniMetaSchema) }) },
  "minis.get": { input: z.object({ id }), output: z.object({ mini: miniViewSchema.nullable() }) },
  "minis.create": { input: z.object({ name: z.string().max(LIMITS.name).optional(), projectId: z.string().nullable().optional() }), output: z.object({ mini: miniViewSchema }) },
  /** Saves the source as a new version; fails with what to fix when it doesn't compile. */
  "minis.save": { input: z.object({ id, files, note: z.string().max(200).optional() }), output: z.object({ mini: miniViewSchema }) },
  "minis.restoreVersion": { input: z.object({ id, versionId: id }), output: z.object({ mini: miniViewSchema }) },
  "minis.rename": { input: z.object({ id, name: z.string().min(1).max(LIMITS.name) }), output: ok },
  "minis.duplicate": { input: z.object({ id, withData: z.boolean() }), output: z.object({ mini: miniMetaSchema }) },

  // The frame's playground API, relayed by its host.
  "minis.live.save": { input: z.object({ id, clientId: client, state: z.unknown() }), output: z.object({ version: z.number() }) },
  "minis.live.emit": { input: z.object({ id, name: z.string().min(1).max(100), data: z.unknown() }), output: ok },
  "minis.live.open": { input: z.object({ id, clientId: client, actions: z.array(z.string().min(1).max(100)).max(100) }), output: ok },
  "minis.live.touch": { input: z.object({ id, clientId: client }), output: ok },
  "minis.live.close": { input: z.object({ id, clientId: client }), output: ok },
  "minis.live.result": {
    input: z.object({ commandId: z.string().min(1).max(100), clientId: client, ok: z.boolean(), value: z.unknown().optional(), error: z.string().max(2000).optional() }),
    output: ok,
  },
  "minis.live.take": { input: z.object({ id, label: z.string().min(1).max(120), data: z.unknown() }), output: z.object({ takeId: z.string() }) },

  "minis.db.find": { input: z.object({ id, collection, query: findSchema }), output: z.object({ records: z.array(record) }) },
  "minis.db.count": { input: z.object({ id, collection, query: findSchema.pick({ where: true }) }), output: z.object({ count: z.number() }) },
  "minis.db.get": { input: z.object({ id, collection, recordId }), output: z.object({ record: record.nullable() }) },
  "minis.db.insert": { input: z.object({ id, clientId: client, collection, data, recordId: recordId.optional() }), output: z.object({ record }) },
  "minis.db.update": { input: z.object({ id, clientId: client, collection, recordId, data, rev: z.number().int().optional() }), output: z.object({ record }) },
  "minis.db.patch": { input: z.object({ id, clientId: client, collection, recordId, fields: data }), output: z.object({ record }) },
  "minis.db.remove": { input: z.object({ id, clientId: client, collection, recordId }), output: z.object({ removed: z.boolean() }) },

  "minis.fetch": {
    input: z.object({ id, url: z.string().min(1).max(4000), method: z.string().max(10), headers: z.record(z.string().max(200), z.string().max(8000)), body: z.string().nullable(), auth: z.string().max(48).nullable() }),
    output: z.object({ status: z.number(), statusText: z.string(), headers: z.record(z.string(), z.string()), body: z.string(), url: z.string() }),
  },
  "minis.fetchLog": { input: z.object({ id }), output: z.object({ entries: z.array(fetchLogSchema) }) },
  /** BB context for capability-gated `playground.bb.*`. */
  "minis.bb.threads": { input: z.object({ id, limit: z.number().int().min(1).max(100).optional() }), output: z.object({ threads: z.array(z.object({ id: z.string(), title: z.string().nullable(), updatedAt: z.string().nullable() })) }) },
  "minis.bb.studio": {
    input: z.object({ id, query: z.string().max(200).optional(), kind: z.string().max(40).optional(), limit: z.number().int().min(1).max(100).optional() }),
    output: z.object({ items: z.array(z.object({ id: z.string(), kind: z.string(), title: z.string(), href: z.string().nullable(), updatedAt: z.number().nullable() })) }),
  },
  "minis.bb.canOpen": { input: z.object({ id }), output: ok },

  // Approvals: the dialog asks for a nonce, Approve sends it back.
  "minis.requestApproval": { input: z.object({ id }), output: z.object({ nonce: z.string(), notBefore: z.number(), expiresAt: z.number(), capabilities: z.array(z.string()), versionId: z.string() }) },
  "minis.approve": { input: z.object({ id, nonce: z.string().min(10).max(200), capabilities: z.array(z.string()).max(40) }), output: ok },
  "minis.revoke": { input: z.object({ id, capabilities: z.array(z.string()).max(40) }), output: ok },
  "minis.setSecret": { input: z.object({ id, name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/), header: z.string().regex(/^[A-Za-z0-9-]{1,64}$/), value: z.string().min(1).max(8000) }), output: ok },
  "minis.removeSecret": { input: z.object({ id, name: z.string().max(48) }), output: ok },
});
