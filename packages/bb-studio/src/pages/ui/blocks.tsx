import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { useEffect, useState, type ReactNode } from "react";
import { PRIMARY_BUTTON, studioItemProps, studioThreadProps } from "../../kit/app/index";
import { Icon } from "../../kit/ui/index";
import { cn } from "../../kit/ui/index";
import { chartSpecSchema, parseJsonWith, SERIES_COLORS, statItemsSchema } from "../chart-spec";
import { ChartView, EXAMPLE_CHART, StatsView } from "./chart-views";
import { ThreadTitle } from "@get-bb/plugin-sdk/app";
import { calloutConfig, chartConfig, EMBED_KINDS, type EmbedKind, embedConfig, isStudioEmbed, mentionConfig, statsConfig } from "../schema-config";
import { pagePath } from "../constants";
import { codeBlockSpec } from "./code";
import { usePagesUi } from "./context";
import { HtmlBlock } from "./html";
import { MermaidBlock } from "./mermaid";
import { StudioEmbed, StudioPicker, useStudioItem } from "./studio-embeds";

// React renderers for the custom blocks. Configs come from schema-config.ts so
// the editor schema matches the server's (src/schema-server.ts).

const TONES = {
  info: { icon: "Info", className: "border-sky-500/30 bg-sky-500/8", iconClass: "text-sky-500" },
  success: { icon: "CircleCheck", className: "border-emerald-500/30 bg-emerald-500/8", iconClass: "text-emerald-500" },
  warning: { icon: "AlertTriangle", className: "border-amber-500/35 bg-amber-500/10", iconClass: "text-amber-500" },
  danger: { icon: "AlertCircle", className: "border-red-500/30 bg-red-500/8", iconClass: "text-red-500" },
} as const;
const TONE_ORDER = ["info", "success", "warning", "danger"] as const;

export { SERIES_COLORS };

const Callout = createReactBlockSpec(calloutConfig, {
  render: ({ block, editor, contentRef }) => {
    const tone = TONES[block.props.tone];
    return (
      <div className={cn("pages-callout my-1 flex w-full gap-2.5 rounded-lg border px-3 py-2.5", tone.className)}>
        <button
          type="button"
          contentEditable={false}
          title="Change callout style"
          className={cn("mt-0.5 h-5 w-5 shrink-0 cursor-pointer", tone.iconClass)}
          onClick={() => {
            const next = TONE_ORDER[(TONE_ORDER.indexOf(block.props.tone) + 1) % TONE_ORDER.length]!;
            editor.updateBlock(block, { props: { tone: next } });
          }}
        >
          <Icon name={tone.icon} className="size-4" />
        </button>
        <div className="min-w-0 flex-1" ref={contentRef} />
      </div>
    );
  },
});

/** A data block with a rendered view and a JSON source editor. */
function DataBlock({
  label,
  source,
  editable,
  onSave,
  error,
  children,
}: {
  label: string;
  source: string;
  editable: boolean;
  onSave(next: string): string | null;
  error: string | null;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  return (
    <div className="pages-data group/data relative my-1 w-full rounded-lg border border-border bg-card/50 p-3" contentEditable={false}>
      {editable && draft === null ? (
        <button
          type="button"
          className="pages-reveal absolute top-2 right-2 z-10 rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/data:opacity-100 hover:text-foreground"
          onClick={() => {
            setDraft(prettyJson(source));
            setDraftError(null);
          }}
        >
          Edit {label}
        </button>
      ) : null}
      {draft !== null ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-48 w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-xs"
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          {draftError ? <p className="text-xs text-red-500">{draftError}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-foreground px-2 py-1 text-xs text-background"
              onClick={() => {
                const problem = onSave(draft);
                if (problem) setDraftError(problem);
                else setDraft(null);
              }}
            >
              Save
            </button>
          </div>
        </div>
      ) : error ? (
        <p className="text-sm text-red-500">
          This {label} has invalid data: {error}
        </p>
      ) : (
        children
      )}
    </div>
  );
}

const prettyJson = (text: string) => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};


const ChartBlock = createReactBlockSpec(chartConfig, {
  render: ({ block, editor }) => (
    <DataBlock
      label="chart"
      source={block.props.spec || EXAMPLE_CHART}
      editable={editor.isEditable}
      error={null}
      onSave={(next) => {
        const parsed = parseJsonWith(chartSpecSchema, next);
        if (!parsed.ok) return parsed.error;
        editor.updateBlock(block, { props: { spec: JSON.stringify(parsed.value) } });
        return null;
      }}
    >
      <ChartView spec={block.props.spec} />
    </DataBlock>
  ),
});

