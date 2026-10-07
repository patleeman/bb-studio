// One design's canvas, shown in two places: full screen in the main area
// (opened from Studio or the Designs panel) and as the Design tab in a
// thread's workbench, beside the conversation. Rounds stack newest first;
// each round's options sit in a row, each a sandboxed frame of its screen at
// the size it was designed for.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BarTitle, ICON_BUTTON, Icon, ItemHeader, cn } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { DESIGN_UPDATE_TYPE, REALTIME_CHANNEL, frameSize, designHref, screenUrl, frameKey, type CommentView, type DesignView, type RoundView, type ScreenStep, type ScreenView, isDeck } from "../src/shared";
import { Canvas, type CanvasApi } from "./canvas";
import { CommentPopover, DraftPopover, Pins, useComments, type Rect } from "./comments";
import { PlayView } from "./play-view";

/** Loads a design and follows its changes. `design` is undefined while loading and null once deleted. */
export function useDesign(designId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [design, setDesign] = useState<DesignView | null | undefined>(undefined);
  /** Only the newest load wins when changes arrive quickly. */
  const latest = useRef(0);
  const seen = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const { design: next } = await rpc.call("getDesign", { id: designId });
      if (ticket !== latest.current) return;
      seen.current = next?.updatedAt ?? 0;
      setDesign(next);
    } catch (error) {
      if (ticket === latest.current) toast.error(errorMessage(error));
    }
  }, [designId, rpc]);

  useEffect(() => { void load(); }, [load]);

  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as { type?: string; designId?: string; updatedAt?: number } | null;
    if (event?.type !== DESIGN_UPDATE_TYPE || event.designId !== designId) return;
    if (event.updatedAt !== undefined && event.updatedAt <= seen.current) return;
    void load();
  });

  const rename = useCallback((next: string) => {
    const name = next.trim();
    setDesign((current) => {
      if (!current || name === current.name.trim()) return current;
      void rpc.call("renameDesign", { id: designId, name }).catch((error) => toast.error(errorMessage(error)));
      return { ...current, name };
    });
  }, [designId, rpc]);

  return { design, rename };
}

/** The main-area view: Studio's item header over the full-screen canvas. */
export function DesignPage({ designId, backLabel, onBack }: { designId: string; backLabel: string; onBack(replace?: boolean): void }) {
  const { design, rename } = useDesign(designId);
  useEffect(() => {
    if (design !== null) return;
    toast.info("This design was deleted.");
    onBack(true);
  }, [design, onBack]);
  const name = design?.name.trim() || "Untitled design";
  const item = { title: name, href: designHref(designId) };
  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
      <ItemHeader
        thread={item}
        item={item}
        backLabel={backLabel}
        onBack={() => onBack()}
        leading={<BarTitle key={`${designId}:${name}`} title={design?.name ?? ""} label="Design name" placeholder="Untitled design" disabled={!design} onRename={rename} />}
      />
      <div className="relative min-h-0 flex-1">
        {design ? <DesignBoard design={design} /> : null}
      </div>
    </div>
  );
}

/** Comment-layer handles each option needs. */
type Layer = {
  commenting: boolean;
  register(screenId: string): (frame: HTMLIFrameElement | null) => void;
  comments: CommentView[];
  numbers: Map<string, number>;
  rects: Record<string, Record<string, Rect | null>>;
  openPin(id: string, pin: HTMLElement): void;
};

