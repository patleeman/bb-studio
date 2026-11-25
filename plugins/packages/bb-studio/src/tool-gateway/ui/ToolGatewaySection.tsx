// Settings › Studio › Tool Gateway: the MCP servers agents can use, what
// agents asked for, each server's page (tools, test, sign-in, log), which
// providers get the tools, and the import from Agent Plugins. Every change
// needs BB Studio's app window (api.ts); elsewhere the page is read-only.
import { useCallback, useEffect, useRef, useState } from "react";
import { visiblePoll } from "../../kit/app/visible-poll";
import { errorMessage, plural, relativeTime } from "../../kit/format";
import { Button, Input, Textarea } from "../../kit/ui/index";
import { Card, Row, Segmented, SubHeading, Switch } from "../../settings/ui/controls";
import type { ImportPreview, ProviderView, RequestView, ServerInput, ServerView, ToolGatewaySnapshot } from "../contract";
import { parseMcpServersJson } from "../paste";
import { bytes, call, canChange, KIND_LABEL, READ_ONLY_NOTE, STATUS_LABEL } from "./api";

export const TOOL_GATEWAY_SECTION_ANCHOR = "studio-settings-tool-gateway";
const POLL_MS = 3_000;

type Busy = (action: () => Promise<unknown>) => Promise<void>;

function useBusy(onDone: () => void): { busy: boolean; error: string | null; run: Busy; clear(): void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run: Busy = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, clear: () => setError(null) };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p role="alert" className="px-4 py-2 text-xs text-destructive">{error}</p> : null;
}

// ── Add or edit a server ───────────────────────────────────────────────

type Kind = ServerInput["kind"] | "paste";
interface SecretRow { name: string; value: string; stored: boolean }
interface FormState {
  id: string;
  label: string;
  kind: Kind;
  command: string;
  args: string;
  cwd: string;
  url: string;
  env: SecretRow[];
  headers: SecretRow[];
  timeoutSeconds: string;
  paste: string;
}

export function formFromServer(server: ServerView): FormState {
  return {
    id: server.id, label: server.label, kind: server.kind, command: server.command ?? "", args: server.args.join("\n"), cwd: server.cwd ?? "", url: server.url ?? "",
    env: server.envNames.map((name) => ({ name, value: "", stored: true })), headers: server.headerNames.map((name) => ({ name, value: "", stored: true })),
    timeoutSeconds: String(Math.round(server.callTimeoutMs / 1000)), paste: "",
  };
}

export function formFromRequest(request: RequestView): FormState {
  return {
    id: request.name, label: request.label, kind: request.kind, command: request.command ?? "", args: request.args.join("\n"), cwd: "", url: request.url ?? "",
    env: request.envNames.map((name) => ({ name, value: "", stored: false })), headers: request.headerNames.map((name) => ({ name, value: "", stored: false })),
    timeoutSeconds: "60", paste: "",
  };
}

const emptyForm = (): FormState => ({ id: "", label: "", kind: "stdio", command: "", args: "", cwd: "", url: "", env: [], headers: [], timeoutSeconds: "60", paste: "" });

/** The form as the RPC takes it. A stored secret left blank is sent as null: keep the value already stored. */
export function inputFromForm(form: FormState): ServerInput {
  if (form.kind === "paste") throw new Error("Read the pasted block first.");
  const secrets = (rows: SecretRow[]) => Object.fromEntries(rows.filter((row) => row.name.trim()).map((row) => [row.name.trim(), row.stored && row.value === "" ? null : row.value]));
  const seconds = Number(form.timeoutSeconds);
  const base = { id: form.id.trim(), label: form.label.trim() || form.id.trim(), kind: form.kind, ...(Number.isFinite(seconds) && seconds > 0 ? { callTimeoutMs: Math.round(seconds * 1000) } : {}) };
  if (form.kind === "stdio") {
    return { ...base, command: form.command.trim(), args: form.args.split("\n").map((arg) => arg.trimEnd()).filter((arg) => arg.length > 0), cwd: form.cwd.trim() || null, env: secrets(form.env) };
  }
  return { ...base, url: form.url.trim(), headers: secrets(form.headers) };
}

