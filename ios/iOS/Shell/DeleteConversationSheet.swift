import SwiftUI

/// A conversation someone asked to delete: what the confirm names.
struct ConversationDeletion: Identifiable, Hashable {
    let threadId: String
    let title: String
    var id: String { threadId }
}

/// The only way to delete a conversation (the ⋯ menu's last item, and a
/// finished conversation's page). It names the conversation and how many
/// workers go with it, starts on Cancel, and Delete works only after a
/// pause, so a stray tap can't delete.
struct DeleteConversationSheet: View {
    let deletion: ConversationDeletion
    let delete: () -> Void
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var workers: Int?
    @State private var wait = ConversationFinish.deleteArmSeconds
    @FocusState private var cancelFocused: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    private var armed: Bool { wait == 0 }

    var body: some View {
        // Scrolls, and opens full height at accessibility sizes: large type never clips Delete or Cancel.
        ScrollView { content }
            .scrollBounceBehavior(.basedOnSize)
            .presentationDetents(typeSize.isAccessibilitySize ? [.large] : [.medium, .large])
            .presentationDragIndicator(.visible)
            .sensoryFeedback(.warning, trigger: armed) { _, now in now }
            .task { await arm() }
            .task { workers = try? await app.client.deleteCascadeCount(deletion.threadId) }
            .onAppear { cancelFocused = true }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("deleteSheet")
    }

    private var content: some View {
        VStack(spacing: 14) {
            Image(systemName: "trash")
                .font(.title2.weight(.medium))
                .foregroundStyle(.red)
                .frame(width: 52, height: 52)
                .background(.red.opacity(0.12), in: .circle)
            Text(ConversationFinish.deleteTitle(deletion.title))
                .font(.headline)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("deleteTitle")
            Text(ConversationFinish.deleteMessage(deletion.title, workers: workers))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("deleteMessage")
            buttons.padding(.top, 8)
        }
        .padding(.horizontal, 24)
        .padding(.top, 28)
        .padding(.bottom, 16)
    }

    private var buttons: some View {
        VStack(spacing: 10) {
            Button { dismiss() } label: { Text("Cancel").frame(maxWidth: .infinity, minHeight: 34) }
                .buttonStyle(.borderedProminent)
                .tint(.secondary)
                .keyboardShortcut(.defaultAction)
                .focused($cancelFocused)
                .accessibilityIdentifier("cancelDelete")
            Button(role: .destructive) {
                dismiss()
                delete()
            } label: {
                Text(armed ? "Delete" : "Delete (\(wait))")
                    .monospacedDigit()
                    .frame(maxWidth: .infinity, minHeight: 34)
            }
            .buttonStyle(.bordered)
            .tint(.red)
            .disabled(!armed)
            .accessibilityIdentifier("confirmDelete")
        }
    }

    private func arm() async {
        while wait > 0 {
            try? await Task.sleep(for: .seconds(1))
            if Task.isCancelled { return }
            wait -= 1
        }
    }
}

extension View {
    /// Shows the delete confirm while `deletion` is set; `delete` runs only on its Delete.
    func deleteConversationSheet(_ deletion: Binding<ConversationDeletion?>, delete: @escaping (ConversationDeletion) -> Void) -> some View {
        sheet(item: deletion) { request in
            DeleteConversationSheet(deletion: request) { delete(request) }
        }
    }
}
