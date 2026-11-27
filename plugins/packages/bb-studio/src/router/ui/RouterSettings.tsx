// Settings, Model router: Auto on or off, the plain-language rules with their
// ordered chains, the default chain, and a dry run ("Try").
import { experimental_ProviderModelPicker as ProviderModelPicker, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Textarea } from "../../kit/ui/index";
import { errorMessage as errorText } from "../../kit/format";
import { toReasoningLevelOrNull } from "../../kit/reasoning";
import { Card, Row, SubHeading, Switch } from "../../settings/ui/controls";
import type { rpcContract as decisionsContract } from "../../decisions/contract";
import { AUTO_ID, MAX_RULES, type Decision, type Policy, type Rule, type Target, type TargetCheck, type routerContract } from "../contract";

/** A target with no label: the label key is dropped, since an undefined value is not JSON and the RPC refuses it. */
function unlabeled<T extends { label?: string }>(target: T): Omit<T, "label"> {
  const { label: _label, ...rest } = target;
  return rest;
}

function newRuleId(rules: readonly Rule[]): string {
  let id = `rule-${rules.length + 1}`;
  for (let n = rules.length + 2; rules.some((rule) => rule.id === id); n += 1) id = `rule-${n}`;
  return id;
}

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** What Settings says beside a chain's model: why Auto skips it, or (readiness unknown) that it comes after the ready ones. */
/**
 * A chain entry after the picker reports a value, or null when nothing changed.
 * The picker reports what it shows when it opens (a null reasoning level shows
 * as "medium"), which must not rewrite the saved entry. The same model keeps
 * its label.
 */
export function pickerChange(target: Target, next: { providerId: string; model: string; reasoningLevel: string }): Target | null {
  const sameModel = next.providerId === target.providerId && next.model === target.model;
  if (sameModel && next.reasoningLevel === (target.reasoningLevel ?? "medium")) return null;
  const reasoningLevel = toReasoningLevelOrNull(next.reasoningLevel);
  return { providerId: next.providerId, model: next.model, reasoningLevel, ...(sameModel && target.label ? { label: target.label } : {}) };
}

/**
 * One chain entry's picker. The picker also reports values on its own when it
 * opens: its default reasoning level, or another provider or model when the
 * saved one isn't offered (an agent that isn't installed, a retired model).
 * Those must not rewrite the saved entry, so reports count only once the
 * person has pressed or typed in this picker.
 */
/** How soon after a press or key in a chain entry's picker its report counts as the person's pick. */
export const PICK_WINDOW_MS = 2_000;

export function TargetPicker({ target, disabled, onChange, onAuto, now = Date.now }: { target: Target; disabled: boolean; onChange(next: Target): void; onAuto(): void; now?: () => number }) {
  // When the person last pressed or typed in this picker (the open menu's events reach here through React's portal), or null.
  // A pick reports right after that press; the mark is cleared by the pick, by Escape, and by time, so a menu closed without a
  // pick leaves nothing for a later fallback report (provider states refreshing) to ride on.
  const touched = useRef<number | null>(null);
  const touch = (event: { nativeEvent: Event }) => {
    touched.current = (event.nativeEvent as KeyboardEvent).key === "Escape" ? null : now();
  };
  return (
    <span className="contents" onPointerDownCapture={touch} onKeyDownCapture={touch} data-testid="router-target-picker">
      <ProviderModelPicker
        disabled={disabled}
        align="start"
        value={{ providerId: target.providerId, model: target.model, reasoningLevel: target.reasoningLevel ?? "medium" }}
        onChange={(next) => {
          const at = touched.current;
          if (at === null || now() - at > PICK_WINDOW_MS) return;
          touched.current = null;
          if (next.providerId === AUTO_ID) return onAuto();
          const update = pickerChange(target, next);
          if (update) onChange(update);
        }}
      />
    </span>
  );
}

type Problems = ReadonlyMap<string, { problem: string | null; note?: string }>;
const problemKey = (target: Pick<Target, "providerId" | "model">) => `${target.providerId}\0${target.model}`;

