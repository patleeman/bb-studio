import { KEEP_AREA_RUNS, LINE_MAX, MAX_OPEN_ITEMS, NOW_MAX, statusFile, type Area, type AreaOutcome, type AreaRun, type AreaStatus, type OpenItem, type StatusFile } from "./contract";

export type ReportLevel = "log" | "tell" | "urgent";
export const RUN_WINDOW_MS = 30 * 60_000;
export const FRESH_SLACK_MS = 5 * 60_000;
export const MISSED_GRACE_MS = 2 * 3_600_000;
export const BROKEN_RUN = /^\s*(RUNNER PROBLEM|URGENT)\b/i;
const FLAGGED_RUN = /^\s*(DECISION)\b/i;

const RANK: Record<AreaStatus, number> = { broken: 0, flagged: 1, ok: 2, unknown: 3 };
export const statusRank = (status: AreaStatus) => RANK[status];

export const clip = (text: string, max = LINE_MAX) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

export type FileRead = { ok: true; value: StatusFile } | { ok: false; error: string };

export const MAX_FILE_BYTES = 64 * 1024;

export function readStatusFile(text: string): FileRead {
  if (text.length > MAX_FILE_BYTES) return { ok: false, error: `Larger than ${MAX_FILE_BYTES / 1024} KB` };
  let json: unknown;
  try { json = JSON.parse(text); } catch (error) { return { ok: false, error: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}` }; }
  const parsed = statusFile.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0]!;
  return { ok: false, error: `${issue.path.length ? issue.path.join(".") : "status.json"}: ${issue.message}` };
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function sinceAt(since: string | null | undefined, now: number): number | null {
  const text = (since ?? "").trim();
  if (!text) return null;
  const pick = (month: number, day: number, year?: number) => {
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    if (year !== undefined) return Date.UTC(year, month, day);
    const thisYear = new Date(now).getUTCFullYear();
    const at = Date.UTC(thisYear, month, day);
    return at > now + 86_400_000 ? Date.UTC(thisYear - 1, month, day) : at;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (m) return pick(Number(m[2]) - 1, Number(m[3]), Number(m[1]));
  m = /^(\d{1,2})[-/](\d{1,2})\b/.exec(text);
  if (m) return pick(Number(m[1]) - 1, Number(m[2]));
  m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\b/.exec(text);
  if (m && MONTHS[m[1]!.toLowerCase()] !== undefined) return pick(MONTHS[m[1]!.toLowerCase()]!, Number(m[2]));
  return null;
}

export function fileItems(file: StatusFile, now: number): OpenItem[] {
  return file.open.slice(0, MAX_OPEN_ITEMS).map((item) => ({ title: item.title, since: item.since ?? null, sinceAt: sinceAt(item.since, now), needsUser: item.needsUser, taskId: item.taskId ?? null }));
}

export function reportOutcome(level: ReportLevel, summary: string): AreaOutcome {
  if (level === "urgent" || BROKEN_RUN.test(summary)) return "broken";
  return level === "tell" ? "flagged" : "ok";
}

export type RunFacts = { state: string; byUser: boolean; runner: boolean; line: string; level: ReportLevel | null; file: AreaOutcome | null };

export function runOutcome(run: RunFacts): AreaOutcome {
  if (run.state === "failed" || /^Failed\b/.test(run.line)) return "broken";
  const reported = run.level ? reportOutcome(run.level, run.line) : null;
  if (reported === "broken") return "broken";
  if (run.file) return run.file;
  if (reported) return reported;
  if (run.byUser) return run.runner ? "broken" : "flagged";
  if (BROKEN_RUN.test(run.line)) return "broken";
  if (FLAGGED_RUN.test(run.line) || /^No report$/.test(run.line)) return "flagged";
  return "ok";
}

export function addRuns(runs: readonly AreaRun[], added: readonly AreaRun[]): AreaRun[] {
  const seen = new Set(runs.map((r) => r.taskId).filter(Boolean));
  const next = [...runs, ...added.filter((r) => !r.taskId || !seen.has(r.taskId))];
  next.sort((a, b) => b.at - a.at);
  return next.slice(0, KEEP_AREA_RUNS);
}

export type Derived = { status: AreaStatus; reason: string | null };

export function deriveStatus(area: Pick<Area, "stated" | "runs">, missed: string | null = null): Derived {
  const last = area.runs[0];
  const stated = area.stated;
  let out: Derived;
  if (last?.outcome === "broken") out = { status: "broken", reason: stated && stated.status !== "broken" && stated.at >= last.at - RUN_WINDOW_MS ? `Last run: ${last.line}` : null };
  else if (stated && (!last || stated.at >= last.at - RUN_WINDOW_MS)) out = { status: stated.status, reason: null };
  else if (last) out = { status: last.outcome, reason: null };
  else out = { status: stated?.status ?? "unknown", reason: null };
  if (missed && (out.status === "ok" || out.status === "unknown")) return { status: "flagged", reason: missed };
  return out;
}

export function sortAreas<T extends { status: AreaStatus; name: string }>(areas: T[]): T[] {
  return [...areas].sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name));
}

export function areaFolder(job: string): { dir: string; name: string } | null {
  const root = /(\/[^\s'"`]*\/areas)\/COMMON\.md/.exec(job)?.[1];
  if (!root) return null;
  const name = [...job.matchAll(/areas\/([A-Za-z0-9_-]+)\/(?:AREA|STATUS)\.md/g)].map((m) => m[1]!).find((n) => n !== "COMMON");
  return name ? { dir: `${root}/${name}`, name } : null;
}

