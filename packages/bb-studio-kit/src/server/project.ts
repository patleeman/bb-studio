import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** Hidden model sessions use BB's Personal project. */
export async function personalProjectId(bb: BbPluginApi): Promise<string> {
  const personal = (await bb.sdk.projects.list({ includePersonal: true })).find((project) => project.kind === "personal");
  if (!personal) throw new Error("BB's Personal project is unavailable.");
  return personal.id;
}

export async function primaryHostId(bb: BbPluginApi): Promise<string> {
  const config = await bb.sdk.system.config();
  if (!config.primaryHostId) throw new Error("BB has no primary host to run the model on.");
  return config.primaryHostId;
}
