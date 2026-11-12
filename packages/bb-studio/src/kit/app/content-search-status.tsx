import { useEffect, useState } from "react";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";

/** Most searches answer before this; only a slow one shows that it's running. */
export const SEARCHING_DELAY_MS = 400;

/**
 * One quiet line under the search field, in the style of Studio's search
 * freshness notice: a slow content search, or one that failed with a way to
 * retry. Title matches stay listed below either way.
 */
export function ContentSearchStatus({ loading, error, retry, className }: { loading: boolean; error: string | null; retry(): void; className?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), SEARCHING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading]);
  if (error) {
    return (
      <div role="alert" className={cn("flex min-w-0 items-center gap-2 py-2 text-xs text-muted-foreground", className)}>
        <Icon name="AlertCircle" className="size-3.5 shrink-0 text-destructive" />
        <span className="min-w-0 break-words">
          <span className="text-foreground">Couldn't search inside items: {error.replace(/[.\s]+$/, "")}.</span> Showing title matches only.
        </span>
        <button type="button" className="shrink-0 rounded text-foreground underline underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2" onClick={retry}>Retry search</button>
      </div>
    );
  }
  if (!loading || !slow) return null;
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center gap-2 py-2 text-xs text-muted-foreground", className)}>
      <Icon name="Loading" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
      Searching content…
    </div>
  );
}
