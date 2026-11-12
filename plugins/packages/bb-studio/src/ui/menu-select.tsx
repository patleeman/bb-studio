// A choice as the app's menu button, not a native <select> (UX review 3,
// item 8): "Kind All ⌄" (6f). The label is muted, the value in the ink; the
// menu marks the chosen one. Used by the Library (Kind, Group by), Search
// (Everything) and Memory (Newest).
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon } from "../kit/app/index";
import { cn } from "../kit/ui/utils";

export interface MenuChoice<T extends string> { id: T; label: string }

export function MenuSelect<T extends string>({ label, value, choices, onChange, testId, className = "" }: {
  /** Shown before the value ("Kind"); none for a choice that names itself ("Everything"). */
  label?: string;
  value: T;
  choices: readonly MenuChoice<T>[];
  onChange(value: T): void;
  testId?: string;
  className?: string;
}) {
  const current = choices.find((choice) => choice.id === value) ?? choices[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-testid={testId} data-value={value} aria-label={label ? `${label}: ${current?.label ?? ""}` : current?.label}
          className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-state-active", className)}>
          {label ? <span className="text-muted-foreground">{label}</span> : null}
          <span className="min-w-0 truncate font-medium">{current?.label}</span>
          <Icon name="ChevronDown" className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {choices.map((choice) => (
          <DropdownMenuItem key={choice.id} data-testid={testId ? `${testId}-choice` : undefined} data-value={choice.id} onSelect={() => onChange(choice.id)} className="flex items-center gap-2 text-xs">
            <span className="flex w-3.5 shrink-0 justify-center">{choice.id === value ? <Icon name="Check" className="size-3.5" /> : null}</span>
            <span className="min-w-0 flex-1 truncate">{choice.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