const EXAMPLE_STATS = JSON.stringify([
  { label: "Metric", value: "42", delta: "+5%", trend: "up" },
  { label: "Another", value: "7", delta: "-1", trend: "down" },
]);

const StatsBlock = createReactBlockSpec(statsConfig, {
  render: ({ block, editor }) => {
    const source = block.props.items && block.props.items !== "[]" ? block.props.items : EXAMPLE_STATS;
    const parsed = parseJsonWith(statItemsSchema, source);
    return (
      <DataBlock
        label="stats"
        source={source}
        editable={editor.isEditable}
        error={parsed.ok ? null : parsed.error}
        onSave={(next) => {
          const result = parseJsonWith(statItemsSchema, next);
          if (!result.ok) return result.error;
          editor.updateBlock(block, { props: { items: JSON.stringify(result.value) } });
          return null;
        }}
      >
        {parsed.ok ? <StatsView items={parsed.value} /> : null}
      </DataBlock>
    );
  },
});

const EMBED_ICONS = {
  thread: "MessageSquare",
  page: "FileText",
  bookmark: "ExternalLink",
  drawing: "Palette",
  artifact: "File",
  recording: "Mic",
  mini: "AppWindow",
  item: "GridView",
} as const satisfies Record<EmbedKind, string>;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Fetches a bookmark's title, description and image once, when it has none. */
function usePreview(target: string, missing: boolean, onPreview?: (preview: { title: string; description: string; image: string }) => void) {
  const ui = usePagesUi();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!missing || !onPreview || !/^https?:\/\//.test(target)) return;
    let live = true;
    setLoading(true);
    ui.linkPreview(target)
      .then((preview) => live && (preview.title || preview.description || preview.image) && onPreview(preview))
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // Once per link: the callback changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, missing]);
  return loading;
}

function BookmarkCard({ target, title, description, image, loading, onEdit }: {
  target: string;
  title: string;
  description: string;
  image: string;
  loading: boolean;
  onEdit?: () => void;
}) {
  const ui = usePagesUi();
  const [imageFailed, setImageFailed] = useState(false);
  const host = hostOf(target).replace(/^www\./, "");
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-stretch overflow-hidden text-left"
      onClick={() => /^https?:\/\//.test(target) && ui.openUrl(target)}
      onDoubleClick={onEdit}
    >
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2.5">
        <span className={cn("line-clamp-1 text-sm font-medium text-foreground", !title && "text-muted-foreground")}>
          {title || (loading ? "Loading preview…" : host)}
        </span>
        {description ? <span className="line-clamp-2 text-xs text-muted-foreground">{description}</span> : null}
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="Globe" className="size-3 shrink-0" />
          <span className="truncate">{title ? host : target}</span>
        </span>
      </span>
      {image && !imageFailed ? (
        <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-40 shrink-0 border-l border-border object-cover max-sm:w-24" onError={() => setImageFailed(true)} />
      ) : null}
    </button>
  );
}

function EmbedView({ kind, target, title, description, image, onEdit, onPreview }: {
  kind: EmbedKind;
  target: string;
  title: string;
  description: string;
  image: string;
  onEdit?: (target: string) => void;
  onPreview?: (preview: { title: string; description: string; image: string }) => void;
}) {
  const ui = usePagesUi();
  const loading = usePreview(target, kind === "bookmark" && !title && !description && !image, onPreview);
  const [editing, setEditing] = useState(!target);
  const [draft, setDraft] = useState(target);

  if (isStudioEmbed(kind)) {
    if (editing && onEdit) {
      return (
        <StudioPicker
          kind={kind}
          onPick={(next) => {
            onEdit(next);
            setEditing(false);
          }}
          onCancel={target ? () => setEditing(false) : undefined}
        />
      );
    }
    return <StudioEmbed kind={kind} target={target} onEdit={onEdit ? () => setEditing(true) : undefined} />;
  }
  const page = kind === "page" ? ui.pages.find((candidate) => candidate.id === target) : undefined;
  const heading = title || page?.title || (kind === "bookmark" ? hostOf(target) : target) || "Embed";
  const sub = description || (kind === "bookmark" ? target : kind === "page" ? "Page" : "Thread");

  if (editing && onEdit) {
    return (
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onEdit(draft.trim());
          setEditing(false);
        }}
      >
        <input
          autoFocus
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
          placeholder={kind === "bookmark" ? "Paste a link…" : kind === "thread" ? "Thread id (thr_…)" : "Page id (pg_…)"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
        <button type="submit" className={PRIMARY_BUTTON}>
          Embed
        </button>
      </form>
    );
  }
  if (kind === "bookmark") {
    return <BookmarkCard target={target} title={title} description={description} image={image} loading={loading} onEdit={onEdit ? () => setEditing(true) : undefined} />;
  }
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center gap-3 text-left"
      onClick={() => {
        if (kind === "page") ui.openPage(target);
        else if (kind === "thread") ui.openThread(target);
        else if (/^https?:\/\//.test(target)) ui.openUrl(target);
      }}
      onDoubleClick={() => onEdit && setEditing(true)}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        {page?.icon ? <span className="text-lg">{page.icon}</span> : <Icon name={EMBED_ICONS[kind]} className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {kind === "thread" && !title && target ? <ThreadTitle threadId={target} /> : heading}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      <Icon name="ArrowUpRight" className="size-4 text-muted-foreground" />
    </button>
  );
}

