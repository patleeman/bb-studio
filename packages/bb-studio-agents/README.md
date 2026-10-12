# Studio Agents

Part of BB Studio. Agent providers that run outside BB: Hermes (HTTP runs
API), OpenClaw (ACP Gateway), Grok (xAI API), and experimental ChatGPT Dot.
Studio uses them for external bots: Bots → Import bot picks one of these
providers and a model, and the bot's thread runs there.

The plugin ID stays `external-agents` (it moved here from `bb-plugins`), so
existing settings and OpenClaw pairing carry over. The provider process runs
on the selected BB host and connects to the remote agent. The provider IDs are
`hermes`, `openclaw`, `grok`, and `dot`. Every provider is off by default.

## Development

```sh
pnpm install          # from the repository root
pnpm --filter @bb-studio/external-agents typecheck
pnpm --filter @bb-studio/external-agents test
```

## Grok

Set `grokEnabled=true`, and put an xAI API key in the environment variable
named by `grokTokenEnv` (default `XAI_API_KEY`) on the BB host, or in the
dotenv file named by `grokTokenEnvFile`. `grokBaseUrl` defaults to
`https://api.x.ai/v1`. Models come from `GET /models`; image and embedding
models are left out.

Grok is a chat provider. Each turn sends the conversation to
`/chat/completions` with `stream: true` and streams the text into the thread.
BB's local tools are not offered to Grok: running them would mean the bridge
hosting BB's tool server and looping tool calls itself, which the provider
contract leaves to agent runtimes. Grok can't be steered mid-answer; stop it
and send again. The chat API keeps no state, so the bridge keeps each
thread's conversation in `~/.config/bb-external-agents/grok/` on the BB host.
`scripts/grok-fixture.mjs` serves a deterministic xAI API on loopback (key
`bb-grok-fixture`) for staging. The health RPC accepts `provider: "grok"`.

## Hermes

The Hermes client implements `/v1/models`, `/v1/runs`, run event streaming,
and the run `/approval`, `/steer`, and `/stop` endpoints. Tests derive their
wire shapes from Hermes's `gateway/platforms/api_server_runs.py`.

Credentials come from a supplied secret or a named environment variable.
HTTP errors omit response bodies and underlying network error details to
keep credentials out of diagnostics. Redirects are refused.

Hermes tool events carry names without call IDs. The mapper assigns IDs and
matches completions in order for each tool name. Approval responses retain
the exact Hermes request ID and never broaden the choices the server offers.

## Dot settings

Set `dotEnabled=true` to register provider/model `dot`. It is experimental and
disabled by default. Run it on this Mac with an existing ChatGPT sign-in in
`~/.codex/auth.json` and the `codex` CLI available for authentication refresh.
No token setting or credential copying is needed. The health RPC accepts
`{provider:"dot"}` and reports `paused` when Dot is paused in ChatGPT.

Use one Studio bot for Dot: every BB thread shares the same persistent room.
Tools execute in Dot’s cloud environment; local BB tools are not injected.
See the [transport notes](docs/dot-transport.md) for the private routes.

## Settings and health

Hermes uses `hermesEnabled`, `hermesBaseUrl`, and `hermesTokenEnv`.
The token variable defaults to `RED4_HERMES_TOKEN` on the selected BB host.
The provider is disabled by default until its endpoint is configured.

The plugin RPC `health` accepts `{ hostId?, provider: "hermes" }` and returns
`{ online, status, message }`. It runs the authenticated model probe on that
host. If `hostId` is omitted, it uses BB's local server host. Disabled providers
return `status: "disabled"` without a network probe. The office UI can use
`online: false` for its Offline state.

The fixture integration test covers session start/resume, run creation,
BB approval response routing, steering, and remote stop. The red4 live prompt checks also pass.

OpenClaw uses `openclawEnabled`, `openclawBaseUrl` (a `ws://` or `wss://`
Gateway URL), and `openclawTokenEnv` (default `RED4_OPENCLAW_TOKEN`). Install
`openclaw` on the BB host. `openclawStateDir` selects its paired client state;
`openclawAllowPrivateWs` permits the encrypted Tailscale route when enabled.
The same health RPC accepts `provider: "openclaw"`.

Gateway agents appear as `openclaw/<agentId>` models. Each BB thread gets a
stable, isolated Gateway session key under that agent. Credentials are written
to private temporary files and never put in ACP process arguments. Files are
removed when the bridge closes. No permanent OpenClaw configuration is edited.

The paired Gateway client needs `operator.read` for model discovery, plus its
normal ACP permissions. Gateway reachability does not prove that an upstream
model provider is authenticated. The turn can still fail with a provider error.

