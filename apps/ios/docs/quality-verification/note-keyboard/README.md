# Capture note with keyboard at accessibility XXXL

The suspected unreachable Save action did not reproduce. In the real native
Capture sheet, twelve lines of text remain intact and **Save note** is fully
visible, enabled and hittable above the software keyboard. No product source
change was needed.

The opt-in [UI test](NoteVisibilityUITests.swift) opens the actual Capture deep
link, chooses Note, focuses its field and enters twelve distinct lines. It
asserts the complete field value, then checks the entire Save button against
the app, navigation bar and keyboard bounds after allowing ordinary scrolling.
The field scrolls its own text as it grows. Merely using a non-scrollable outer
VStack did not prove a layout failure.

On the fresh iPhone 18 Pro / iOS 27 simulator, the button spans y=448 through
541.33 points, while the keyboard begins at y=590. Its complete visible label
is present in the [screenshot](note-keyboard-reachable.png); the
[accessibility tree](note-keyboard-accessibility-tree.txt) names it Save note.
The [initial screenshot](note-keyboard-initial.png) records the state before the
test's optional scroll loop. The [run](https://github.com/patleeman/bb-studio/blob/321665bec62f1c351a85b78aee7b532243b63f7d/apps/ios/docs/quality-verification/note-keyboard/run.log), [summary](summary.json) and
[verification record](verification.json) preserve assertions and source hash.

The initial geometry probe passed. A second run added exact equality for all
twelve lines and also passed: one test, no failures or skips. The test did not
tap Save, so it created no server item. This verifies enabled-action reachability,
not submission or subsequent Saved/Open feedback, physical VoiceOver, other
devices, dark mode or the whole accessibility audit.

Both runs used new empty private simulators and a separate source/build tree.
Before any app launch, both private fallback URLs and actual app and app-group
preferences were set and read back as `http://127.0.0.1:49486`. The Settings
screen confirmed the same origin before opening Capture. Both simulators were
shut down and deleted; the [cleanup record](cleanup.json) records the final one.

To reproduce, follow the private-source, fresh-simulator and prelaunch
preference verification steps in [native quality verification](../../quality-verification.md).
Copy this one test into that private UITests target in place of other UI suites.
It is intentionally outside the normal test target in this repository.
Do not copy it into a production app test run: its launch arguments alone do
not establish app-group or fallback isolation.
