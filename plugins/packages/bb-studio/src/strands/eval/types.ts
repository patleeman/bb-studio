// The strand-sorting eval: real conversations, paraphrased (no personal
// data, made-up ids), each message hand-labeled with the strand it belongs
// to. `today` is where the live sorter filed it before this eval existed.
export interface EvalStrand { key: string; title: string; parent: string | null; summary?: string }

export interface EvalLabel {
  /** The strand key, "trunk" (about the whole conversation) or "none" (no work). */
  strand: string;
  /** Other strands the message is also about. */
  also: string[];
  /** Not scored: an empty wake that replied [PASS]. */
  skip?: boolean;
  /** Earlier turns (their seq) whose asks this message answers. */
  clears?: number[];
}

export interface EvalTurn {
  seq: number;
  at: number;
  kind: "user" | "report";
  text: string;
  /** The reply's start. */
  reply: string;
  /** The reply's last message. */
  finalReply: string;
  label: EvalLabel;
  /** Today's filing: a `today` strand id, null for none, "unsorted" when it never got an item. */
  today: string | null;
}

/** A worker of the conversation. `strand`: for one started before the window, the labeled strand it works in (its strand existed before the window, so the replay seeds it). */
export interface EvalWorker { id: string; title: string; createdAt: number; strand?: string }

export interface EvalConversation {
  id: string;
  title: string;
  strands: EvalStrand[];
  today: { id: string; title: string }[];
  workers: EvalWorker[];
  turns: EvalTurn[];
}

/** One run's filing: each turn's strands (first the main one) by seq, as label-space keys of the run's own strands. */
export interface Filing {
  /** seq -> the run's strand ids, main first; [] for none; null when it was never filed. */
  bySeq: Map<number, string[] | null>;
  /** The run's strand ids that are the whole-conversation strand. */
  trunk: Set<string>;
  /** The run's strands' parents (child id -> parent id). */
  parents: Map<string, string>;
  /** Turns (by seq) whose reply was tagged needs-you, and those still open at the end. */
  askedTurns?: Set<number>;
  openAsks?: Set<number>;
  jevCalls?: number;
  modelCalls?: number;
}
