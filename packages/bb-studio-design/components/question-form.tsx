// The question form design_ask opens in the thread's composer, as in Claude
// Design: picks, toggles, a short answer or a 1–5 scale per question, each
// with "Decide for me". Unanswered questions are left to the agent.
import { useState } from "react";
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import { GHOST_BUTTON, PRIMARY_BUTTON, cn } from "@bb-studio/kit/app";
import { DECIDE, type Answer, type Answers, type Question, type QuestionForm } from "../src/questions";

const CHIP = "rounded-lg border px-3 py-2 text-left text-sm transition-colors";
const CHIP_ON = "border-primary bg-primary/10 text-foreground";
const CHIP_OFF = "border-border text-foreground hover:bg-state-hover";

const decided = (answer: Answer | undefined) => typeof answer === "object" && answer !== null && !Array.isArray(answer);

export function QuestionFormView({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const form = interaction.payload as unknown as QuestionForm;
  const [answers, setAnswers] = useState<Answers>({});
  const [others, setOthers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (id: string, answer: Answer | undefined) => setAnswers((current) => ({ ...current, [id]: answer }));

  /** Unanswered questions, and "Other" picks, resolved to what the agent should get. */
  function final(): Answers {
    const out: Answers = {};
    for (const question of form.questions) {
      let answer = answers[question.id];
      if (Array.isArray(answer) && answer.includes("Other")) answer = answer.map((label) => (label === "Other" ? (others[question.id]?.trim() || "Other") : label));
      if (answer === "Other") answer = others[question.id]?.trim() || DECIDE;
      out[question.id] = answer === undefined || (typeof answer === "string" && !answer.trim()) ? DECIDE : answer;
    }
    return out;
  }

  async function send(value: Answers) {
    setBusy(true);
    try {
      await submit(value as never);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio-root flex h-full max-h-[70vh] flex-col bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-4">
          <header>
            <h1 className="text-base font-semibold">{form.title}</h1>
            {form.intro ? <p className="mt-0.5 text-sm text-muted-foreground [text-wrap:pretty]">{form.intro}</p> : null}
          </header>
          {form.questions.map((question, index) => (
            <QuestionField
              key={question.id}
              number={index + 1}
              question={question}
              answer={answers[question.id]}
              other={others[question.id] ?? ""}
              onAnswer={(answer) => set(question.id, answer)}
              onOther={(text) => setOthers((current) => ({ ...current, [question.id]: text }))}
            />
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">
        <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => void cancel()}>Close</button>
        <span className="flex-1" />
        <button type="button" className={GHOST_BUTTON} disabled={busy} title="Leave every question to the agent" onClick={() => void send(Object.fromEntries(form.questions.map((question) => [question.id, DECIDE])))}>
          Skip all
        </button>
        <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => void send(final())}>Send answers</button>
      </div>
    </div>
  );
}

function QuestionField({ number, question, answer, other, onAnswer, onOther }: {
  number: number;
  question: Question;
  answer: Answer | undefined;
  other: string;
  onAnswer(answer: Answer | undefined): void;
  onOther(text: string): void;
}) {
  const decide = (
    <button type="button" aria-pressed={decided(answer)} className={cn(CHIP, "text-muted-foreground", decided(answer) ? CHIP_ON : CHIP_OFF)} onClick={() => onAnswer(decided(answer) ? undefined : DECIDE)}>
      Decide for me
    </button>
  );
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">
        <span className="mr-1.5 text-muted-foreground">{number}.</span>{question.question}
      </legend>
      {question.help ? <p className="-mt-1 text-xs text-muted-foreground">{question.help}</p> : null}
      {question.kind === "choice" || question.kind === "multi" ? (
        <div className="flex flex-wrap gap-2">
          {[...question.options, ...(question.other ? [{ label: "Other" }] : [])].map((option) => {
            const picked = question.kind === "multi" ? Array.isArray(answer) && answer.includes(option.label) : answer === option.label;
            return (
              <button
                key={option.label}
                type="button"
                aria-pressed={picked}
                className={cn(CHIP, picked ? CHIP_ON : CHIP_OFF)}
                onClick={() => {
                  if (question.kind === "choice") return onAnswer(picked ? undefined : option.label);
                  const current = Array.isArray(answer) ? answer : [];
                  onAnswer(picked ? current.filter((label) => label !== option.label) : [...current, option.label]);
                }}
              >
                <span className="block">{option.label}</span>
                {"description" in option && option.description ? <span className="block text-xs text-muted-foreground">{option.description}</span> : null}
              </button>
            );
          })}
          {decide}
        </div>
      ) : null}
      {(question.kind === "choice" && answer === "Other") || (question.kind === "multi" && Array.isArray(answer) && answer.includes("Other")) ? (
        <input autoFocus value={other} onChange={(event) => onOther(event.target.value)} placeholder="Your answer" className="h-9 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-ring" />
      ) : null}
      {question.kind === "text" ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={typeof answer === "string" ? answer : ""}
            onChange={(event) => onAnswer(event.target.value || undefined)}
            placeholder={question.placeholder ?? "Your answer"}
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-ring"
          />
          {decide}
        </div>
      ) : null}
      {question.kind === "scale" ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">{question.minLabel}</span>
          <div role="radiogroup" aria-label={question.question} className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((value) => (
              <button key={value} type="button" role="radio" aria-checked={answer === value} className={cn(CHIP, "size-9 px-0 text-center", answer === value ? CHIP_ON : CHIP_OFF)} onClick={() => onAnswer(answer === value ? undefined : value)}>
                {value}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{question.maxLabel}</span>
          {decide}
        </div>
      ) : null}
    </fieldset>
  );
}