function SecretRows({ label, rows, onChange, disabled }: { label: string; rows: SecretRow[]; onChange(rows: SecretRow[]): void; disabled: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {rows.map((row, index) => (
        <div key={index} className="flex gap-2">
          <Input aria-label={`${label} name`} className="w-48 font-mono text-xs" value={row.name} disabled={disabled || row.stored} placeholder="NAME"
            onChange={(event) => onChange(rows.map((each, at) => (at === index ? { ...each, name: event.target.value } : each)))} />
          <Input aria-label={`${row.name || label} value`} type="password" autoComplete="off" className="flex-1 font-mono text-xs" value={row.value} disabled={disabled}
            placeholder={row.stored ? "Set" : "Value"} onChange={(event) => onChange(rows.map((each, at) => (at === index ? { ...each, value: event.target.value } : each)))} />
          <Button size="sm" variant="ghost" disabled={disabled} aria-label={`Remove ${row.name || label}`} onClick={() => onChange(rows.filter((_, at) => at !== index))}>Remove</Button>
        </div>
      ))}
      <div><Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange([...rows, { name: "", value: "", stored: false }])}>Add</Button></div>
    </div>
  );
}

function ServerForm({ initial, mode, requestId, onDone, onCancel }: { initial: FormState; mode: "add" | "edit"; requestId?: string; onDone(): void; onCancel(): void }) {
  const [form, setForm] = useState<FormState>(initial);
  const [pasted, setPasted] = useState<ReturnType<typeof parseMcpServersJson> | null>(null);
  const { busy, error, run } = useBusy(onDone);
  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));
  const usePasted = (server: ReturnType<typeof parseMcpServersJson>[number]) => {
    setForm({
      ...form, id: server.id, label: form.label || server.id, kind: server.kind, command: server.command ?? "", args: (server.args ?? []).join("\n"), cwd: server.cwd ?? "", url: server.url ?? "",
      env: Object.entries(server.env ?? {}).map(([name, value]) => ({ name, value, stored: false })),
      headers: Object.entries(server.headers ?? {}).map(([name, value]) => ({ name, value, stored: false })),
    });
    setPasted(null);
  };
  const readPaste = () => {
    try {
      const servers = parseMcpServersJson(form.paste);
      if (servers.length === 1) usePasted(servers[0]!);
      else setPasted(servers);
    } catch (cause) {
      setPasted(null);
      void run(async () => { throw cause; });
    }
  };
  const save = () => run(async () => {
    const server = inputFromForm(form);
    if (mode === "add") await call("toolGateway.addServer", { server, ...(requestId ? { requestId } : {}) });
    else await call("toolGateway.editServer", { server });
  });
  const kinds = mode === "add" ? [{ value: "stdio" as const, label: "Command" }, { value: "streamable-http" as const, label: "HTTP" }, { value: "sse" as const, label: "SSE" }, { value: "paste" as const, label: "Paste JSON" }]
    : [{ value: "stdio" as const, label: "Command" }, { value: "streamable-http" as const, label: "HTTP" }, { value: "sse" as const, label: "SSE" }];
  return (
    <Card>
      <SubHeading>{mode === "add" ? (requestId ? `Approve ${initial.label || initial.id}` : "Add server") : `Edit ${initial.label}`}</SubHeading>
      <div className="flex flex-col gap-3 px-4 py-3" data-testid="tool-gateway-form">
        <Segmented label="Server kind" value={form.kind} options={kinds} onChange={(kind) => set({ kind })} disabled={busy} />
        {form.kind === "paste" ? (
          <>
            <Textarea aria-label="mcpServers JSON" className="min-h-32 font-mono text-xs" value={form.paste} onChange={(event) => set({ paste: event.target.value })} placeholder={'{ "mcpServers": { … } }'} />
            <div><Button size="sm" variant="outline" disabled={busy || !form.paste.trim()} onClick={readPaste}>Read</Button></div>
            {pasted ? (
              <ul className="flex flex-col gap-1 text-sm">
                {pasted.map((server) => (
                  <li key={server.id} className="flex items-center gap-2">
                    <span className="flex-1 font-mono text-xs">{server.id} · {KIND_LABEL[server.kind]}</span>
                    <Button size="sm" variant="outline" onClick={() => usePasted(server)}>Use</Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex gap-2">
              <Input aria-label="Id" className="w-48 font-mono text-xs" value={form.id} disabled={busy || mode === "edit"} placeholder="id" onChange={(event) => set({ id: event.target.value })} />
              <Input aria-label="Name" className="flex-1" value={form.label} disabled={busy} placeholder="Name" onChange={(event) => set({ label: event.target.value })} />
            </div>
            {form.kind === "stdio" ? (
              <>
                <Input aria-label="Command" className="font-mono text-xs" value={form.command} disabled={busy} placeholder="Absolute path, or a command on PATH (npx, uvx)" onChange={(event) => set({ command: event.target.value })} />
                <Textarea aria-label="Arguments, one per line" className="min-h-16 font-mono text-xs" value={form.args} disabled={busy} placeholder="Arguments, one per line; tokens go in Environment" onChange={(event) => set({ args: event.target.value })} />
                <Input aria-label="Working folder" className="font-mono text-xs" value={form.cwd} disabled={busy} placeholder="Working folder (absolute; empty for its own folder)" onChange={(event) => set({ cwd: event.target.value })} />
                <SecretRows label="Environment" rows={form.env} disabled={busy} onChange={(env) => set({ env })} />
              </>
            ) : (
              <>
                <Input aria-label="URL" className="font-mono text-xs" value={form.url} disabled={busy} placeholder="https://…" onChange={(event) => set({ url: event.target.value })} />
                <SecretRows label="Headers" rows={form.headers} disabled={busy} onChange={(headers) => set({ headers })} />
              </>
            )}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Call timeout
              <Input aria-label="Call timeout in seconds" className="w-20" value={form.timeoutSeconds} disabled={busy} onChange={(event) => set({ timeoutSeconds: event.target.value })} />
              seconds
            </label>
          </>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button size="sm" disabled={busy || form.kind === "paste"} onClick={() => void save()}>{busy ? "Saving…" : mode === "add" ? (requestId ? "Approve" : "Add and approve") : "Save and approve"}</Button>
        </div>
      </div>
      <ErrorLine error={error} />
    </Card>
  );
}

// ── A server's page ────────────────────────────────────────────────────

type Detail = Awaited<ReturnType<typeof call<"toolGateway.server">>>;

function TestTool({ serverId, tool, schema }: { serverId: string; tool: string; schema: Record<string, unknown> }) {
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState<{ ok: boolean; text: string; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const run = async () => {
    let parsed: unknown;
    try { parsed = JSON.parse(args); } catch { setParseError("Not valid JSON."); return; }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) { setParseError("Arguments must be a JSON object."); return; }
    setParseError(null);
    setBusy(true);
    try {
      const answer = await call("toolGateway.testTool", { id: serverId, tool, args: parsed as Record<string, unknown> });
      setResult({ ok: answer.ok, text: answer.error ?? JSON.stringify(answer.result, null, 2), ms: answer.ms });
    } catch (cause) {
      setResult({ ok: false, text: errorMessage(cause), ms: 0 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 py-2" data-testid="tool-gateway-test">
      <details className="text-xs text-muted-foreground"><summary>Input schema</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono">{JSON.stringify(schema, null, 2)}</pre></details>
      <Textarea aria-label={`Arguments for ${tool}`} className="min-h-20 font-mono text-xs" value={args} onChange={(event) => setArgs(event.target.value)} />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void run()}>{busy ? "Running…" : "Run"}</Button>
        {parseError ? <span className="text-xs text-destructive">{parseError}</span> : null}
        {result ? <span className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{result.ok ? `OK · ${result.ms} ms` : `Failed · ${result.ms} ms`}</span> : null}
      </div>
      {result ? <pre className="max-h-64 overflow-auto rounded border border-border bg-muted/30 p-2 font-mono text-xs whitespace-pre-wrap">{result.text}</pre> : null}
    </div>
  );
}

function ServerPage({ id, writable, onChanged, onEdit, onClose }: { id: string; writable: boolean; onChanged(): void; onEdit(server: ServerView): void; onClose(): void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [signInUrl, setSignInUrl] = useState<string | null>(null);
  const [callback, setCallback] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const mounted = useRef(true);
  const load = useCallback(() => {
    void call("toolGateway.server", { id }).then(
      (next) => { if (mounted.current) setDetail(next); },
      (cause) => { if (mounted.current) setLoadError(errorMessage(cause)); },
    );
  }, [id]);
  useEffect(() => {
    mounted.current = true;
    load();
    const stop = visiblePoll(load, POLL_MS);
    return () => { mounted.current = false; stop(); };
  }, [load]);
  const { busy, error, run } = useBusy(() => { load(); onChanged(); });
  if (!detail) return <Card><ErrorLine error={loadError} />{loadError ? null : <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>}</Card>;
  const server = detail.server;
  const facts = [KIND_LABEL[server.kind], STATUS_LABEL[server.status], plural(server.tools, "tool"), bytes(server.memoryBytes), server.approvedAt ? `approved ${relativeTime(server.approvedAt)}` : null].filter(Boolean).join(" · ");
  return (
    <Card>
      <SubHeading>{server.label}</SubHeading>
      <Row label="Status" description={<>{facts}{server.lastError ? <span className="block text-destructive">{server.lastError}</span> : null}</>} testId="tool-gateway-server-status">
        {writable && server.status === "needs-approval" ? <Button size="sm" disabled={busy} onClick={() => void run(() => call("toolGateway.approve", { id }))}>Approve</Button> : null}
        {writable && server.toolsChanged ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => call("toolGateway.approve", { id }))}>Accept tool changes</Button> : null}
        <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
      </Row>
      <Row label={server.kind === "stdio" ? "Command" : "URL"} description={<span className="font-mono">{server.kind === "stdio" ? [server.command, ...server.args].join(" ") : server.url}</span>}>
        {writable ? <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(server)}>Edit</Button> : null}
      </Row>
      {server.envNames.length || server.headerNames.length ? (
        <Row label={server.kind === "stdio" ? "Environment" : "Headers"} description={<span className="font-mono">{[...server.envNames, ...server.headerNames].map((name) => `${name} = •••`).join(", ")}</span>} />
      ) : null}
      {server.signIn !== "none" ? (
        <Row label="Sign-in" description={server.signIn === "signed-in" ? "Signed in" : server.signIn === "signing-in" ? "Signing in" : "Signed out"} testId="tool-gateway-sign-in">
          {writable && server.signIn !== "signed-in" ? <Button size="sm" disabled={busy} onClick={() => void run(async () => {
            const { url } = await call("toolGateway.signIn", { id });
            setSignInUrl(url);
            if (url) window.open(url, "_blank", "noopener");
          })}>Sign in</Button> : null}
          {writable && server.signIn === "signed-in" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => call("toolGateway.signOut", { id }))}>Sign out</Button> : null}
        </Row>
      ) : null}
      {writable && signInUrl ? (
        <div className="flex gap-2 px-4 py-3">
          <Input aria-label="Callback URL" className="flex-1 font-mono text-xs" value={callback} placeholder="Paste the address the browser ended on" onChange={(event) => setCallback(event.target.value)} />
          <Button size="sm" disabled={busy || !callback.trim()} onClick={() => void run(async () => { await call("toolGateway.finishSignIn", { id, callbackUrl: callback.trim() }); setSignInUrl(null); setCallback(""); })}>Finish</Button>
        </div>
      ) : null}
      <Row label="On" description={server.projects ? `Projects: ${server.projects.join(", ")}` : "All projects"}>
        <Switch label={`${server.label} on`} checked={server.enabled} disabled={!writable || busy} onChange={(enabled) => void run(() => call("toolGateway.setEnabled", { id, enabled }))} />
      </Row>
      <SubHeading>Tools</SubHeading>
      {detail.tools.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">{server.status === "running" ? "No tools" : "Tools show once the server has run"}</p> : null}
      {detail.tools.map((tool) => (
        <div key={tool.name} className="px-4 py-2" data-testid="tool-gateway-tool">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-sm text-foreground">{tool.name}{tool.added ? <span className="ml-2 text-xs text-muted-foreground">New</span> : null}</div>
              <div className="truncate text-xs text-muted-foreground">{tool.description}</div>
            </div>
            {writable ? <Button size="sm" variant="ghost" onClick={() => setTesting(testing === tool.name ? null : tool.name)}>{testing === tool.name ? "Hide test" : "Test"}</Button> : null}
            <Switch label={`${tool.name} on`} checked={tool.enabled} disabled={!writable || busy} onChange={(enabled) => void run(() => call("toolGateway.setToolEnabled", { id, tool: tool.name, enabled }))} />
          </div>
          {testing === tool.name ? <TestTool serverId={id} tool={tool.name} schema={tool.inputSchema} /> : null}
        </div>
      ))}
      {detail.removedTools.length ? <p className="px-4 py-2 text-xs text-muted-foreground">Removed since approval: {detail.removedTools.join(", ")}</p> : null}
      <details className="px-4 py-3" data-testid="tool-gateway-log">
        <summary className="cursor-pointer text-sm font-medium text-foreground">Log · {plural(detail.log.length, "line")}</summary>
        <pre className="mt-2 max-h-72 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {detail.log.map((line) => `${new Date(line.at).toLocaleTimeString()}  ${line.kind}  ${line.text}`).join("\n")}
        </pre>
      </details>
      {writable ? (
        <Row label="Remove server">
          {confirmRemove ? (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => void run(async () => { await call("toolGateway.remove", { id }); onClose(); })}>Remove</Button>
            </>
          ) : <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove…</Button>}
        </Row>
      ) : null}
      <ErrorLine error={error} />
    </Card>
  );
}

// ── Providers ──────────────────────────────────────────────────────────

function Providers({ providers, servers, writable, onChanged }: { providers: ProviderView[]; servers: ServerView[]; writable: boolean; onChanged(): void }) {
  const { busy, error, run } = useBusy(onChanged);
  const set = (provider: ProviderView, patch: Partial<Pick<ProviderView, "access" | "servers">>) =>
    run(() => call("toolGateway.setProvider", { providerId: provider.id, access: patch.access ?? provider.access, servers: patch.servers ?? provider.servers }));
  return (
    <Card>
      <SubHeading>Providers</SubHeading>
      {providers.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No providers</p> : null}
      {providers.map((provider) => (
        <div key={provider.id} data-testid={`tool-gateway-provider-${provider.id}`}>
          <Row label={provider.name} description={!provider.access ? "No access" : provider.servers === "all" ? "All approved servers" : `${plural(provider.servers.length, "server")}: ${provider.servers.join(", ") || "none"}`}>
            {provider.access ? (
              <Segmented label={`${provider.name} servers`} disabled={!writable || busy} value={provider.servers === "all" ? "all" : "picked"}
                options={[{ value: "all", label: "All" }, { value: "picked", label: "Picked" }]}
                onChange={(value) => void set(provider, { servers: value === "all" ? "all" : servers.filter((server) => server.approved).map((server) => server.id) })} />
            ) : null}
            <Switch label={`${provider.name} access`} checked={provider.access} disabled={!writable || busy} onChange={(access) => void set(provider, { access })} />
          </Row>
          {provider.access && provider.servers !== "all" ? (
            <ul className="flex flex-wrap gap-3 px-4 pb-3 sm:pl-8">
              {servers.map((server) => {
                const picked = (provider.servers as string[]).includes(server.id);
                return (
                  <li key={server.id} className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" aria-label={`${provider.name}: ${server.label}`} checked={picked} disabled={!writable || busy}
                      onChange={(event) => void set(provider, { servers: event.target.checked ? [...(provider.servers as string[]), server.id] : (provider.servers as string[]).filter((each) => each !== server.id) })} />
                    {server.label}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ))}
      <ErrorLine error={error} />
    </Card>
  );
}

// ── Import from Agent Plugins ──────────────────────────────────────────

export function ImportPanel({ writable, onChanged, onClose }: { writable: boolean; onChanged(): void; onClose(): void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ imported: string[]; skipped: { id: string; reason: string }[] } | null>(null);
  const [removed, setRemoved] = useState(false);
  const load = useCallback(() => {
    void call("toolGateway.importPreview", null).then((next) => {
      setPreview(next);
      setPicked(new Set(next.servers.filter((server) => !server.exists && !server.needsNewCommand).map((server) => server.id)));
    }, () => setPreview({ source: null, servers: [], skills: [], oldPluginInstalled: false }));
  }, []);
  useEffect(load, [load]);
  const { busy, error, run } = useBusy(() => { load(); onChanged(); });
  if (!preview) return <Card><p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p></Card>;
  return (
    <Card>
      <SubHeading>Import from Agent Plugins{preview.source === "bb" ? " in bb" : ""}</SubHeading>
      {preview.servers.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No servers to import</p> : null}
      <ul className="flex flex-col divide-y divide-border" data-testid="tool-gateway-import">
        {preview.servers.map((server) => {
          const blocked = server.exists ? "Already here" : server.needsNewCommand ? `Needs a new command: ${server.needsNewCommand}` : null;
          const details = [KIND_LABEL[server.kind], server.kind === "stdio" ? [server.command, ...server.args].join(" ") : server.url, server.cwd ? `in ${server.cwd}` : null, ...server.envNames.map((name) => `${name} = •••`), ...server.headerNames.map((name) => `${name}: •••`)].filter(Boolean).join(" · ");
          const state = [server.wasApproved ? "approved" : "not approved", server.wasEnabled ? "on" : "off", server.oauth ? "sign in again" : null].filter(Boolean).join(" · ");
          return (
            <li key={server.id} className="flex items-start gap-2 px-4 py-2">
              <input type="checkbox" className="mt-1" aria-label={`Import ${server.label}`} disabled={!writable || busy || blocked !== null} checked={picked.has(server.id)}
                onChange={(event) => { const next = new Set(picked); if (event.target.checked) next.add(server.id); else next.delete(server.id); setPicked(next); }} />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-foreground">{server.label} <span className="text-xs text-muted-foreground">· was {state}</span></div>
                <div className="truncate font-mono text-xs text-muted-foreground">{details}</div>
                {blocked ? <div className="text-xs text-destructive">{blocked}</div> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {preview.skills.length ? <p className="px-4 py-2 text-xs text-muted-foreground">Skills not imported: {preview.skills.join(", ")}</p> : null}
      {preview.source === "bb" && !result ? <p className="px-4 py-2 text-xs text-muted-foreground" data-testid="tool-gateway-import-once">The staged copy is deleted after the import; other servers need staging again.</p> : null}
      {result ? <p role="status" className="px-4 py-2 text-xs text-muted-foreground">Imported {plural(result.imported.length, "server")}{result.skipped.length ? `; skipped ${result.skipped.map((each) => `${each.id} (${each.reason})`).join(", ")}` : ""}</p> : null}
      <div className="flex flex-wrap gap-2 px-4 py-3">
        <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
        {writable && !result ? <Button size="sm" disabled={busy || picked.size === 0} onClick={() => void run(async () => setResult(await call("toolGateway.import", { servers: preview.servers.filter((server) => picked.has(server.id)).map((server) => ({ id: server.id, digest: server.digest })) })))}>{busy ? "Importing…" : `Import ${plural(picked.size, "server")}`}</Button> : null}
        {writable && !result && preview.source === "bb" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { await call("toolGateway.discardImport", null); onClose(); })}>Discard</Button> : null}
        {writable && result && preview.oldPluginInstalled && !removed ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { await call("toolGateway.removeOldPlugin", null); setRemoved(true); })}>Remove Agent Plugins and its data</Button>
        ) : null}
      </div>
      <ErrorLine error={error} />
    </Card>
  );
}

// ── The section ────────────────────────────────────────────────────────

const IMPORT_EVENT = "studio-tool-gateway-import";
let importRequested = false;
/** Opens the import list (Bring things over): now if the section is showing, or when it next mounts. */
export function requestToolGatewayImport(): void {
  importRequested = true;
  globalThis.dispatchEvent?.(new Event(IMPORT_EVENT));
}

export function ToolGatewaySection() {
  const [snapshot, setSnapshot] = useState<ToolGatewaySnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writable, setWritable] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ initial: FormState; mode: "add" | "edit"; requestId?: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importKey, setImportKey] = useState(0);
  const mounted = useRef(true);
  const refresh = useCallback(() => {
    void call("toolGateway.snapshot", null).then(
      (next) => { if (mounted.current) { setSnapshot(next); setLoadError(null); } },
      (cause) => { if (mounted.current) setLoadError(errorMessage(cause)); },
    );
  }, []);
  useEffect(() => {
    mounted.current = true;
    void canChange().then((next) => { if (mounted.current) setWritable(next); });
    refresh();
    const stop = visiblePoll(refresh, POLL_MS);
    const openImport = () => {
      if (!importRequested) return;
      importRequested = false;
      setImporting(true);
      setImportKey((key) => key + 1);
      refresh();
      document.getElementById(TOOL_GATEWAY_SECTION_ANCHOR)?.scrollIntoView?.({ block: "start" });
    };
    openImport();
    globalThis.addEventListener?.(IMPORT_EVENT, openImport);
    return () => {
      mounted.current = false;
      stop();
      globalThis.removeEventListener?.(IMPORT_EVENT, openImport);
    };
  }, [refresh]);
  const { busy, error, run } = useBusy(refresh);

  if (!snapshot) {
    return <div id={TOOL_GATEWAY_SECTION_ANCHOR}><Card>{loadError ? <><ErrorLine error={loadError} /><div className="px-4 pb-3"><Button size="sm" variant="outline" onClick={refresh}>Retry</Button></div></> : <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>}</Card></div>;
  }
  const done = () => { setForm(null); refresh(); };
  return (
    <div id={TOOL_GATEWAY_SECTION_ANCHOR} className="flex flex-col gap-4" data-testid="tool-gateway-section">
      {!writable ? <p className="text-xs text-muted-foreground" data-testid="tool-gateway-read-only">{READ_ONLY_NOTE}</p> : null}
      {snapshot.problems.length ? <p role="alert" className="text-xs text-destructive" data-testid="tool-gateway-problems">Secrets can't be read, so no server is approved: {snapshot.problems.join("; ")}</p> : null}
      {snapshot.importable > 0 && !importing ? (
        <Card>
          <Row label={`Import ${plural(snapshot.importable, "server")} from Agent Plugins`} testId="tool-gateway-import-banner">
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>Review</Button>
          </Row>
        </Card>
      ) : null}
      {importing ? <ImportPanel key={importKey} writable={writable} onChanged={refresh} onClose={() => setImporting(false)} /> : null}

      {snapshot.requests.length ? (
        <Card>
          <SubHeading>Requests</SubHeading>
          {snapshot.requests.map((request) => (
            <Row key={request.id} testId="tool-gateway-request" label={`${request.label} · ${KIND_LABEL[request.kind]}`}
              description={<>{request.why}<span className="block font-mono">{request.kind === "stdio" ? [request.command, ...request.args].join(" ") : request.url}{request.envNames.length ? ` · ${request.envNames.join(", ")}` : ""}</span><span className="block">{request.threadId ? `From ${request.threadId} · ` : ""}{relativeTime(request.createdAt)}</span></>}>
              {writable ? (
                <>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => call("toolGateway.decline", { requestId: request.id }))}>Decline</Button>
                  <Button size="sm" disabled={busy} onClick={() => setForm({ initial: formFromRequest(request), mode: "add", requestId: request.id })}>Approve…</Button>
                </>
              ) : null}
            </Row>
          ))}
          <ErrorLine error={error} />
        </Card>
      ) : null}

      {form ? <ServerForm key={`${form.mode}-${form.initial.id}-${form.requestId ?? ""}`} initial={form.initial} mode={form.mode} requestId={form.requestId} onDone={done} onCancel={() => setForm(null)} /> : null}

      <Card>
        <SubHeading>Servers</SubHeading>
        {snapshot.servers.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No servers</p> : null}
        {snapshot.servers.map((server) => (
          <Row key={server.id} testId={`tool-gateway-server-${server.id}`} label={<button type="button" className="text-left hover:underline" onClick={() => setOpen(open === server.id ? null : server.id)}>{server.label}</button>}
            description={[KIND_LABEL[server.kind], STATUS_LABEL[server.status], plural(server.tools, "tool"), server.toolsChanged ? "Tools changed" : null].filter(Boolean).join(" · ")}>
            <Switch label={`${server.label} on`} checked={server.enabled} disabled={!writable || busy || !server.approved} onChange={(enabled) => void run(() => call("toolGateway.setEnabled", { id: server.id, enabled }))} />
          </Row>
        ))}
        {writable ? (
          <div className="px-4 py-3">
            <Button size="sm" variant="outline" disabled={form !== null} onClick={() => setForm({ initial: emptyForm(), mode: "add" })}>Add server</Button>
          </div>
        ) : null}
      </Card>

      {open && snapshot.servers.some((server) => server.id === open) ? (
        <ServerPage id={open} writable={writable} onChanged={refresh} onClose={() => setOpen(null)} onEdit={(server) => void call("toolGateway.serverConfig", { id: server.id }).then((stored) => setForm({ initial: formFromServer({ ...server, ...stored }), mode: "edit" }), (cause) => setLoadError(errorMessage(cause)))} />
      ) : null}

      <Providers providers={snapshot.providers} servers={snapshot.servers} writable={writable} onChanged={refresh} />
    </div>
  );
}