function Chain({ chain, disabled, onChange, starter, problems }: { chain: readonly Target[]; disabled: boolean; onChange(next: Target[]): void; starter(): Promise<Target | null>; problems: Problems }) {
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setError(null);
    const start = chain.at(-1) ?? (await starter().catch(() => null));
    if (!start) return setError("No available provider has a model to add.");
    onChange([...chain, unlabeled(start)]);
  };
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-1.5">
        {chain.map((target, index) => (
          <li key={`${index}:${target.providerId}:${target.model}`} className="flex flex-wrap items-center gap-2" data-testid="router-chain-target">
            <span className="w-5 text-right text-xs text-muted-foreground">{index + 1}.</span>
            <TargetPicker
              target={target}
              disabled={disabled}
              onAuto={() => setError("A chain names real models, not Auto.")}
              onChange={(update) => {
                setError(null);
                onChange(chain.map((each, at) => at === index ? update : each));
              }}
            />
            <Button type="button" size="sm" variant="ghost" disabled={disabled || index === 0} aria-label="Move up" onClick={() => onChange(moved(chain, index, index - 1))}>↑</Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled || index === chain.length - 1} aria-label="Move down" onClick={() => onChange(moved(chain, index, index + 1))}>↓</Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label="Remove model" onClick={() => onChange(chain.filter((_, at) => at !== index))}>Remove</Button>
            {problems.get(problemKey(target))?.problem ? (
              <span className="text-xs text-warning" data-testid="router-target-problem">Skipped: {problems.get(problemKey(target))?.problem}</span>
            ) : problems.get(problemKey(target))?.note ? (
              <span className="text-xs text-muted-foreground" data-testid="router-target-note">{problems.get(problemKey(target))?.note}</span>
            ) : null}
          </li>
        ))}
      </ol>
      <div>
        <Button type="button" size="sm" variant="outline" disabled={disabled || chain.length >= 8} onClick={() => void add()}>Add model</Button>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function RuleText({ value, disabled, onCommit }: { value: string; disabled: boolean; onCommit(next: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Textarea
      aria-label="Rule"
      rows={2}
      value={draft}
      disabled={disabled}
      placeholder="Design, front end, anything strongly visual"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { if (draft.trim() && draft !== value) onCommit(draft.trim()); }}
    />
  );
}

function describe(decision: Decision): string {
  const rule = decision.ruleId ?? "default chain";
  const via = { jev: "Jev", model: "title AI service", default: "no answer", "no-rules": "no rules" }[decision.source];
  const confidence = decision.confidence === null ? "" : ` ${Math.round(decision.confidence * 100)}%`;
  const target = decision.target ? (decision.target.label ?? decision.target.model) : "BB's default";
  const skipped = decision.skipped.length ? ` · skipped ${decision.skipped.map((each) => `${each.target.label ?? each.target.model} (${each.why})`).join(", ")}` : "";
  const lean = decision.lean ? " · Lean tools" : "";
  const note = decision.note ? ` · ${decision.note}` : "";
  return `${rule} (${via}${confidence}, ${decision.ms} ms) → ${target}${lean}${skipped}${note}`;
}

