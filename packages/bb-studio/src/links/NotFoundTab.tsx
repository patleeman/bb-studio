import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { Icon } from "../kit/ui/icon";
import { isTabKindId, tabKindEntry } from "../tab-kinds";
import { NOT_FOUND_TITLE, type NotFoundParams } from "./router";

export function notFoundParams(params: JsonValue | null | undefined): NotFoundParams | null {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const { kind, id, link } = params;
  if (!isTabKindId(kind) || typeof link !== "string") return null;
  return { kind, id: typeof id === "string" ? id : null, link };
}

export function NotFoundTab({ params }: { params: JsonValue | null }) {
  const read = notFoundParams(params);
  const entry = read ? tabKindEntry(read.kind) : null;
  return (
    <div data-testid="link-not-found" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Icon name={entry?.icon ?? "Unavailable"} className="size-8 text-muted-foreground" />
      <div className="text-base font-medium">{NOT_FOUND_TITLE}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-left text-sm">
        <dt className="text-muted-foreground">Kind</dt>
        <dd>{entry?.name ?? "Unknown"}</dd>
        {read?.id ? <><dt className="text-muted-foreground">Id</dt><dd className="break-all font-mono text-xs">{read.id}</dd></> : null}
        <dt className="text-muted-foreground">Link</dt>
        <dd className="break-all font-mono text-xs">{read?.link ?? ""}</dd>
      </dl>
    </div>
  );
}
