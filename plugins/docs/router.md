# Model router

The model router is built into [Studio](../packages/bb-studio/) (`src/router`). It does two things:

- **Auto.** A new conversation can start on **Auto**. Before the thread exists, the router picks a real provider and model for it. The conversation then shows that real model in the picker, like any other conversation. A running conversation is never on Auto. The project keeps Auto as its default, so the next new conversation starts on Auto again.
- **The usage-limit notice.** When a turn fails on a usage limit or a sign-in failure, the conversation shows a notice above its composer: *"The auto router detected a usage limit on Claude Code (429 rate limit). Hand off to GLM 5.3?"* Nothing changes until you click **Hand off**.

Auto needs BB Studio's desktop app (the fork's `experimental_autoRouter` hook). On a BB without it, the rules and the notice still work, and Auto is not offered.

## Rules

Settings → Plugins → Studio → **Model router** holds:

| Setting | What it does |
| --- | --- |
| Auto | Shows Auto in the model pickers and turns the notice on. Both start once there is a rule or a default chain. |
| Auto when no model is named | New threads that name no model go through Auto: agents' workers, the CLI, automations and plugins. Off, they keep BB's usual rule (a worker follows its parent's model). A thread that names a model keeps it; a Bot's conversations name the Bot's model, so set a Bot's model to Auto to route them. A fork always keeps its source's model. |
| Rules | Plain words, for example "Design, front end, anything strongly visual", each with an ordered chain of real models. |
| Default chain | The chain for tasks no rule fits, and the last resort after a rule's own chain. |
| Try a task | A dry run: which rule, how it was picked, and the model Auto would use. It asks Jev (and, when Jev doesn't answer, the AI service for thread titles) but starts no thread. |

A chain lists real provider and model pairs, never Auto. Each target keeps the model's name from its provider's catalog.

## How Auto picks

1. **Jev** picks the rule. It gets the task text (up to 20,000 characters, as data) and each rule's words as the options of one choice question, plus `default` for "no rule fits". A rule counts at confidence 0.5 or higher. Jev has 1.5 seconds. It is called through Studio Decisions (`decisions.systemOne.ask`, caller `studio-router`).
2. **The AI service for thread titles** (Settings → AI services) answers when Jev doesn't, with what is left of 5 seconds in total. It is one model call with no tools, no thread and no workspace (BB Studio's `experimental_completeText`); its first word that is a rule id counts. The Decisions fallback model, which runs a hidden agent thread, is not used for routing.
3. **The default chain** is used when neither answers in time. A late answer is dropped.

The router then walks the rule's chain, then the default chain, and takes the first target that is available:

- its provider is ready on the primary machine (BB's provider states: installed and signed in);
- its provider still offers the model (its model catalog, read at most once a minute; a catalog that can't be read doesn't count against it, except for Pi and ACP agents, below). Settings shows "Skipped: model no longer offered" beside such a target, and the other reasons too;
- its provider's usage snapshot (`system.usageLimits`, cached, read at most once a minute) doesn't say it is out of credit (a cost window at 100%) or has a used-up window that hasn't reset. The snapshot's "unauthenticated" is ignored, since readiness covers sign-in (OpenCode without a Go key and Claude Code on an API key read that way and still work). A Pi or ACP agent's windows aren't read at all, because its plan covers only some of its models;
- its provider has a permission mode at or below the one the composer asked for. A create that names no mode (the CLI, an automation, a worker under "Auto when no model is named") gets BB's fill-in: its parent's mode, else "auto". BB doesn't narrow that fill-in to the provider (an agent without "auto" would get "full"), so the target must offer that mode as is. Pi (full only) and ACP agents (no "auto") are skipped for such a create unless the parent ran with a mode they offer. When BB's provider list can't be read, a target's modes are unknown, so no target is picked under a mode and the thread starts on BB's usual default;
- the router has not seen it blocked (a usage limit until its reset, or 15 minutes when the reset is unknown; a billing or sign-in failure for 15 minutes).

A target whose readiness BB can't tell (provider state `unknown`: an ACP agent whose account can't be read, a host that isn't answering) is usable, but only after every ready target in the chain, in chain order. Settings says "Readiness unknown: used only when no ready model is left in the chain" beside it, and **Try a task** says so when Auto takes one.

### Pi and other ACP agents

Pi (`pi`) and ACP agents (custom `acp-…` agents such as OpenCode, Gemini, or local models through OpenCode or an Ollama or LM Studio agent, and provider plugins that declare the ACP family, such as Google Antigravity, `antigravity`) are targets like any other. They run models from several services, so the router treats their models one by one:

- A usage limit blocks only the model that hit it. GLM 5.3 through OpenCode running out leaves a local model through OpenCode available. A sign-in failure blocks the whole agent.
- An agent whose model catalog failed twice in a row (for the same machine and project), or failed because the agent couldn't start (`provider_unavailable`, `missing_executable`, a refused connection), is skipped as "unreachable". One slow listing (a cold start timing out) isn't enough. The catalog is read on the primary machine, for the project when Auto knows it, since OpenCode's catalog is per workspace.
- A turn that fails because the agent couldn't reach its model's service (`ECONNREFUSED`, "fetch failed": an Ollama that isn't running) keeps Auto off that model on that machine for 5 minutes. It raises no notice.
- Pi runs only with full access, so under "accept-edits" Auto and the notice skip it. ACP agents have no "auto" mode; under "auto" they run with "accept-edits".
- **Lean tools.** When Auto picks an ACP agent on a local model, the new thread's session is lean (`src/context-lean.ts`, the same rule as for any thread: Settings › Agent context per provider, Auto by default). **Try a task** shows "Lean tools" for such a pick.

If nothing is available, the thread starts on BB's usual default, which can be a provider the router skipped. BB waits at most 8 seconds for the router and then uses its default. When the chosen provider doesn't offer the composer's permission mode, the thread gets the most permissive mode that provider offers that is not above it; Auto never widens access.

## The notice

Studio reads `turn.failed`'s structured error:

| Error | Notice |
| --- | --- |
| `rate-limit` with a blocked subscription window | usage limit until its reset |
| `rate-limit` with `credits` or `spend-control` | out of credits, spend limit reached |
| `rate-limit` otherwise (a 429, Codex `usageLimitExceeded` or `rateLimitExceeded`, a door rejection) | rate limit, with the status and code |
| `billing` | billing limit |
| `unauthorized` | sign-in failure; in BB Studio's desktop app no notice, since the app shows its own sign-in prompt (the provider is still skipped by Auto) |

Decisions' own temporary threads get no notice. A notice isn't written when the thread has started again meanwhile, and it goes when the thread is archived or deleted. Any other failure gets no notice: changing models doesn't fix a bad request, a context limit, an overload or a crash.

ACP errors reach BB with no classification, and Pi's carry only what Pi's own patterns caught (a 429, 402 or 401, "rate limit", "insufficient quota"). For a Pi or ACP turn with no classification (or `unknown` or `bad-request`), the router reads the words of the failed turn's own `provider/error` event: only that turn's events (none without a turn), and none the provider was retrying (`select.ts` `readAgentErrorText`). It reads the event's message first, and the detail only when the message is BB's generic "Provider error", and then only the detail's first line: the rest is often the agent's stderr or a tool's output.

| Words | Read as |
| --- | --- |
| a 429 status ("HTTP 429", "status: 429", "Error: 429"), "rate limit", "too many requests", `RESOURCE_EXHAUSTED`, "quota exceeded", "exhausted your capacity", "usage limit", "daily request limit" | usage limit; a reset time from "reset after 3h12m", "try again in 45 minutes", "retryDelay: 30s" or "resets at <ISO time>" |
| "insufficient credits", "out of credits", "credit balance too low" | out of credits; Auto keeps off the model for an hour when no reset is given |
| a 402 status, "payment required", `insufficient_quota`, "billing", "spend limit" | billing limit |
| "authentication required", "not logged in", "invalid API key", "token expired", or a 401 status with "unauthorized" | sign-in failure, unless the words are about an MCP server or a tool |
| a turn, tool-call, recursion, step, token or context limit; a number at the start of a line ("429 tests passed") | nothing |
| "prompt is too long", "context length" | nothing (a full context) |
| `ECONNREFUSED`, "fetch failed", "connection refused" | unreachable: Auto keeps off the model for 5 minutes, no notice |

Anything else gets no notice.

The suggestion is the first available target in the chain of the rule whose chain names the failed model (or, failing that, its provider), followed by the default chain. Targets on the failed provider are skipped (for Pi and ACP agents, only the failed model). The provider (or the Pi or ACP model) is also marked blocked for Auto.

**Hand off** is BB's own handoff, the one the model picker starts when you pick another provider. The notice carries the permission mode for the new thread: the failed thread's, narrowed to one the target offers (never wider). When the failed thread's mode can't be read, the notice offers no model and the handoff RPC refuses, rather than guess. Hand off selects the target and that mode in the conversation's composer and sends nothing if the composer would use another mode (it would give an ACP agent "full" for a thread on "auto"). Selecting the target adds "Continue from @thread:…" to the draft, and sends it. BB creates a new conversation in the same workspace on the target and opens it. The old conversation stays as it is, except that its queued retry (Provider Retry's re-run at the reset time) is cancelled, so it doesn't start again on its own beside the new one. **Dismiss** removes the notice. A new turn in the conversation also removes it.

## API

The plugin RPCs (`studio` plugin):

| Method | Input | Output |
| --- | --- | --- |
| `router.policy.get` | `null` | the policy |
| `router.policy.set` | the policy | the saved policy |
| `router.explain` | `{ text }` | `{ ruleId, source, confidence, ms, target, skipped, note?, lean? }` (asks Jev and maybe the title AI service; starts no thread). `note` says when the pick is one whose readiness is unknown; `lean` that the pick runs with Lean tools |
| `router.targets.check` | `null` | `[{ providerId, model, problem, note? }]` |
| `router.notice.get` | `{ threadId }` | the notice or `null` |
| `router.notice.dismiss` | `{ threadId }` | `{ ok: true }` |
| `router.handedOff` | `{ threadId }` | `{ cancelledRetries }`: after the app's Hand off |
| `router.handoff` | `{ threadId }` | `{ threadId, target, cancelledRetries }`: BB's handoff request without the app (the new thread is not opened), with the permission mode narrowed to one the target supports |

The realtime channel `studio-router` announces `{ threadId }` when a notice changes.

## Not done

Retrying or switching on its own, summaries, a new provider in the same conversation, and probing a local model server before a turn (an unreachable one is found by its catalog or its first failed turn). The router forgets blocks when BB restarts.
