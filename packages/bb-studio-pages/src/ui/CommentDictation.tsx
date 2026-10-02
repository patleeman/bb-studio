import { Icon } from "@bb-studio/kit/ui";
import { ComponentsContext, type ComponentProps } from "@blocknote/react";
import { components } from "@blocknote/shadcn";
import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { dictationParagraphs, pageFieldLabel, spacedAfter, TALK_FIELD_ATTR, TALK_FIELD_LABEL_ATTR, TALK_INSERT_EVENT, toggleTalk, useTalk } from "./talk";

const PageContext = createContext({ id: "", title: "" });
const DefaultEditor = components.Comments.Editor;

function DictationEditor(props: ComponentProps["Comments"]["Editor"]) {
  return props.editable ? <EditableComment {...props} /> : <DefaultEditor {...props} />;
}

function EditableComment(props: ComponentProps["Comments"]["Editor"]) {
  const page = useContext(PageContext);
  // A draft owns its field for its whole mounted lifetime. A closed draft must
  // never deliver its transcript into a different comment or the page body.
  const draftId = useId();
  const fieldKey = `pages-comment:${page.id}:${draftId}`;
  const fieldRef = useRef<HTMLDivElement>(null);
  const talk = useTalk(fieldKey);
  const recording = talk.mode === "here";
  const working = recording && ["starting", "finalizing", "transcribing"].includes(talk.phase);
  const label = recording ? (working ? (talk.phase === "starting" ? "Starting dictation" : "Transcribing comment") : "Stop dictating comment") : "Dictate comment";

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const onInsert = (event: Event) => {
      const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
      const paragraphs = typeof text === "string" && props.editor.isEditable ? dictationParagraphs(text) : [];
      if (!paragraphs.length) return;
      event.preventDefault();
      event.stopPropagation();
      const editor = props.editor;
      const inline = editor.transact((tr) => {
        const { $from, from, to } = tr.selection;
        if (!$from.parent.isTextblock) return false;
        tr.insertText(spacedAfter($from.parent.textBetween(0, $from.parentOffset, undefined, " "), paragraphs[0]!), from, to);
        return true;
      });
      const rest = inline ? paragraphs.slice(1) : paragraphs;
      if (rest.length) {
        const inserted = editor.insertBlocks(
          rest.map((paragraph) => ({ type: "paragraph" as const, content: paragraph })),
          editor.getTextCursorPosition().block,
          "after",
        );
        editor.setTextCursorPosition(inserted[inserted.length - 1]!, "end");
      }
    };
    field.addEventListener(TALK_INSERT_EVENT, onInsert);
    return () => field.removeEventListener(TALK_INSERT_EVENT, onInsert);
  }, [props.editor]);

  return (
    <div ref={fieldRef} className="pages-comment-dictation relative" {...{ [TALK_FIELD_ATTR]: fieldKey, [TALK_FIELD_LABEL_ATTR]: `Comment on ${pageFieldLabel(page.title)}` }}>
      <DefaultEditor {...props} />
      {talk.mode !== "unavailable" && (
        <button
          type="button"
          aria-label={label}
          aria-pressed={recording}
          title={talk.mode === "elsewhere" ? "Talk is busy with another recording." : label}
          disabled={working || talk.mode === "elsewhere"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleTalk(fieldKey)}
          className="absolute right-1 bottom-1 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          <Icon name={recording && !working ? "Square" : "Mic"} className={`size-4 ${working ? "animate-pulse" : recording ? "text-red-500" : ""}`} />
        </button>
      )}
    </div>
  );
}

const commentComponents = { ...components, Comments: { ...components.Comments, Editor: DictationEditor } };

/** Override only the comment editor; keep BlockNote's formatting and actions. */
export function CommentDictation({ page, children }: { page: { id: string; title: string }; children: ReactNode }) {
  return (
    <PageContext.Provider value={page}>
      <ComponentsContext.Provider value={commentComponents}>{children}</ComponentsContext.Provider>
    </PageContext.Provider>
  );
}