Optional live catalog test (load the token variables into the shell first):

```sh
BB_EXTERNAL_LIVE=1 npm test
```

Live red4 checks now pass for both agents. OpenClaw’s ACP wire guard converts
empty completions and explicit upstream errors into failed BB turns. Run its
process with access to the existing paired state and OpenClaw cache directory;
sandbox-denied identity loading can appear as a misleading scope rejection.
No Gateway scope upgrade was needed.

## Staged preview

![Studio Agents settings in a staged stable BB 0.46: Hermes on, pointed at the local Hermes fixture with token variable STAGED_HERMES_TOKEN read from a dotenv file; OpenClaw off with its defaults; Grok on, pointed at the local xAI fixture with key variable STAGED_XAI_KEY; experimental Dot off](assets/staged-preview.png)

The plugin's settings page in a staged stable BB 0.46, installed from Git.
Hermes and Grok point at this package's loopback fixtures
(`scripts/hermes-fixture.mjs` with `HERMES_FIXTURE_REPLY` set, and
`scripts/grok-fixture.mjs`); their fixture keys come from a dotenv file.
OpenClaw and Dot are off. The screenshot shows variable names and paths,
not credential values. Studio's README shows Import bot and the imported
Hermes and Grok bots from the same staging.

If the BB host does not inherit the token variable, set `hermesTokenEnvFile`
or `openclawTokenEnvFile` to a dotenv file on that host. Only the named
assignment is used. The parser does not execute shell code or expand values;
the process environment takes precedence.

Both agents run tools remotely. OpenClaw rejects per-session MCP servers,
so its bridge does not pass BB's dynamic tool server to the Gateway. Configure
additional tools on the remote agent itself.

Staged evidence: the plugin installs from Git on stable BB 0.45.0. A real
Hermes BB thread reaches red4 and records the remote missing-credentials
error as a failed turn. After native sign-in, both staged providers returned
exact `ok`. OpenClaw’s live catalog and authenticated health checks also pass.

Hermes also passes the published BB provider-bridge conformance suite using
an HTTP fixture. OpenClaw routing tests cover cancellation during preflight
and rejection of a model change that would otherwise keep using the old
Gateway agent. Start a new BB thread to select another OpenClaw agent.

The deterministic `scripts/hermes-fixture.mjs` also passed an approval round-trip
through the full staged BB 0.45.0 runtime: a pending interaction appeared,
Allow once reached the exact Hermes request ID, and the thread completed with
`ok`. This fixture executes no commands. This verifies BB approval integration independently of model credentials.

## Experimental Dot: best-effort correlation

Dot is disabled by default. Its private ChatGPT routes may break.
All BB Dot threads will share one persistent agent and one conversation.

Prefer an exact `request_id` or `reply_to` match. When neither is echoed, the
approved fallback requires one BB request in flight per Dot across provider
processes. Accept a candidate reply only from the Dot's verified member ID,
created after the submitted message's **server timestamp**, and received before
the matching cloud WebSocket turn completes. Use the `turn/started` →
`turn/completed` pair after submission as the correlation window.

Every accepted unlinked reply is displayed with an uncertainty note, even if no
other client was observed. A reply linked to another message is ignored; the
fallback cannot override that link. Replies outside the turn window are ignored.
The visible candidate answer completes the BB turn with its note.

This is best-effort correlation, not proof of causality. If another client sends
a message during that window, mark the BB turn uncertain and display the candidate
reply with a note explaining that it may respond to the other client's message.
Do not silently discard it or label it confidently as the BB request's answer.
The bridge implements this fallback and displays the uncertainty note. It uses
cloud WebSocket turn/tool events and interrupts only the tracked active turn.
A reconnect rereads auth and room/root state; a stream gap marks correlation
uncertain. The shared room queue spans provider processes on this Mac.

If a submitted request loses its confirmed outcome, the queue remains locked
in `~/.config/bb-external-agents/dot-queue/` to prevent overlapping submissions.
Check the Dot in ChatGPT before recovering that room’s lock. Do not enable
the same Dot on multiple BB hosts: their local queues are not coordinated.


Dot staged evidence: the exact random test token arrived in the BB timeline,
including Dot’s reply tool event. A separate BB Stop test left the cloud turn
`interrupted` and the Dot root `idle`, verified by a read-only WebSocket resume.
Initial history reads exposed the private API’s 32-message limit and nullable
text fields; both are handled. Fixture tests cover exact/fallback correlation,
queueing, interruption, reconnect setup, token refresh, and error handling.

Provider logos are official upstream SVG marks. See [sources and license notices](icons/README.md).
