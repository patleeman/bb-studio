import SwiftUI

struct ConnectionBanner: View {
    @Environment(\.look) private var look
    let message: String
    let retry: () async -> Void
    @State private var retrying = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(message, systemImage: "wifi.exclamationmark")
                .foregroundStyle(.secondary)
                .font(.footnote.weight(.medium))
            if message.contains("Tailscale") {
                Text("Showing the last saved inbox. Turn on Tailscale, or check that the Mac is awake and BB is running.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Open Tailscale") { UIApplication.shared.open(URL(string: "tailscale://")!) }
                    Spacer()
                    retryButton
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            } else {
                retryButton.buttonStyle(.bordered).controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }

    private var retryButton: some View {
        Button {
            retrying = true
            Task {
                await retry()
                retrying = false
            }
        } label: {
            if retrying { ProgressView() } else { Text("Retry") }
        }
    }
}

struct ThreadRow: View {
    let thread: ThreadEntry
    var project: String?
    @ObservedObject private var muted = MutedThreads.shared
    /// Written by the thread screen as the reader types; see `Drafts`.
    @AppStorage private var draft: Data?

    init(thread: ThreadEntry, project: String? = nil) {
        self.thread = thread
        self.project = project
        _draft = AppStorage(ServerScope.key("draft.\(thread.id)"))
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            StatusDot(thread: thread).padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(ThreadTitles.resolve(thread.displayTitle))
                        .font(.body.weight(thread.isUnread ? .semibold : .regular))
                        .lineLimit(2)
                }
                HStack(spacing: 4) {
                    if draft != nil {
                        Text("Draft").foregroundStyle(.red)
                        Text("·")
                    }
                    if let project {
                        Text(project)
                        Text("·")
                    }
                    Text(
                        Date(timeIntervalSince1970: (thread.latestAttentionAt ?? thread.updatedAt) / 1000),
                        format: .relative(presentation: .named, unitsStyle: .abbreviated))
                    if muted.ids.contains(thread.id) {
                        Image(systemName: "bell.slash").accessibilityLabel("Muted")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
    }
}

struct StatusDot: View {
    @Environment(\.look) private var look
    let thread: ThreadEntry

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .opacity(thread.isUnread || thread.isRunning || thread.needsAttention ? 1 : 0)
    }

    private var color: Color {
        if thread.status == "error" { return .red }
        if thread.hasPendingInteraction == true { return look.needsYou }
        if thread.isRunning { return .green }
        return .blue
    }
}
