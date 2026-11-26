import SwiftUI

/// What a Workbench tab needs from the conversation it belongs to. The
/// Workbench container sets it once; every tab under it reads it.
struct WorkbenchContext {
    var threadId: String
    /// The conversation in BB web: where kinds the phone has no view for open.
    var webURL: URL?
    /// Opens a conversation or worker tab in the chat.
    var openThread: (String) -> Void = { _ in }
}

extension EnvironmentValues {
    @Entry var workbenchContext: WorkbenchContext?
    /// Library's tiles laid out for a Workbench-wide page.
    @Entry var workbenchPane = false
}

/// The shell's one entry point for a tab's content: the Workbench container
/// (its bar, tab menu, rail and posture) puts this under its bar and knows
/// nothing of tab kinds. The content by kind is `WorkbenchTabBody`.
struct WorkbenchTabContent: View {
    let tab: WorkspaceTab
    @Environment(\.workbenchContext) private var context

    var body: some View {
        if let context {
            WorkbenchTabBody(tab: tab, threadId: context.threadId, webURL: context.webURL, openThread: context.openThread)
        }
    }
}