const EmbedBlock = createReactBlockSpec(embedConfig, {
  // Kinds since removed (old space widgets) render as nothing.
  render: ({ block, editor }) => !(EMBED_KINDS as readonly string[]).includes(block.props.kind) ? null : (
    <div
      className={cn(
        "pages-embed my-1 w-full rounded-lg border border-border bg-card/50",
        (block.props.kind === "bookmark" && block.props.target) || isStudioEmbed(block.props.kind) ? "overflow-hidden" : "p-2",
      )}
      contentEditable={false}
    >
      <EmbedView
        kind={block.props.kind}
        target={block.props.target}
        title={block.props.title}
        description={block.props.description}
        image={block.props.image}
        onEdit={editor.isEditable ? (target) => editor.updateBlock(block, { props: { target, title: "", description: "", image: "" } }) : undefined}
        onPreview={editor.isEditable ? (preview) => editor.updateBlock(block, { props: preview }) : undefined}
      />
    </div>
  ),
});

const MENTION_ICONS = { bot: "Bot", page: "FileText", thread: "MessageSquare", date: "Calendar", agent: "AiBrain01", item: "GridView" } as const;

export function formatMentionDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

const AGENT_STATE_CLASSES: Record<string, string> = {
  starting: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  working: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  "needs input": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  replied: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-500/12 text-red-700 dark:text-red-300",
};

function MentionChip({ kind, target, label }: { kind: keyof typeof MENTION_ICONS; target: string; label: string }) {
  const ui = usePagesUi();
  const bot = kind === "bot" ? ui.bots.find((candidate) => candidate.id === target) : undefined;
  const page = kind === "page" ? ui.pages.find((candidate) => candidate.id === target) : undefined;
  const { item } = useStudioItem(kind, target);
  const text = kind === "date" ? formatMentionDate(target) : (bot?.name ?? page?.title ?? item?.title ?? label) || target;
  const href = kind === "page" ? pagePath(target) : item?.href;
  return (
    <span
      className={cn(
        "pages-mention inline-flex cursor-pointer items-center gap-1 rounded px-1 align-baseline font-medium",
        kind === "bot" ? "bg-violet-500/12 text-violet-600 dark:text-violet-300" : "bg-foreground/6 text-foreground",
        // A checklist item's agent (src/checklists.ts) shows its thread's state.
        kind === "thread" && label.startsWith("Agent · ") && AGENT_STATE_CLASSES[label.slice(8)],
      )}
      data-kind={kind}
      {...(kind === "thread"
        ? studioThreadProps(target, text)
        : studioItemProps(href ? { href, title: text, icon: kind === "page" ? MENTION_ICONS.page : item?.kindIcon } : null))}
      onClick={() => {
        if (kind === "page") ui.openPage(target);
        else if (kind === "thread") ui.openThread(target);
        else if (item) ui.openPath(item.href);
      }}
    >
      {bot ? (
        <span>{bot.avatar}</span>
      ) : page?.icon ? (
        <span>{page.icon}</span>
      ) : item?.icon ? (
        <span>{item.icon}</span>
      ) : (
        <Icon name={item?.kindIcon ?? MENTION_ICONS[kind]} className="size-3.5 opacity-70" />
      )}
      {kind === "bot" ? `@${text}` : text}
    </span>
  );
}

const Mention = createReactInlineContentSpec(mentionConfig, {
  render: ({ inlineContent }) => (
    <MentionChip kind={inlineContent.props.kind} target={inlineContent.props.target} label={inlineContent.props.label} />
  ),
});

export const pageSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: codeBlockSpec,
    mermaid: MermaidBlock(),
    html: HtmlBlock(),
    callout: Callout(),
    chart: ChartBlock(),
    stats: StatsBlock(),
    embed: EmbedBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: Mention,
  },
});

export type PageSchema = typeof pageSchema;
