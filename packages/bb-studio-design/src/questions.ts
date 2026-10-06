// The question form the agent opens with design_ask: what it asks, what the
// user answers, and the one compact summary both the agent and the thread's
// timeline get ("Questions answered: …"), as in Claude Design.

export type QuestionOption = { label: string; description?: string };

export type Question =
  | { id: string; kind: "choice" | "multi"; question: string; help?: string; options: QuestionOption[]; other?: boolean }
  | { id: string; kind: "text"; question: string; help?: string; placeholder?: string }
  | { id: string; kind: "scale"; question: string; help?: string; minLabel: string; maxLabel: string };

export type QuestionForm = { title: string; intro?: string; questions: Question[] };

/** An answer: a label, labels, free text, 1–5 on a scale, or "decide" to leave it to the agent. */
export type Answer = string | string[] | number | { decide: true };
export type Answers = Record<string, Answer | undefined>;

export const DECIDE = { decide: true } as const;

function answerText(question: Question, answer: Answer | undefined): string {
  if (answer === undefined || (typeof answer === "object" && !Array.isArray(answer))) return "you decide";
  if (Array.isArray(answer)) return answer.length ? answer.join(", ") : "none";
  if (typeof answer === "number" && question.kind === "scale") return `${answer} of 5 (1 = ${question.minLabel}, 5 = ${question.maxLabel})`;
  const text = String(answer).trim();
  return text || "you decide";
}

/** One line per question, in the form's order: "- Which layout: Sidebar". */
export function summarizeAnswers(form: QuestionForm, answers: Answers): string {
  return form.questions.map((question) => `- ${question.question.trim().replace(/[?:]+$/, "")}: ${answerText(question, answers[question.id])}`).join("\n");
}
