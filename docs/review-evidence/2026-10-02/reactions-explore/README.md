# Reactions and Explore live verification

Captured from isolated stable BB on `127.0.0.1:49486`, with its data in
`/tmp/bb-studio-goal-staged`. No production app or data was used.

- Reactions checkpoint `38f64b5`: exactly one native settings editor; pending
  reload notice and applied state; independent user, assistant and selection
  switches; emoji glyphs in both message bars; no redundant selection icons;
  disabling the plugin removes its glyphs and icons. All switches were restored.
- Explore/Tasks/Studio checkpoint `3318221`: Track task opens a real task;
  three concurrent retries return the same ID; the task retains its source
  thread and project and inherits the thread's Studio space. Open task reopens
  that task. Actually disabling Tasks shows a disabled Tasks unavailable action;
  reenabling it and focusing the window restores Open task.

The JSON files record assertions and fixture IDs. Screenshots show the actual
rendered application. The Reactions applied-state image is also the package's
`assets/staged-preview.png`. Fixture tasks, spaces and the source thread were
removed after verification. Tasks and Reactions were left enabled.

`verifyExploreTask` in `scripts/capture/verify-explore-task.mjs` reproduces the
Explore checks with the existing capture driver's client. Supply a fresh real
assistant directive's projectId, threadId, full host messageId, label, outputDir,
and checkpoint. Set checkUnavailable only in an exclusively owned staged BB.
The helper validates capture.env, refuses existing linked tasks, captures each
state, and removes its task and space. The caller owns the thread and browser.

The three Reactions toggle filenames encode user/assistant/selection enabled
states. JSON counts concern nonhidden buttons; native hover-only action bars may
be transparent in screenshots. No real agent message was sent by clicking a
reaction. Right-click context menus were not separately exercised.
