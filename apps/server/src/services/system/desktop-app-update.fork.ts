import type { DesktopUpdateChannel } from "./desktop-update-channel.js";

export const STUDIO_NO_RELEASE_MESSAGE = "No BB Studio release found.";

export async function desktopVersionIfPending(
  read: () => Promise<{ pending: unknown }>,
  channel: Pick<DesktopUpdateChannel, "request">,
): Promise<string | null> {
  try {
    if ((await read()).pending === null) return null;
    return (await channel.request("status")).version;
  } catch {
    return null;
  }
}
