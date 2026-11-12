// Settings that became constants on the server (the settings cleanup). A BB
// host can still override one with an environment variable. Decisions' are in
// src/decisions/settings.ts; Talk's segment length is a frontend constant
// (src/talk/ui/segmenter.ts).

const validZone = (zone: string | undefined) => {
  if (!zone?.trim()) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone.trim() }).format();
    return zone.trim();
  } catch {
    return null;
  }
};

/** Todos' time zone: STUDIO_LOOP_TIME_ZONE, else this Mac's (the BB server's), else New York. */
export function loopTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  return validZone(env.STUDIO_LOOP_TIME_ZONE) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "America/New_York";
}
