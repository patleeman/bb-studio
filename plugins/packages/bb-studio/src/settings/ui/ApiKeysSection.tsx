import { useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../kit/format";
import { Button, Input } from "../../kit/ui/index";
import type { ApiKeys, settingsContract } from "../contract";
import { Card, Row } from "./controls";

type ApiKey = ApiKeys["keys"][number];

function KeyRow({ entry, save }: { entry: ApiKey; save(value: string | null): Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const commit = (value: string | null) => {
    setError(null);
    save(value).then(() => setDraft(""), (cause: unknown) => setError(errorMessage(cause)));
  };
  return (
    <Row label={entry.label} description={entry.description} testId={`api-key-${entry.key}`}>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <div className="flex items-center gap-1.5">
          <Input aria-label={entry.label} type="password" autoComplete="off" spellCheck={false} value={draft} placeholder={entry.set ? "Set" : "Not set"}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => { if (draft.trim()) commit(draft); }}
            onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
            className="h-8 w-56 text-sm" />
          {entry.set ? <Button type="button" size="sm" variant="outline" aria-label={`Remove ${entry.label}`} onClick={() => commit(null)}>Remove</Button> : null}
        </div>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </div>
    </Row>
  );
}

export function ApiKeysSection() {
  const rpc = useRpc<typeof settingsContract>();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    void rpc.call("settings.keys.get", null).then((answer) => setKeys(answer.keys), (cause: unknown) => setError(errorMessage(cause)));
  }, [rpc]);
  useEffect(load, [load]);
  const save = async (key: string, value: string | null) => {
    const answer = await rpc.call("settings.keys.set", { values: { [key]: value } });
    setKeys(answer.keys);
  };
  if (!keys) {
    return (
      <Card>
        <p role={error ? "alert" : "status"} className={error ? "px-4 py-3 text-sm text-destructive" : "px-4 py-3 text-sm text-muted-foreground"}>{error ?? "Loading API keys…"}</p>
      </Card>
    );
  }
  return (
    <div data-testid="studio-settings-api-keys">
      <Card>
        {keys.map((entry) => <KeyRow key={entry.key} entry={entry} save={(value) => save(entry.key, value)} />)}
      </Card>
    </div>
  );
}
