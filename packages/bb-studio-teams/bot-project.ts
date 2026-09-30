import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** Bot sessions and channel threads belong to BB's protected Personal project. */
export async function personalProjectId(bb: BbPluginApi) {
  const projects = await bb.sdk.projects.list({ includePersonal: true });
  const personal = projects.find((project) => project.kind === "personal");
  if (!personal)
    throw new Error(
      "BB's Personal project is unavailable. Retry after BB has started.",
    );
  return personal.id;
}
