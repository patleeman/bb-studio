import SwiftUI

/// Plannotator's review UI, relayed through BB. Approving or requesting
/// changes there answers the agent; cancelling tells it the review was dropped.
struct PlanReviewSheet: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let review: PlanReview
    let changed: () async -> Void
    @State private var confirmingCancel = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            WebView(url: app.client.planReviewURL(review))
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle(review.title ?? "Plan review")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            Button { openURL(app.client.planReviewURL(review)) } label: {
                                Label("Open in Safari", systemImage: "safari")
                            }
                            Button(role: .destructive) { confirmingCancel = true } label: {
                                Label("Cancel Review", systemImage: "xmark.circle")
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                        .accessibilityLabel("More")
                    }
                }
                .overlay(alignment: .bottom) {
                    if let error {
                        Text(error).font(.caption).padding(8).background(.red.opacity(0.15), in: .capsule).padding()
                    }
                }
                .confirmationDialog("Cancel this review?", isPresented: $confirmingCancel, titleVisibility: .visible) {
                    Button("Cancel Review", role: .destructive) {
                        Task {
                            do {
                                try await app.client.cancelPlanReview(review)
                                await changed()
                                dismiss()
                            } catch {
                                self.error = BBClient.describe(error, server: app.client.baseURL)
                            }
                        }
                    }
                    Button("Keep Reviewing", role: .cancel) {}
                } message: {
                    Text("The agent stops waiting and carries on without your feedback.")
                }
        }
    }
}
