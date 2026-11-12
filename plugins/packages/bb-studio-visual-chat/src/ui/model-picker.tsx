// The canvas's model picker: one compact control in the composer's row, and in the window's header ("Haiku 5.5
// ▾") with a menu of BB's providers and their models (canvas.models), and
// the reasoning levels of the picked model when it has more than one. A pick
// goes to canvas.setModel: the same provider changes the backing thread's
// model for its next turn; another provider starts a fresh backing thread on
// the next message (BB can't move a thread between providers), and the
// board stays.
import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { canvasContract } from "../contract";
import type { CanvasExecution, CanvasView, PickerProvider } from "../shared";
import { cn, errorMessage, Icon } from "./studio";

/** The picker's label: the model's name from the listing, else its id. */
export function modelLabel(execution: CanvasExecution | null, providers: readonly PickerProvider[] | null): string {
  if (!execution) return "Model";
  const model = providers?.find((provider) => provider.id === execution.providerId)?.models.find((each) => each.id === execution.model);
  return model?.name ?? execution.model;
}

/** What the picker shows as picked: a waiting provider switch wins over the current execution. */
export function pickedOf(canvas: Pick<CanvasView, "execution" | "pendingExecution"> | null): CanvasExecution | null {
  return canvas?.pendingExecution ?? canvas?.execution ?? null;
}

let cache: Promise<PickerProvider[]> | null = null;

/**
 * On a canvas, a pick goes to canvas.setModel. Before the first message there's
 * no canvas yet: the pick is a draft (draft/onDraft) that canvas.create uses.
 */
export function ModelPicker({ canvas, onChanged, draft, onDraft, placement = "below-end" }: { canvas: CanvasView | null; onChanged?(view: CanvasView | null): void; draft?: CanvasExecution; onDraft?(pick: CanvasExecution): void; /** Where the menu opens from the control: under it (from its right or left edge) or over it. */ placement?: "below-end" | "below-start" | "above-start" }) {
  const rpc = useRpc<typeof canvasContract>();
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<PickerProvider[] | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    cache ??= rpc.call("canvas.models", null).then((result) => result.providers as PickerProvider[]).catch((error) => { cache = null; throw error; });
    cache.then((list) => { if (live) setProviders(list); }, () => {});
    return () => { live = false; };
  }, [rpc]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", escape); };
  }, [open]);

  const picked = canvas ? pickedOf(canvas) : draft ?? null;
  const choose = async (providerId: string, model: string, reasoningLevel: string | null) => {
    if (!canvas) { onDraft?.({ providerId, model, reasoningLevel }); return; }
    setBusy(true);
    try {
      const result = await rpc.call("canvas.setModel", { threadId: canvas.threadId, providerId, model, reasoningLevel });
      onChanged?.(result.canvas as CanvasView | null);
      if (result.mode === "new-thread-next-turn") toast.message("New provider starts with the next message");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const label = modelLabel(picked, providers);
  const current = picked ? providers?.find((provider) => provider.id === picked.providerId)?.models.find((model) => model.id === picked.model) : null;
  return (
    <div ref={box} className="relative mr-1" data-canvas-model-picker>
      <button type="button" className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] hover:bg-foreground/5 hover:text-foreground disabled:opacity-60" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} disabled={busy} title={picked ? `${picked.providerId} · ${picked.model}${picked.reasoningLevel ? ` · ${picked.reasoningLevel}` : ""}` : "Pick model"} data-canvas-model={picked?.model ?? ""}>
        <span className="truncate">{label}</span>
        {picked?.reasoningLevel && current?.reasoningLevels.length ? <span className="text-muted-foreground/70">· {current.reasoningLevels.find((level) => level.id === picked.reasoningLevel)?.label ?? picked.reasoningLevel}</span> : null}
        {canvas?.pendingExecution ? <span className="text-muted-foreground/70" title="Takes effect with the next message">· next</span> : null}
        <Icon name="ChevronDown" className="size-3 shrink-0 opacity-60" />
      </button>
      {open ? (
        <div role="menu" className={cn("absolute z-30 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg", placement === "below-end" ? "right-0 top-8" : placement === "below-start" ? "left-0 top-8" : "bottom-8 left-0")} data-canvas-model-menu>
          {providers === null ? <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading models…</p> : providers.map((provider) => (
            <div key={provider.id} role="group" aria-label={provider.name} className="py-0.5">
              <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{provider.name}</div>
              {provider.error && !provider.models.length ? <p className="px-2 py-1 text-xs text-muted-foreground">{provider.error}</p> : null}
              {provider.models.map((model) => {
                const on = picked?.providerId === provider.id && picked.model === model.id;
                return (
                  <div key={model.id}>
                    <button type="button" role="menuitemradio" aria-checked={on} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-state-hover", on && "font-medium")} onClick={() => void choose(provider.id, model.id, on ? picked!.reasoningLevel : model.defaultReasoningLevel)} data-canvas-model-option={`${provider.id}/${model.id}`}>
                      <span className="w-3.5 shrink-0">{on ? <Icon name="Check" className="size-3.5" /> : null}</span>
                      <span className="min-w-0 flex-1 truncate">{model.name}</span>
                      {model.isDefault ? <span className="shrink-0 text-[11px] text-muted-foreground">default</span> : null}
                    </button>
                    {on && model.reasoningLevels.length ? (
                      <div className="flex flex-wrap gap-1 px-2 pb-1.5 pl-7" role="radiogroup" aria-label="Reasoning" data-canvas-reasoning>
                        {model.reasoningLevels.map((level) => (
                          <button key={level.id} type="button" role="radio" aria-checked={(picked!.reasoningLevel ?? model.defaultReasoningLevel) === level.id} className={cn("rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground", (picked!.reasoningLevel ?? model.defaultReasoningLevel) === level.id && "bg-foreground/10 text-foreground")} onClick={() => void choose(provider.id, model.id, level.id)}>
                            {level.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