const firstClause = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat.replace(/\.$/, "");
  const cut = flat.slice(0, max);
  const at = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(", "));
  return `${(at > max / 3 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(" "))).trim()}…`;
};

export function coversFromAreaMd(text: string, max = 160): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^Owns:/i.test(line.trim()));
  if (start < 0) return null;
  const body = [lines[start]!.trim().replace(/^Owns:\s*/i, "")];
  for (const line of lines.slice(start + 1)) {
    const t = line.trim();
    if (!t || /^[A-Z][A-Za-z ]{0,30}:/.test(t) || t.startsWith("#")) break;
    body.push(t);
  }
  const joined = body.join(" ").trim();
  return joined ? firstClause(joined, max) : null;
}

export function coversFromJob(job: string, max = 160): string {
  const sentence = job.replace(/\s+/g, " ").trim().split(/(?<=\.)\s/)[0] ?? "";
  return firstClause(sentence, max);
}

const TROUBLE = /\b(fail(?:ed|ing|s)?|errors?|no access|broken|down|stuck|unreachable|can't|cannot)\b/i;
const CALM = /\b(all ok|ok|nothing new|all clear|quiet)\b/i;

export type NotesRead = { now: string | null; open: OpenItem[]; status: AreaOutcome | null; problems: string[] };

export const BASE_USER_WORDS = ["you", "your", "user"] as const;
const PRONOUNS = new Set<string>(BASE_USER_WORDS);
const CUE = new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:for|with|to|on|ask|asks|asked|tell|tells|told|remind|reminds|reminded|need|needs|waiting\\s+on|wait\\s+for)\\s+$`, "u");
const CLAUSE_START = /(?:^|[.;:!?(\u2013\u2014]\s*|\s[-\u2013\u2014]\s+)$/u;
const ADDRESSED_AFTER = /^(?:['\u2019]s(?![\p{L}\p{N}_])|\s+\p{Ll})/u;
const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function addressesUser(text: string, words: readonly string[]): boolean {
  const clean = words.map((w) => w.trim()).filter(Boolean);
  const pronouns = clean.filter((w) => PRONOUNS.has(w.toLowerCase()));
  const whole = (list: string[], flags: string) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${list.map(escape).join("|")})(?![\\p{L}\\p{N}_])`, flags);
  if (pronouns.length && whole(pronouns, "iu").test(text)) return true;
  const names = clean.filter((w) => !PRONOUNS.has(w.toLowerCase())).map((w) => w[0]!.toLocaleUpperCase() + w.slice(1));
  if (!names.length) return false;
  for (const hit of text.matchAll(whole(names, "gu"))) {
    const before = text.slice(0, hit.index);
    const after = text.slice(hit.index + hit[0].length);
    if (CUE.test(before.toLowerCase()) || (CLAUSE_START.test(before) && ADDRESSED_AFTER.test(after))) return true;
  }
  return false;
}

export function nameWords(login: string | null | undefined, fullName: string | null | undefined): string[] {
  const out = new Set<string>(BASE_USER_WORDS);
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (/^\p{L}{2,}$/u.test(first)) out.add(first);
  const user = (login ?? "").trim();
  if (/^\p{L}{3,}$/u.test(user) && !["root", "admin", "user", "runner", "ubuntu"].includes(user.toLowerCase())) out.add(user);
  return [...out];
}

export function readStatusNotes(text: string, now: number, userWords: readonly string[] = BASE_USER_WORDS): NotesRead {
  const problems: string[] = [];
  const lines = text.split("\n");
  const lastRun = lines.find((line) => /^Last run:/i.test(line.trim()))?.trim().replace(/^Last run:\s*/i, "") ?? null;
  if (!lastRun) problems.push("no Last run line");
  const start = lines.findIndex((line) => /^##\s+Open items/i.test(line.trim()));
  const open: OpenItem[] = [];
  if (start < 0) problems.push("no Open items section");
  else {
    for (const raw of lines.slice(start + 1)) {
      const line = raw.trim();
      if (line.startsWith("## ")) break;
      if (!line || /^item\s*\|\s*since/i.test(line)) continue;
      const cells = line.replace(/^[-*]\s*/, "").split(/\s+\|\s+/).map((c) => c.trim());
      const title = cells[0] ?? "";
      if (!title) continue;
      if (cells.length < 2) problems.push(`open item without columns: ${clip(title, 60)}`);
      const since = cells[1] && cells[1] !== "-" ? cells[1].slice(0, 40) : null;
      open.push({ title: clip(title, 200), since, sinceAt: sinceAt(since, now), needsUser: cells.slice(2).some((cell) => addressesUser(cell, userWords)), taskId: null });
      if (open.length >= MAX_OPEN_ITEMS) break;
    }
  }
  const status = lastRun ? (TROUBLE.test(lastRun) ? "flagged" : CALM.test(lastRun) ? "ok" : null) : null;
  return { now: lastRun ? clip(lastRun, NOW_MAX) : null, open, status, problems };
}
