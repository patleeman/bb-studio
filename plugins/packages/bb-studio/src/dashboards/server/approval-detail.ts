// The small print of a script approval, as one paragraph for BB's own
// approval dialog: the same facts Studio's dialog lays out.

export interface ScriptApprovalDetails {
  cwd: string;
  cwdIsHome: boolean;
  host: string;
  intervalSec: number;
  backgroundSec: number;
  timeoutSec: number;
  maxOutputBytes: number;
  proposedBy: { actor: string; threadTitle: string | null } | null;
}

function every(seconds: number): string {
  if (seconds % 3600 === 0) return seconds === 3600 ? "every hour" : `every ${seconds / 3600} hours`;
  if (seconds % 60 === 0) return seconds === 60 ? "every minute" : `every ${seconds / 60} minutes`;
  return `every ${seconds} seconds`;
}

export function scriptApprovalDetail(details: ScriptApprovalDetails): string {
  const lines = [
    `Runs on ${details.host}, in ${details.cwdIsHome ? "your home folder" : details.cwd}, ${every(details.intervalSec)} while the dashboard is open, and for ${Math.round(details.backgroundSec / 60)} minutes after.`,
    `Each run is stopped after ${details.timeoutSec} seconds and may print up to ${Math.round(details.maxOutputBytes / 1024)} KB.`,
  ];
  if (details.proposedBy) lines.push(`Proposed by ${details.proposedBy.actor === "agent" ? "an agent" : "you"}${details.proposedBy.threadTitle ? ` in “${details.proposedBy.threadTitle}”` : ""}.`);
  lines.push("It runs with your account's access. Allow only a command you understand.");
  return lines.join(" ");
}