function TryIt() {
  const rpc = useRpc<typeof routerContract>();
  const [text, setText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { setResult(describe(await rpc.call("router.explain", { text }))); } catch (cause) { setResult(errorText(cause)); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="text-sm font-medium text-foreground">Try a task</div>
      <div className="text-xs text-muted-foreground">Asks Jev, then the AI service for thread titles. Starts no thread.</div>
      <Textarea aria-label="Task" rows={2} value={text} onChange={(event) => setText(event.target.value)} placeholder="Make the onboarding screens look better" />
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="outline" disabled={busy || !text.trim()} onClick={() => void run()}>{busy ? "Asking…" : "Try"}</Button>
        {result ? <span className="text-xs text-muted-foreground" data-testid="router-try-result">{result}</span> : null}
      </div>
    </div>
  );
}

export function RouterSettingsSection() {
  const rpc = useRpc<typeof routerContract>();
  const decisions = useRpc<typeof decisionsContract>();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [problems, setProblems] = useState<Problems>(new Map());

  const check = useCallback(() => {
    void rpc.call("router.targets.check", null).then(
      (checks: TargetCheck[]) => setProblems(new Map(checks.filter((each) => each.problem || each.note).map((each) => [problemKey(each), { problem: each.problem, note: each.note }]))),
      () => setProblems(new Map()),
    );
  }, [rpc]);
  const refresh = useCallback(() => {
    setError(null);
    void rpc.call("router.policy.get", null).then(setPolicy, (cause) => setError(errorText(cause)));
    check();
  }, [rpc, check]);
  useEffect(refresh, [refresh]);

  const save = async (next: Policy) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    const previous = policy;
    setPolicy(next);
    setError(null);
    try { setPolicy(await rpc.call("router.policy.set", JSON.parse(JSON.stringify(next)) as Policy)); check(); } catch (cause) { setPolicy(previous); setError(errorText(cause)); } finally { pending.current = false; setBusy(false); }
  };
  const starter = async (): Promise<Target | null> => {
    const suggestion = await decisions.call("decisions.fallback.suggest", null);
    return suggestion ? { providerId: suggestion.providerId, model: suggestion.model, reasoningLevel: suggestion.reasoningLevel } : null;
  };

  if (!policy) return <Card><p className="px-4 py-3 text-sm text-muted-foreground">{error ?? "Loading…"}</p></Card>;
  const setRule = (index: number, rule: Rule) => void save({ ...policy, rules: policy.rules.map((each, at) => at === index ? rule : each) });

  return (
    <div className="studio-root flex flex-col gap-3" data-testid="router-settings">
      <Card>
        <Row label="Auto" description="Auto in the model pickers, and the usage-limit notice.">
          <Switch label="Auto" checked={policy.enabled} disabled={busy} onChange={(enabled) => void save({ ...policy, enabled })} />
        </Row>
        <Row label="Auto when no model is named" description="New threads that name no model: agents' workers, the CLI, automations and plugins.">
          <Switch label="Auto when no model is named" checked={policy.autoDefault} disabled={busy} onChange={(autoDefault) => void save({ ...policy, autoDefault })} />
        </Row>
      </Card>
      <Card>
        <SubHeading>Rules</SubHeading>
        {policy.rules.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No rules. Auto uses the default chain.</p> : null}
        {policy.rules.map((rule, index) => (
          <div key={rule.id} className="flex flex-col gap-2 px-4 py-3" data-testid="router-rule">
            <div className="flex items-start gap-2">
              <RuleText value={rule.text} disabled={busy} onCommit={(text) => setRule(index, { ...rule, text })} />
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void save({ ...policy, rules: policy.rules.filter((_, at) => at !== index) })}>Remove rule</Button>
            </div>
            <Chain chain={rule.chain} disabled={busy} starter={starter} problems={problems} onChange={(chain) => chain.length ? setRule(index, { ...rule, chain }) : setError("A rule needs at least one model.")} />
          </div>
        ))}
        <div className="px-4 py-3">
          <Button type="button" size="sm" variant="outline" disabled={busy || policy.rules.length >= MAX_RULES} onClick={() => void (async () => {
            const first = policy.defaultChain[0] ?? (await starter().catch(() => null));
            if (!first) return setError("No available provider has a model to add.");
            await save({ ...policy, rules: [...policy.rules, { id: newRuleId(policy.rules), text: "Describe the kind of task", chain: [unlabeled(first)] }] });
          })()}>Add rule</Button>
        </div>
      </Card>
      <Card>
        <SubHeading>Default chain</SubHeading>
        <div className="px-4 py-3">
          <Chain chain={policy.defaultChain} disabled={busy} starter={starter} problems={problems} onChange={(defaultChain) => void save({ ...policy, defaultChain })} />
        </div>
      </Card>
      <Card>
        <TryIt />
      </Card>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
