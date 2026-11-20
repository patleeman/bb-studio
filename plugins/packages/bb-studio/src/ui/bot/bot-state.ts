// What turns a Bot back on, the same word everywhere it shows (the sidebar
// header's line and ··· menu, Bot settings, the Bot page, the Info tab).

/**
 * Resume for a paused or stopped Bot; "Run here" for one a BB Studio copy
 * imported that bb still runs (inBb), as resuming it runs it on this install
 * too; null while it is active. A stopped or paused Bot always has one.
 */
export function resumeWord(bot: { state: string; inBb?: boolean } | null | undefined): string | null {
  if (!bot || bot.state === "active") return null;
  return bot.inBb ? "Run here" : "Resume";
}
