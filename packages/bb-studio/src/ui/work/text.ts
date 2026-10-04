// Turning machine text into reading text for the office: cron schedules as
// words, and Markdown and BB references stripped from one-line previews.

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function clock(hour: number, minute: number): string {
  const date = new Date(2000, 0, 1, hour, minute);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: minute ? "2-digit" : undefined }).format(date);
}

/**
 * "0 9 * * 1-5 (America/New_York)" → "Weekdays at 9 AM". Common shapes become
 * words; anything else becomes "On a schedule" rather than raw cron.
 */
export function describeSchedule(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.replace(/\s*\(.*\)\s*$/, "").trim();
  const named: Record<string, string> = { hourly: "Hourly", daily: "Daily", weekdays: "Weekdays", weekly: "Weekly", monthly: "Monthly" };
  if (named[text.toLowerCase()]) return named[text.toLowerCase()]!;
  const every = /^every (\d+) ?(m|min|minutes?|h|hours?)$/i.exec(text);
  if (every) return `Every ${every[1]} ${/^h/i.test(every[2]!) ? "hours" : "minutes"}`;
  const parts = text.split(/\s+/);
  if (parts.length !== 5) return "On a schedule";
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  const step = /^\*\/(\d+)$/;
  if (step.test(minute) && hour === "*") return `Every ${step.exec(minute)![1]} minutes`;
  if (/^\d+$/.test(minute) && hour === "*") return "Hourly";
  if (/^\d+$/.test(minute) && step.test(hour)) return `Every ${step.exec(hour)![1]} hours`;
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || month !== "*") return "On a schedule";
  const at = clock(Number(hour), Number(minute));
  if (dom !== "*") return /^\d+$/.test(dom) ? `Monthly on day ${dom} at ${at}` : "On a schedule";
  if (dow === "*") return `Daily at ${at}`;
  if (dow === "1-5") return `Weekdays at ${at}`;
  if (dow === "0,6" || dow === "6,0") return `Weekends at ${at}`;
  if (/^\d$/.test(dow)) return `${DAYS[Number(dow) % 7]} at ${at}`;
  return `On a schedule at ${at}`;
}

/** One-line plain text from Markdown and BB references, for previews. */
export function plainPreview(markdown: string): string {
  return markdown
    .replace(/^::[a-z-]+\{[^}]*\}\s*$/gim, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/@\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s*@thread:thr_[a-z0-9]+/gi, "")
    .replace(/\b(?:thr|tsk|pg|art|bot|brd|rec|spc)_[a-z0-9]{6,}\b/gi, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
