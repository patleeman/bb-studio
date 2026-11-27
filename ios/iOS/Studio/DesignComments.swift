import SwiftUI

/// A design's comments, as the desktop's panel: Open | Resolved, each with
/// its pin's number, screen and element; tap one to see it pinned on its
/// screen; Send to Agent, Resolve or Reopen, and Delete.
struct DesignCommentsSheet: View {
    @ObservedObject var model: DesignModel
    /// Opens the player at a comment's screen with its pin active.
    let show: (DesignComment) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var resolved = false
    @State private var error: String?

    private var shown: [DesignComment] { model.comments.filter { $0.resolved == resolved } }

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                ForEach(shown) { comment in
                    Button {
                        dismiss()
                        show(comment)
                    } label: {
                        DesignCommentRow(comment: comment)
                    }
                    .foregroundStyle(.primary)
                    .swipeActions(edge: .trailing) { actions(comment) }
                    .contextMenu { actions(comment) }
                    .accessibilityIdentifier("designComment-\(comment.number)")
                }
            }
            .overlay {
                if shown.isEmpty {
                    ContentUnavailableView(resolved ? "No resolved comments" : "No open comments", systemImage: "text.bubble",
                                           description: Text(resolved ? "" : "Open a screen, choose Comment and tap an element."))
                }
            }
            .navigationTitle("Comments")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .principal) {
                    Picker("Show", selection: $resolved) {
                        Text("Open (\(model.openComments.count))").tag(false)
                        Text("Resolved").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("designCommentsFilter")
                }
            }
            .refreshable { await model.load() }
        }
    }

    @ViewBuilder private func actions(_ comment: DesignComment) -> some View {
        if !comment.sent, !comment.resolved, model.design?.threadId != nil {
            Button { act { try await $0.sendDesignComment(comment.id) } } label: { Label("Send to Agent", systemImage: "paperplane") }
                .tint(.blue)
        }
        Button { act { try await $0.resolveDesignComment(comment.id, resolved: !comment.resolved) } } label: {
            Label(comment.resolved ? "Reopen" : "Resolve", systemImage: comment.resolved ? "arrow.uturn.backward" : "checkmark.circle")
        }
        .tint(.green)
        Button(role: .destructive) { act { try await $0.deleteDesignComment(comment.id) } } label: { Label("Delete", systemImage: "trash") }
    }

    private func act(_ change: @escaping (BBClient) async throws -> Void) {
        Task { error = await model.run(change) }
    }
}

private struct DesignCommentRow: View {
    let comment: DesignComment

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(comment.number)")
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(comment.sent ? Color.accentColor : .white)
                .frame(width: 24, height: 24)
                .background(comment.sent ? AnyShapeStyle(.background) : AnyShapeStyle(Color.accentColor), in: .circle)
                .overlay(Circle().strokeBorder(Color.accentColor, lineWidth: 2))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(comment.body).font(.subheadline)
                Text(note).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// The desktop's line: "Pin 3 on 1a · step · Sent to the agent", with the element's text.
    private var note: String {
        var parts = ["Pin \(comment.number) on \(comment.screenId)"]
        if !comment.step.isEmpty { parts.append(comment.step) }
        if comment.sent { parts.append("Sent to the agent") }
        let line = parts.joined(separator: " · ")
        return comment.elementText.isEmpty ? line : "\(line)\n\u{201C}\(comment.elementText)\u{201D}"
    }
}
