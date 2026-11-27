// Strand names (engineering plan, decision 8): 1 to 4 words, a concrete
// noun phrase the user would use themselves ("Model router", "Furnace
// tune-up", "bb-plugins PR #15"). Never generic ("Discussion", "Follow-up",
// "Question"), never a sentence, unique within the conversation, and stable:
// once named, a strand keeps its name (a rename only when the user asks, in
// phase 3). `checkName` is the rule; the naming prompt carries the same rule
// with good and bad examples, and a test checks both against each other.

export const NAME_MAX_WORDS = 4;
export const NAME_MAX_CHARS = 40;
/** A provisional title, before the small model names the strand: the message's first line. */
export const FIRST_LINE_MAX = 60;

/** Words that name no particular thing. A name made only of these (and small words) is generic. */
const GENERIC = new Set([
  "discussion", "discussions", "follow-up", "followup", "follow", "up", "question", "questions", "misc", "miscellaneous",
  "chat", "chats", "conversation", "conversations", "update", "updates", "note", "notes", "task", "tasks", "work",
  "thread", "threads", "topic", "topics", "issue", "issues", "general", "other", "others", "stuff", "thing", "things",
  "help", "request", "requests", "check-in", "checkin", "status", "idea", "ideas", "untitled", "new", "strand", "bug",
  "bugs", "fix", "fixes", "review", "plan", "plans", "todo", "todos", "to-do", "item", "items", "message", "messages",
  "reply", "replies", "random", "various", "quick", "small", "minor", "info", "details", "more", "continued", "next",
  "steps", "step", "problem", "problems", "change", "changes", "project", "feedback", "summary", "admin", "ask", "asks",
]);
/** Small words that don't make a name concrete on their own. */
const SMALL = new Set(["a", "an", "the", "and", "or", "of", "for", "to", "on", "in", "with", "about", "re", "some"]);
/** Words that make a line a sentence or a request, not a name. */
const PERSONAL = new Set(["i", "i'm", "i've", "me", "my", "we", "we're", "us", "our", "you", "you're", "your", "let's", "lets", "please"]);
const SENTENCE_START = /^(?:can|could|would|should|will|do|does|did|is|are|was|were|what|why|how|when|where|who|which|please|let's|lets|hey|hi|hello|thanks|ok|okay|yes|no)\b/i;

export type NameProblem = "empty" | "too-long" | "too-many-words" | "sentence" | "generic" | "duplicate" | "markup" | "envelope";

// Host-injected envelopes: what BB, Studio or a provider puts in front of a
// turn's real text ("[bb message from thread:thr_…]", "[bb system]",
// "[bb studio]", "[bb automation due:…]", a <task-notification> block). They
// say who sent a message, never what it is about, so no strand is named from them.
const LEADING_BRACKET = /^\s*\[\s*bb\b[^\]\n]*\][ \t]*(?:\r?\n)*/iu;
const INLINE_BRACKET = /\[\s*bb\b[^\]\n]*\]/giu;
/** Tag blocks that carry no topic of their own (ids, paths, status words), dropped whole. */
const META_BLOCK = /<(system-reminder|task-id|tool-use-id|output-file|status)>[\s\S]*?<\/\1>/giu;
/** Any other host tag (<task-notification>, <summary>, <result>…): the tag goes, its text stays. */
const HOST_TAG = /<\/?(?:task-notification|summary|result|system-reminder|task-id|tool-use-id|output-file|status)>/giu;
/** A title that is (or holds) an envelope, also with its id mangled ("thread:thrkrwu3…"). */
const ENVELOPE_TITLE = /\[\s*bb\b|\bbb\s+(?:message\s+from\s+thread|automation\s+due)\b|\bthread\s*:\s*thr_?[a-z0-9]{4,}|<\/?(?:task-notification|system-reminder|summary|result|task-id|tool-use-id|output-file|status)>|^\s*\[[^\]\n]*\]\s*$/iu;

/** A turn's text with host-injected envelopes taken off: the content a title is made from. */
export function stripEnvelopes(text: string): string {
  let rest = text.replace(META_BLOCK, "").replace(HOST_TAG, "");
  for (let match = LEADING_BRACKET.exec(rest); match; match = LEADING_BRACKET.exec(rest)) rest = rest.slice(match[0].length);
  return rest.trim();
}

