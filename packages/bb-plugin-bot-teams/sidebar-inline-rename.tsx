import { useEffect, useRef, useState } from "react";
import { message } from "./bot-ui";

export function useSidebarInlineRename({
  name,
  label,
  onSave,
}: {
  name: string;
  label: string;
  onSave: (name: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const menuRequest = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  const start = () => {
    setDraft(name);
    setError(null);
    setEditing(true);
  };
  const save = async () => {
    if (pendingRef.current) return;
    const next = draft.trim();
    if (!next) {
      setError("Name cannot be empty.");
      return;
    }
    if (next === name) {
      setEditing(false);
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await onSave(next);
      setEditing(false);
    } catch (cause) {
      setError(message(cause));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return {
    editing,
    startFromMenu: () => { menuRequest.current = true; },
    onCloseAutoFocus: (event: Event) => {
      if (!menuRequest.current) return;
      menuRequest.current = false;
      event.preventDefault();
      start();
    },
    editor: editing ? <span className="sidebar-inline-rename"
      data-sidebar-rename-editor="" aria-busy={pending}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) void save();
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}>
      <input ref={inputRef} aria-label={label} aria-invalid={!!error}
        value={draft} readOnly={pending} spellCheck={false}
        onChange={(event) => { setDraft(event.target.value); setError(null); }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
          } else if (event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }} />
      {error && <span className="sidebar-inline-rename-error" role="alert">{error}</span>}
    </span> : null,
  };
}
