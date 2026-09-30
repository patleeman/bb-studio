import SwiftUI

/// Rewrites a message that hasn't sent yet. Attachments and @-mentions stay.
struct QueuedMessageEditor: View {
    let client: BBClient
    let message: QueuedMessage
    var onSaved: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var saving = false
    @State private var error: String?
    @FocusState private var focused: Bool

    init(client: BBClient, message: QueuedMessage, onSaved: @escaping () -> Void = {}) {
        self.client = client
        self.message = message
        self.onSaved = onSaved
        _text = State(initialValue: message.text)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                }
                TextEditor(text: $text)
                    .focused($focused)
                    .padding(.horizontal, 12)
                    .accessibilityIdentifier("queuedMessageEditor")
                if message.attachmentCount > 0 {
                    Label("\(message.attachmentCount) attachment\(message.attachmentCount == 1 ? "" : "s") stay with it",
                        systemImage: "paperclip")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding()
                }
            }
            .navigationTitle(message.isDraft ? "Edit Draft" : "Edit Queued Message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .disabled(!canSave)
                    }
                }
            }
            .interactiveDismissDisabled(text != message.text)
            .onAppear { focused = true }
        }
    }

    private var canSave: Bool {
        text != message.text
            && (message.attachmentCount > 0 || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private func save() async {
        guard let thread = message.threadId else { return }
        saving = true
        defer { saving = false }
        do {
            try await client.editQueued(thread, message.id, from: message.text, to: text)
            onSaved()
            dismiss()
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}