/** True when a title is envelope text, not a name: "[bb message from thread:…]", "[bb system]", a bare tag or bracket. */
export const looksLikeEnvelope = (title: string): boolean => ENVELOPE_TITLE.test(title);

/** Folds a name for comparing: lower case, accents and punctuation off. */
export function nameKey(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}#]+/gu, " ").trim();
}

/** Emphasis marks: * and ` anywhere, _ only at a word's edge (snake_case and thr_ ids keep theirs). */
const EDGE_MARKS = /[*`]+|(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu;

/** A name as the model or a task wrote it, tidied: quotes, markdown and a trailing period off, spaces folded. */
export function tidyName(raw: string): string {
  let name = raw.replace(EDGE_MARKS, "").replace(/^\s*(?:title|name)\s*:\s*/i, "").replace(/\s+/g, " ").trim();
  // Quotes and a trailing period, in either order ('"Model router".' and '"Model router."').
  for (let pass = 0; pass < 2; pass++) name = name.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").replace(/[.;,:]+$/, "").trim();
  return name;
}

/** What is wrong with `name` as a strand name, given the other names in the conversation; empty when it is fine. */
export function checkName(name: string, others: readonly string[] = []): NameProblem[] {
  const problems: NameProblem[] = [];
  const text = name.trim();
  if (!text) return ["empty"];
  if (looksLikeEnvelope(text)) problems.push("envelope");
  if (/[\n\r]|::|\[[^\]]*\]\(|^#+\s|[*`]/.test(text)) problems.push("markup");
  if (text.length > NAME_MAX_CHARS) problems.push("too-long");
  const words = text.split(/\s+/);
  if (words.length > NAME_MAX_WORDS) problems.push("too-many-words");
  const lower = words.map((word) => word.toLowerCase().replace(/^[^\p{L}\p{N}#]+|[^\p{L}\p{N}#'’-]+$/gu, "").replace(/’/g, "'"));
  if (/[.?!]$/.test(text) || SENTENCE_START.test(text) || lower.some((word) => PERSONAL.has(word))) problems.push("sentence");
  const meaningful = lower.filter((word) => word && !SMALL.has(word));
  if (!meaningful.length || meaningful.every((word) => GENERIC.has(word) || word.split("-").every((part) => GENERIC.has(part)))) problems.push("generic");
  const key = nameKey(text);
  if (others.some((other) => nameKey(other) === key)) problems.push("duplicate");
  return problems;
}

export const isGoodName = (name: string, others: readonly string[] = []) => checkName(name, others).length === 0;

/** A strand's title before it is named: the message's first line (envelopes off), cut to 60 characters. Never envelope text. */
export function firstLineTitle(text: string): string {
  const line = stripEnvelopes(text).split("\n").map((each) => each.replace(INLINE_BRACKET, "").replace(EDGE_MARKS, "").replace(/[#>]+/g, "").replace(/\s+/g, " ").trim()).find((each) => each && !looksLikeEnvelope(each)) ?? "";
  if (line.length <= FIRST_LINE_MAX) return line || "Untitled";
  const cut = line.slice(0, FIRST_LINE_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Good and bad names, for the prompt and the test that holds the rule and the prompt together. */
export const NAME_EXAMPLES = {
  good: ["Model router", "Furnace tune-up", "bb-plugins PR #15"],
  bad: [
    { name: "Discussion", why: "generic" },
    { name: "Follow-up questions", why: "generic" },
    { name: "Can you look at the router again?", why: "a sentence" },
  ],
} as const;

/** The naming rule, as the small model reads it. */
export const NAMING_RULES = [
  `Each strand name is 1 to ${NAME_MAX_WORDS} words: a concrete noun phrase the user would use themselves for this line of work.`,
  "Name the thing being worked on (a feature, a bug, a PR, an appliance, a trip), not the kind of talk.",
  "Never generic: no \"Discussion\", \"Follow-up\", \"Question\", \"Update\", \"Misc\", \"Task\" or \"Chat\".",
  "Never a sentence or a request: no verbs like \"Can you\", no \"I\", \"you\" or \"we\", no ending punctuation.",
  "Unique within the conversation: never reuse a name another strand has. If a new strand is the same work as an open strand, say so instead of naming it.",
  `Good: ${NAME_EXAMPLES.good.map((name) => `"${name}"`).join(", ")}.`,
  `Bad: ${NAME_EXAMPLES.bad.map((each) => `"${each.name}" (${each.why})`).join(", ")}.`,
].join("\n");
