# Interviewer mode (server)

Start with `voiceLive.start({mode: "interviewer", pack: "pg_…", sdp: "…"})`.
The pack must be a Studio Page tagged `interview-pack`, with Problem, Stages
and Rubric sections. Requirements and Interviewer rules are optional. Heading
variants are accepted. Stages need minute marks, such as `5–10 min · Estimates`.
Length comes from an explicit duration or the final stage range; otherwise 55
minutes. The server accepts lengths up to 60 minutes.

The launching persona and canvas tools are replaced. The identity is
`Interviewer · <pack title>`. The interviewer conducts the interview itself.

| Tool | Arguments | Result |
| --- | --- | --- |
| `interview_clock` | none | Elapsed, remaining, current stage, next stage |
| `read_drawing` | optional `name` | Latest or named stored drawing as a text graph, at most 2,800 characters |
| `note_evidence` | `dimension`, `observation`, optional `quote` | Append evidence to this session |
| `end_interview` | none | End and write the scorecard |
| `end`, `cancel` | none | End and write the scorecard |

Relays, loops and thread actions are rejected server-side. Rubric dimensions:
requirements, numbers, API and data model, high-level design, deep dive,
failure handling, communication.

The server checks stage marks once per second, including during silence.
Stage instructions travel through the existing poll/reply note path on both
clients, without telling the model to read the internal instruction aloud.
The final scorecard reports time in each scheduled stage window; this is not
an inference of which topic the candidate actually discussed.

## Session length and reconnect

Checked November 5, 2026: [OpenAI's Live create-session reference](https://developers.openai.com/api/reference/resources/live/methods/create)
documents a two-hour connected-call limit. It describes WebRTC and SIP together;
it does not specify a separate WebRTC maximum. [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations)
explicitly documents a 60-minute maximum. Studio's 120-second Realtime secret
expiry is the connection credential's lifetime, not the conversation duration.

Both APIs cover a 60-minute interview. No planned rollover is needed.
`voiceLive.reconnect` accepts the session ID, a fresh SDP offer for Live, and
pending events. It creates a replacement transport while preserving the Studio
record, start time, evidence, transcript and accumulated cost. Instructions
include the original pack, clock/stage, recent transcript context and evidence.
Both clients attempt recovery on unexpected closure (up to two attempts).
Safety-filter closure and explicit user hang-up do not reconnect. The next UI
step must launch clients with the interviewer start parameters; no launch UI
is included here.

## Scorecard and cost

`voiceInterviewScorecardModel` defaults to `gpt-5.6-sol`. At hang-up, completion
or time limit, Studio makes one Responses call, retries once on failure, then
writes a Page. The Page is nested under the pack's parent when present. It
includes seven scores from 1–4 with rubric labels and evidence, overall feedback,
three fixes, additions for a strong answer, time management, scheduled stage
times and the voice-thread transcript link. Two failures produce a Page with
`scorecard failed: <reason>` and the transcript link.

`voiceInterviewMonthlyCapUsd` defaults to **$100**, in the Voice group.
Interviewer sessions count only against this cap. Normal hands-free and meeting
sessions retain the existing `voiceLiveMonthlyCapUsd` cap, default **$20**.
Accounting includes voice seconds, backend tokens, Realtime/transcription usage
and scorecard token usage. At the cap, new sessions are refused. A running
interview stops and still scores the available evidence, with a stop note.
The final scorecard can take the total slightly over the cap.

`voiceLive.state` returns normal `monthUsd`/`capUsd` and separate
`interviewMonthUsd`, `interviewCapUsd`, `interviewProblem`. A launch UI must use
the problem for its selected mode. Settings apply to new sessions, except the
cap and scorecard model, which are read when needed.

At $0.05/min, 60 minutes of GPT-Live audio costs **$3.00**. Responses backend
and the final scorecard are additional token costs. OpenAI also bills 15 seconds
of WebRTC initialization per connection ($0.0125 at this rate); reconnects
can add another setup charge. See [voice cost optimization](https://developers.openai.com/api/docs/guides/voice-latency-cost). The local price table has
`gpt-5.6-sol` at $4/M input and $20/M output tokens: for example, 15,000 input
and 2,000 output tokens add $0.10. Realtime is billed by audio/text tokens and
transcription, so it has no fixed per-hour price.

## Honest staged dry run

Start only with the repository's staged runner:

```sh
BB_STAGED_DIR=/tmp/bb-studio-staged-interviewer BB_STAGED_PORT=49320 \
  node scripts/staged-bb.mjs start --plugin studio
. /tmp/bb-studio-staged-interviewer/capture.env
node_modules/.bin/tsx packages/bb-studio/scripts/interview-scorecard-dry-run.mts
```

The dry-run script refuses other servers. It copies the read-only first pack
fixture into a real staged Page, tags it, then runs the production scorecard
path with an in-memory session and fake model. It verifies the resulting Page
through Pages RPC. It creates no voice connection and starts no agent.
[The resulting Markdown example](interviewer-example.md) records this distinction.

A first real run still requires Patrick's OpenAI key and microphone. Neither
was used for this dry run. The remaining UI work is pack selection, interviewer
launch parameters on each client, the separate cap display, and scorecard access.
