// The applet manifest: what an applet is, which windows it opens, and which
// parts of the `window.studio` API it may call. The shell enforces the same
// rules; this copy lets the plugin reject a bad applet before the shell sees it.
import { z } from "zod";

/** The `window.studio` major version this plugin and the shell speak. */
export const APPLET_API = 1;

export const CAPABILITIES = [
  "window.normal",
  "window.panel",
  "window.overlay",
  "window.popover",
  "shortcut.global",
  "notify",
  "clipboard.read",
  "clipboard.write",
  "fs.applet",
  "open.url",
  "bb.threads.read",
  "bb.threads.tell",
  "bb.threads.spawn",
  "bb.studio.read",
  "bb.open",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** `bb.rpc:<plugin-id>:<method>`, approved one method at a time. */
const RPC_CAPABILITY = /^bb\.rpc:[a-z0-9-]+:[A-Za-z0-9._-]+$/;

export const APPLET_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

const WINDOW_KINDS = ["normal", "panel", "overlay", "popover"] as const;

const windowSchema = z
  .object({
    kind: z.enum(WINDOW_KINDS),
    width: z.number().int().min(80).max(4000).optional(),
    height: z.number().int().min(40).max(4000).optional(),
    position: z.enum(["center", "top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
  })
  .strict();

export const manifestSchema = z
  .object({
    id: z.string().regex(APPLET_ID, "lowercase letters, digits and dashes"),
    name: z.string().min(1).max(60),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "semver such as 0.1.0"),
    api: z.literal(APPLET_API),
    entry: z.string().regex(/^[A-Za-z0-9._/-]+\.html$/).default("index.html"),
    description: z.string().max(300).optional(),
    windows: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), windowSchema).default({}),
    capabilities: z
      .array(z.string().refine((c) => (CAPABILITIES as readonly string[]).includes(c) || RPC_CAPABILITY.test(c), "unknown capability"))
      .default([]),
    shortcuts: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.string().min(1)).default({}),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    for (const [name, window] of Object.entries(manifest.windows)) {
      if (!manifest.capabilities.includes(`window.${window.kind}`))
        ctx.addIssue({ code: "custom", path: ["windows", name], message: `needs the window.${window.kind} capability` });
    }
    if (Object.keys(manifest.shortcuts).length && !manifest.capabilities.includes("shortcut.global"))
      ctx.addIssue({ code: "custom", path: ["shortcuts"], message: "needs the shortcut.global capability" });
    if (manifest.entry.split("/").includes(".."))
      ctx.addIssue({ code: "custom", path: ["entry"], message: "must stay inside the applet folder" });
  });

export type AppletManifest = z.infer<typeof manifestSchema>;

export type ManifestResult = { ok: true; manifest: AppletManifest } | { ok: false; errors: string[] };

export function parseManifest(input: unknown): ManifestResult {
  const result = manifestSchema.safeParse(input);
  if (result.success) return { ok: true, manifest: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.length ? issue.path.join(".") : "manifest"}: ${issue.message}`),
  };
}

/** Capabilities in `next` that `granted` doesn't cover: these need the user's approval. */
export function newCapabilities(next: readonly string[], granted: readonly string[]): string[] {
  return next.filter((capability) => !granted.includes(capability));
}
