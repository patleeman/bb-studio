import SwiftUI

/// A page's comment threads: read, reply, resolve, and start one on a block.
/// Writes go in as you, so an @bot in a comment reaches that bot like in the editor.
struct PageCommentsSheet: View {
    @ObservedObject var model: PageModel
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var drafts: [String: String] = [:]
    @State private var sending: String?
    @State private var showResolved = false
    @State private var composing = false
    @State private var error: String?

    private var threads: [PageCommentThread] {
        (model.comments ?? []).filter { showResolved || !$0.resolved }
    }

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                ForEach(threads) { thread in
                    Section {
                        if !thread.quote.isEmpty {
                            Text(thread.quote)
                                .font(.subheadline).italic()
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                        }
                        ForEach(thread.comments) { comment in
                            CommentRow(comment: comment)
                        }
                        if !thread.resolved { replyRow(thread) }
                    } header: {
                        HStack {
                            if thread.resolved { Text("Resolved") }
                            Spacer()
                            Button(thread.resolved ? "Reopen" : "Resolve") {
                                Task { await perform { try await $0.resolvePageComment(model.pageId, thread: thread.id, resolved: !thread.resolved) } }
                            }
                            .font(.caption.weight(.semibold))
                        }
                        .textCase(nil)
                    }
                }
            }
            .overlay {
                if model.comments != nil, threads.isEmpty {
                    ContentUnavailableView {
                        Label(showResolved ? "No comments" : "No open comments", systemImage: "text.bubble")
                    } actions: {
                        Button("New Comment") { composing = true }
                    }
                }
            }
            .navigationTitle("Comments")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItemGroup(placement: .primaryAction) {
                    Menu {
                        Toggle("Show Resolved", isOn: $showResolved)
                    } label: {
                        Image(systemName: "line.3.horizontal.decrease")
                    }
                    .accessibilityLabel("Filter")
                    Button { composing = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("New Comment")
                }
            }
            .refreshable { await model.loadComments(app.client) }
            .sheet(isPresented: $composing) { NewPageCommentSheet(model: model) }
            .task { await model.loadComments(app.client) }
        }
    }

    private func replyRow(_ thread: PageCommentThread) -> some View {
        let draft = Binding(get: { drafts[thread.id] ?? "" }, set: { drafts[thread.id] = $0 })
        let text = draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines)
        return HStack(alignment: .bottom) {
            TextField("Reply", text: draft, axis: .vertical)
                .lineLimit(1...6)
            Button {
                Task {
                    sending = thread.id
                    await perform { try await $0.replyToPageComment(model.pageId, thread: thread.id, text: text) }
                    if error == nil { drafts[thread.id] = nil }
                    sending = nil
                }
            } label: {
                if sending == thread.id {
                    ProgressView()
                } else {
                    Image(systemName: "arrow.up.circle.fill").font(.title2)
                }
            }
            .buttonStyle(.borderless)
            .disabled(text.isEmpty || sending != nil)
            .accessibilityLabel("Send Reply")
        }
    }

    private func perform(_ action: (BBClient) async throws -> Void) async {
        do {
            try await action(app.client)
            error = nil
            await model.loadComments(app.client)
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

private struct CommentRow: View {
    let comment: PageCommentThread.Comment

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(comment.authorName).font(.subheadline.weight(.semibold))
                Text(Date(timeIntervalSince1970: comment.createdAt / 1000), format: .relative(presentation: .named, unitsStyle: .abbreviated))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(comment.text)
                .textSelection(.enabled)
        }
        .padding(.vertical, 2)
    }
}

/// Pick a block, write the comment. It covers the block's whole text.
private struct NewPageCommentSheet: View {
    @ObservedObject var model: PageModel
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var blocks: [PageTextBlock]?
    @State private var block: String?
    @State private var text = ""
    @State private var posting = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var canPost: Bool {
        block != nil && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !posting
    }

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                Section {
                    TextField("Comment, or @ a bot", text: $text, axis: .vertical)
                        .lineLimit(2...8)
                        .focused($focused)
                        .accessibilityIdentifier("newCommentField")
                }
                Section("On") {
                    if let blocks {
                        ForEach(blocks) { item in
                            Button {
                                block = item.id
                            } label: {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(item.text).lineLimit(3)
                                    Spacer()
                                    if block == item.id { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                }
                            }
                            .foregroundStyle(.primary)
                            .accessibilityAddTraits(block == item.id ? .isSelected : [])
                        }
                        if blocks.isEmpty { Text("This page has no text to comment on.").foregroundStyle(.secondary) }
                    } else if error == nil {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                }
            }
            .navigationTitle("New Comment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Post") { Task { await post() } }.disabled(!canPost)
                }
            }
            .task {
                focused = true
                do {
                    blocks = try await app.client.pageCommentBlocks(model.pageId)
                } catch {
                    self.error = BBClient.describe(error, server: app.client.baseURL)
                }
            }
        }
        .interactiveDismissDisabled(!text.isEmpty)
    }

    private func post() async {
        guard let block else { return }
        posting = true
        defer { posting = false }
        do {
            try await app.client.commentOnPage(model.pageId, block: block, text: text.trimmingCharacters(in: .whitespacesAndNewlines))
            await model.loadComments(app.client)
            dismiss()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