/** The canvas with its floating controls, comments and the player. */
export function DesignBoard({ design, leftTools, inThread = false }: {
  design: DesignView;
  leftTools?: ReactNode;
  /** Shown beside its conversation, so sends need no "Open chat". */
  inThread?: boolean;
}) {
  const board = useRef<HTMLDivElement>(null);
  const canvas = useRef<CanvasApi>(null);
  /** Bumped to reload every frame. */
  const [reloads, setReloads] = useState(0);
  /** The screen (and step) being played over the canvas, by id so it follows edits. */
  const [played, setPlayed] = useState<{ id: string; step: string } | null>(null);
  const playing = design.rounds.flatMap((round) => round.screens).find((screen) => screen.id === played?.id) ?? null;
  const play = (id: string, step = "") => setPlayed({ id, step });
  const newest = design.rounds[0]?.screens[0];
  /** Changes when rounds or options are added, so the canvas refits until the user moves it. */
  const fitKey = design.rounds.map((round) => `${round.round}:${round.screens.length}`).join(",");
  const comments = useComments(design, board, canvas);
  const numbers = new Map(design.comments.map((comment, index) => [comment.id, index + 1]));
  const openComment = comments.open ? design.comments.find((comment) => comment.id === comments.open!.id) : undefined;
  const layer: Layer = {
    commenting: comments.commenting,
    register: comments.register,
    comments: design.comments,
    numbers,
    rects: comments.rects,
    openPin: (id, pin) => {
      const box = board.current?.getBoundingClientRect();
      const at = pin.getBoundingClientRect();
      if (box) comments.setOpen({ id, anchor: { x: at.right - box.left, y: at.top - box.top } });
    },
  };

  return (
    <div ref={board} className="relative h-full">
    <Canvas
      api={canvas}
      fitKey={fitKey}
      leftTools={
        <>
          {leftTools}
          <button type="button" aria-label="Reload screens" title="Reload screens" className={ICON_BUTTON} onClick={() => setReloads((count) => count + 1)}>
            <Icon name="ArrowReloadHorizontal" className="size-4" />
          </button>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
          <div role="group" aria-label="Mode" className="flex items-center gap-0.5">
            <button type="button" aria-pressed={!comments.commenting} className={cn(MODE_BUTTON, !comments.commenting && MODE_ON)} onClick={() => comments.setCommenting(false)}>
              Select
            </button>
            <button type="button" aria-pressed={comments.commenting} title="Click an element on a screen to comment on it" className={cn(MODE_BUTTON, comments.commenting && MODE_ON)} onClick={() => comments.setCommenting(true)}>
              <Icon name="MessageSquare" className="size-3.5" /> Comment
              {design.comments.length ? <span className="tabular-nums text-muted-foreground">{design.comments.length}</span> : null}
            </button>
          </div>
          <ReviewStatus review={design.review} />
        </>
      }
      rightTools={
        <button
          type="button"
          disabled={!newest}
          aria-label="Present"
          title={newest ? `Present ${newest.id}` : "No screens yet"}
          className={ICON_BUTTON}
          onClick={() => newest && play(newest.id)}
        >
          <Icon name="Play" className="size-3.5" />
        </button>
      }
    >
      {!design.rounds.length ? (
        <p className="p-8 text-2xl text-muted-foreground">Screens appear here as the agent designs them.</p>
      ) : (
        <div className="flex flex-col gap-40">
          {design.rounds.map((round) => <Round key={round.round} designId={design.id} round={round} reloads={reloads} onPlay={play} layer={layer} />)}
        </div>
      )}
    </Canvas>
    {comments.draft ? <DraftPopover key={`${comments.draft.screenId}:${comments.draft.selector}`} design={design} draft={comments.draft} board={board} inThread={inThread} onClose={() => comments.setDraft(null)} /> : null}
    {openComment && comments.open ? <CommentPopover key={openComment.id} design={design} comment={openComment} number={numbers.get(openComment.id) ?? 0} anchor={comments.open.anchor} board={board} inThread={inThread} onClose={() => comments.setOpen(null)} /> : null}
    {playing && played ? <PlayView key={`${playing.id}:${played.step}:${playing.updatedAt}:${reloads}`} designId={design.id} screen={playing} step={played.step} onClose={() => setPlayed(null)} /> : null}
    </div>
  );
}

/** The latest review of the design, from the reviewer agent. */
function ReviewStatus({ review }: { review: DesignView["review"] }) {
  if (!review) return null;
  const round = review.round ? ` round ${review.round}` : "";
  const status = {
    reviewing: { icon: "Loading", text: `Reviewing${round}…`, title: `A reviewer is checking ${review.screens.join(", ")}.`, tone: "text-muted-foreground" },
    done: { icon: "Check", text: "Reviewed", title: `The reviewer found nothing to fix in ${review.screens.join(", ")}.`, tone: "text-muted-foreground" },
    needs_work: { icon: "MessageSquare", text: "Needs work", title: review.summary ?? "The reviewer sent findings to the design's thread.", tone: "text-amber-500" },
    failed: { icon: "X", text: "Review failed", title: review.summary ?? "The review didn't finish.", tone: "text-destructive" },
  }[review.state];
  return (
    <>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
      <span role="status" title={status.title} className={cn("flex h-7 items-center gap-1.5 px-2 text-xs", status.tone)}>
        <Icon name={status.icon} className={cn("size-3.5", review.state === "reviewing" && "animate-spin motion-reduce:animate-none")} />
        {status.text}
      </span>
    </>
  );
}

const MODE_BUTTON = "flex h-7 items-center gap-1.5 rounded px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground";
const MODE_ON = "bg-state-hover text-foreground";

