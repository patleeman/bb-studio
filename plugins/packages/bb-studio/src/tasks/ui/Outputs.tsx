import { Icon, cn } from "../../kit/ui/index";
import { clickModifiers, openLinkFromAnywhere } from "../../links/open";
import type { LinkSource } from "../../links/router";
import type { Task } from "../contract";

type Output = Task["outputs"][number];

const ICONS: Record<string, string> = { pr: "GitPullRequest", commit: "GitBranch", branch: "GitBranch", build: "Layers", release: "Layers", page: "FileText", design: "Palette", app: "AppWindow", mini: "AppWindow", file: "FileText", url: "Globe", link: "Globe" };
const REF_LINKS: [RegExp, string][] = [[/^pg_/, "page"], [/^dsn_/, "design"], [/^(mini|app)_/, "app"], [/^drw_/, "whiteboard"], [/^thr_/, "conversation"]];

export function outputLink(output: Pick<Output, "ref" | "url">): string | null {
  if (output.url && /^https?:\/\//i.test(output.url)) return output.url;
  const ref = output.ref.trim();
  if (/^https?:\/\//i.test(ref)) return ref;
  for (const [pattern, kind] of REF_LINKS) if (pattern.test(ref)) return `bb://${kind}/${encodeURIComponent(ref)}`;
  return null;
}

export function outputLabel(output: Pick<Output, "kind" | "ref" | "title">): string {
  const title = output.title?.trim();
  if (title) return title;
  const kind = output.kind.trim().toLowerCase();
  if (kind === "pr") { const n = /\/pull\/(\d+)/.exec(output.ref)?.[1] ?? /^#?(\d+)$/.exec(output.ref)?.[1]; if (n) return `PR #${n}`; }
  if (kind === "commit" && /^[0-9a-f]{7,40}$/i.test(output.ref)) return output.ref.slice(0, 10);
  return output.ref;
}

export function TaskOutputs({ outputs, className, max = 6, source = "card" }: { outputs: readonly Output[]; className?: string; max?: number; source?: LinkSource }) {
  if (!outputs.length) return null;
  const shown = outputs.slice(0, max);
  const more = outputs.length - shown.length;
  return (
    <ul data-testid="task-outputs" aria-label="Outputs" className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      {shown.map((output, i) => {
        const link = outputLink(output);
        const label = outputLabel(output);
        const icon = ICONS[output.kind.trim().toLowerCase()] ?? "FileText";
        const body = <><Icon name={icon} aria-hidden className="size-3 shrink-0" /><span className="min-w-0 truncate">{label}</span></>;
        const chip = "inline-flex h-6 max-w-64 min-w-0 items-center gap-1.5 rounded-md border border-border/80 px-2 text-xs";
        return (
          <li key={`${output.kind}:${output.ref}:${i}`} className="min-w-0">
            {link
              ? <button type="button" data-testid="task-output" data-kind={output.kind} title={`${output.kind}: ${output.ref}`} aria-label={`Open ${output.kind} ${label}`}
                onClick={(event) => void openLinkFromAnywhere(link, { source, title: label, modifiers: clickModifiers(event) })}
                className={cn(chip, "cursor-pointer text-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>{body}</button>
              : <span data-testid="task-output" data-kind={output.kind} title={`${output.kind}: ${output.ref}`} className={cn(chip, "text-muted-foreground")}>{body}</span>}
          </li>
        );
      })}
      {more > 0 ? <li className="text-xs text-subtle-foreground">+{more}</li> : null}
    </ul>
  );
}
