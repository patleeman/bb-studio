import SwiftUI

/// What the open thread offers the menu bar and hardware-keyboard shortcuts.
struct ThreadActions {
    var find: () -> Void
    var jumpToLatest: () -> Void
    var chooseModel: () -> Void
    /// Nil while the thread isn't running.
    var stop: (() -> Void)?
}

extension FocusedValues {
    @Entry var thread: ThreadActions?
}

/// Scene-wide, so they work whichever split-view column has focus; a
/// shortcut on a button only reaches the column it's in.
struct BBStudioCommands: Commands {
    @FocusedValue(\.thread) private var thread

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Thread") { AppModel.shared.newThread() }
                .keyboardShortcut("n")
        }
        CommandMenu("Thread") {
            // No ⌘F: the system keeps it, so it never reaches the app.
            Button("Find in Thread") { thread?.find() }
                .disabled(thread == nil)
            Button("Jump to Latest") { thread?.jumpToLatest() }
                .keyboardShortcut(.downArrow)
                .disabled(thread == nil)
            Button("Model & Reasoning…") { thread?.chooseModel() }
                .keyboardShortcut("m", modifiers: [.command, .shift])
                .disabled(thread == nil)
            Divider()
            Button("Stop") { thread?.stop?() }
                .keyboardShortcut(".")
                .disabled(thread?.stop == nil)
        }
    }
}
