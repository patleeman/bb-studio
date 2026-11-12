import { useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../kit/format";
import type { skillsRegistryContract, SkillsRegistryState } from "../../skills-registry-contract";
import { Card, Row, Switch } from "./controls";

export function registryLine(state: SkillsRegistryState | null, error: string | null): string {
  if (error) return error;
  if (!state) return "Loading…";
  if (state.error) return state.error;
  if (state.pending) return "Waiting for approval";
  return state.enabled ? "On: agents and the bb CLI can search skills.sh and install from it." : "Off: search and installs from skills.sh are refused.";
}

export function SkillsRegistrySection() {
  const rpc = useRpc<typeof skillsRegistryContract>();
  const [state, setState] = useState<SkillsRegistryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    void rpc.call("skillsRegistry.state", null).then((next) => { setState(next); setError(null); }, (cause: unknown) => setError(errorMessage(cause)));
  }, [rpc]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!state?.pending) return;
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  }, [state?.pending, load]);
  const change = (enabled: boolean) => {
    void rpc.call("skillsRegistry.set", { enabled }).then((next) => { setState(next); setError(null); }, (cause: unknown) => setError(errorMessage(cause)));
  };
  if (state && !state.gated) return null;
  return (
    <Card>
      <Row label="Public skill registry" description={registryLine(state, error)} testId="skills-registry">
        <Switch label="Public skill registry" checked={!!state?.enabled} disabled={!state || state.pending} onChange={change} />
      </Row>
    </Card>
  );
}