type Play = (id: string, step?: string) => void;

function Round({ designId, round, reloads, onPlay, layer }: { designId: string; round: RoundView; reloads: number; onPlay: Play; layer: Layer }) {
  return (
    <section aria-labelledby={`round-${round.round}`} className="flex flex-col gap-16">
      <header className="flex max-w-[1600px] flex-col gap-4">
        <h2 id={`round-${round.round}`} className="text-[88px] font-semibold leading-none tracking-tight [text-wrap:balance]">
          {round.title || `Round ${round.round}`}
        </h2>
        {round.intro ? <p className="text-3xl text-muted-foreground [text-wrap:pretty]">{round.intro}</p> : null}
      </header>
      <div className="flex items-start gap-16">
        {round.screens.map((screen) => <Option key={screen.id} designId={designId} screen={screen} reloads={reloads} onPlay={onPlay} layer={layer} />)}
      </div>
    </section>
  );
}

/** One option: a single frame, or a row of frames when its prototype declares steps. */
function Option({ designId, screen, reloads, onPlay, layer }: { designId: string; screen: ScreenView; reloads: number; onPlay: Play; layer: Layer }) {
  if (!screen.steps.length) return <Frame designId={designId} screen={screen} step={null} reloads={reloads} onPlay={onPlay} layer={layer} />;
  const deck = isDeck(screen);
  return (
    <div className="flex shrink-0 flex-col gap-4">
      <div className="flex items-center gap-3 text-2xl text-muted-foreground">
        <span className="font-semibold text-foreground">{screen.id}</span>
        <span aria-hidden>·</span>
        <span className="truncate">{screen.caption || screen.title}</span>
        <span className="text-xl opacity-70">{screen.steps.length} {deck ? "slides" : "steps"}</span>
      </div>
      {/* A deck reads as a grid of slides, four to a row; a flow's steps sit in one row. */}
      <div className={deck ? "grid grid-cols-4 gap-10" : "flex items-start gap-10"}>
        {screen.steps.map((step, index) => <Frame key={step.id} designId={designId} screen={screen} step={step} index={index} reloads={reloads} onPlay={onPlay} layer={layer} />)}
      </div>
    </div>
  );
}

/** A live frame of a screen, opened at `step` when it has one. */
function Frame({ designId, screen, step, index = 0, reloads, onPlay, layer }: {
  designId: string;
  screen: ScreenView;
  step: ScreenStep | null;
  index?: number;
  reloads: number;
  onPlay: Play;
  layer: Layer;
}) {
  const { width, height } = frameSize(screen.viewport);
  const key = frameKey(screen.id, step?.id ?? "");
  const url = screenUrl(designId, screen.id, screen.updatedAt) + (step ? `#${encodeURIComponent(step.id)}` : "");
  const label = step ? `${index + 1} · ${step.label}` : screen.caption || screen.title;
  return (
    <figure id={key} className="flex shrink-0 flex-col gap-4" style={{ width }}>
      <figcaption className="flex items-center gap-3 text-2xl text-muted-foreground">
        {step ? null : <><span className="font-semibold text-foreground">{screen.id}</span><span aria-hidden>·</span></>}
        <span className={cn("min-w-0 flex-1 truncate", step && "text-foreground")} title={label}>{label}</span>
        <button type="button" title={`Play ${step ? `${screen.id} from ${step.label}` : screen.id}`} onClick={() => onPlay(screen.id, step?.id)} className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border-2 border-border px-3 py-1 font-mono text-lg uppercase tracking-wide hover:bg-state-hover hover:text-foreground">
          <Icon name="Play" className="size-5" /> Play
        </button>
      </figcaption>
      <div className="relative" style={{ width, height }}>
        <div className="h-full overflow-hidden rounded-[28px] bg-white shadow-[0_0_0_2px_oklch(1_0_0/0.06),0_24px_64px_oklch(0_0_0/0.35)]">
          {/* Live: click and type right on the canvas. Gestures it doesn't use pan the canvas (see the screen script). */}
          <iframe
            ref={layer.register(key)}
            key={reloads}
            title={`Screen ${screen.id}${step ? `, ${step.label}` : ""}`}
            src={url}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            className={cn("border-0", layer.commenting && "cursor-crosshair")}
            style={{ width, height }}
          />
        </div>
        <Pins comments={layer.comments.filter((comment) => frameKey(comment.screenId, comment.step) === key)} numbers={layer.numbers} rects={layer.rects[key]} onOpen={layer.openPin} />
      </div>
    </figure>
  );
}
