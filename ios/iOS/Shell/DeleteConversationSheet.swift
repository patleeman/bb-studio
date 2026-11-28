import SwiftUI

/// A conversation someone asked to delete: what the confirm names.
struct ConversationDeletion: Identifiable, Hashable {
    let threadId: String
    let title: String
    var id: String { threadId }
}

/// The only way to delete a conversation (the ⋯ menu's last item, and a
/// finished conversation's page). It names the conversation, how many
/// workers go with it and whether it can come back (Studio's Recently
/// deleted, else BB's delete for good), starts on Cancel, and Delete works
/// only after a pause, so a stray tap can't delete.
struct DeleteConversationSheet: View {
    let deletion: ConversationDeletion
    let delete: (ConversationDeletePlan) -> Void
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var plan: ConversationDeletePlan?
    @State private var failure: String?
    @State private var wait = ConversationFinish.deleteArmSeconds
    @FocusState private var cancelFocused: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    private var armed: Bool { wait == 0 && plan != nil }

    var body: some View {
        // Scrolls, and opens full height at accessibility sizes: large type never clips Delete or Cancel.
        ScrollView { content }
            .scrollBounceBehavior(.basedOnSize)
            .presentationDetents(typeSize.isAccessibilitySize ? [.large] : [.medium, .large])
            .presentationDragIndicator(.visible)
            .sensoryFeedback(.warning, trigger: armed) { _, now in now }
            .task { await arm() }
            .task { await load() }
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
            message
                .font(.subheadline)
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
                guard let plan else { return }
                dismiss()
                delete(plan)
            } label: {
                Text(wait == 0 ? "Delete" : "Delete (\(wait))")
                    .monospacedDigit()
                    .frame(maxWidth: .infinity, minHeight: 34)
            }
            .buttonStyle(.bordered)
            .tint(.red)
            .disabled(!armed)
            .accessibilityIdentifier("confirmDelete")
        }
    }

    @ViewBuilder private var message: some View {
        if let plan {
            Text(ConversationFinish.deleteMessage(deletion.title, workers: plan.workers, keepDays: plan.keepDays)).foregroundStyle(.secondary)
        } else if let failure {
            Text(failure).foregroundStyle(.red)
        } else {
            ProgressView()
        }
    }

    private func load() async {
        do {
            plan = try await app.client.deletePlan(deletion.threadId)
        } catch {
            if !BBClient.isCancellation(error) { failure = "It can't delete it now: " + BBClient.describe(error, server: app.client.baseURL) }
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
    /// Shows the delete confirm while `deletion` is set; `delete` runs only on its Delete, with how to delete.
    func deleteConversationSheet(_ deletion: Binding<ConversationDeletion?>, delete: @escaping (ConversationDeletion, ConversationDeletePlan) -> Void) -> some View {
        sheet(item: deletion) { request in
            DeleteConversationSheet(deletion: request) { delete(request, $0) }
        }
    }
}
