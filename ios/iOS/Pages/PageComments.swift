import SwiftUI
import UIKit

/// A page's comment threads in page order, as the desktop's panel: read,
/// reply, resolve or reopen, show resolved, start one, and Show in page,
/// which scrolls the page to the thread's block. Comments are written as you.
struct PageCommentsSheet: View {
    @ObservedObject var model: PageModel
    /// The thread to open at (a block's comment mark).
    var focus: String?
    let showBlock: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var drafts: [String: String] = [:]
    @State private var sending: String?
    @State private var showResolved = false
    @State private var composing = false
    @State private var error: String?

    private var threads: [PageCommentThread] {
        model.orderedThreads.filter { showResolved || !$0.resolved }
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                    ForEach(threads) { thread in
                        PageThreadSection(thread: thread, focused: thread.id == focus, draft: draft(thread), sending: sending == thread.id,
                                          resolve: { resolved in await perform { try await $0.resolve(model.pageId, thread: thread.id, resolved: resolved) } },
                                          show: model.block(of: thread).map { block in { show(block.id) } },
                                          send: { await send(thread) })
                            .id(thread.id)
                    }
                }
                .onAppear { if let focus { proxy.scrollTo(focus, anchor: .top) } }
            }
            .overlay {
                if model.comments != nil, threads.isEmpty {
                    ContentUnavailableView {
                        Label(showResolved ? "No comments" : "No open comments", systemImage: "text.bubble")
                    } description: {
                        Text("Touch and hold a block in the page to comment on it.")
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
                    Picker("Show", selection: $showResolved) {
                        Text("Open").tag(false)
                        Text("Resolved").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("commentsFilter")
                    Button { composing = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("New Comment")
                }
            }
            .refreshable { await model.loadComments() }
            .sheet(isPresented: $composing) { NewPageCommentSheet(model: model, block: nil) }
            .task { await model.loadComments() }
        }
    }

    private func draft(_ thread: PageCommentThread) -> Binding<String> {
        Binding(get: { drafts[thread.id] ?? "" }, set: { drafts[thread.id] = $0 })
    }

    private func show(_ block: String) {
        dismiss()
        showBlock(block)
    }

    private func send(_ thread: PageCommentThread) async {
        let text = (drafts[thread.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sending = thread.id
        await perform { try await $0.reply(model.pageId, thread: thread.id, text: text) }
        if error == nil { drafts[thread.id] = nil }
        sending = nil
    }

    private func perform(_ action: (PageCommentBackend) async throws -> Void) async {
        do {
            try await action(model.backend)
            error = nil
            await model.loadComments()
        } catch {
            self.error = BBClient.describe(error, server: model.serverURL)
        }
    }
}

/// One thread: its quote, its comments, a reply field, and Resolve / Reopen and Show in page.
private struct PageThreadSection: View {
    let thread: PageCommentThread
    let focused: Bool
    @Binding var draft: String
    let sending: Bool
    let resolve: (Bool) async -> Void
    let show: (() -> Void)?
    let send: () async -> Void
    @Environment(\.look) private var look

    var body: some View {
        Section {
            if !thread.quote.isEmpty {
                Text(thread.quote)
                    .font(.subheadline).italic()
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .listRowBackground(focused ? Color.yellow.opacity(0.15) : nil)
            }
            ForEach(thread.comments) { comment in
                CommentRow(comment: comment)
            }
            if !thread.resolved { replyRow }
        } header: {
            HStack {
                if thread.resolved { Text("Resolved") }
                if let show {
                    Button("Show in page", action: show).font(.caption.weight(.semibold))
                        .accessibilityIdentifier("commentShow-\(thread.id)")
                }
                Spacer()
                Button(thread.resolved ? "Reopen" : "Resolve") {
                    let resolved = !thread.resolved
                    Task { await resolve(resolved) }
                }
                .font(.caption.weight(.semibold))
                .accessibilityIdentifier("commentResolve-\(thread.id)")
            }
            .textCase(nil)
        }
    }

    private var replyRow: some View {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return HStack(alignment: .bottom) {
            TextField("Reply", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                .accessibilityIdentifier("commentReply-\(thread.id)")
            Button { Task { await send() } } label: {
                if sending { ProgressView() } else { Image(systemName: "arrow.up.circle.fill").font(.title2) }
            }
            .buttonStyle(.borderless)
            .disabled(text.isEmpty || sending)
            .blockedWhileDictating()
            .accessibilityLabel("Send Reply")
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

/// A new comment: the block (chosen here, or the one touched and held in the
/// page), then, as on the desktop, the words it marks: select them in the
/// block's text, or leave it to mark the whole block.
struct NewPageCommentSheet: View {
    @ObservedObject var model: PageModel
    /// The block the comment is on, when it came from one.
    let block: String?
    @Environment(\.dismiss) private var dismiss
    @State private var blocks: [PageTextBlock]?
    @State private var chosen: String?
    @State private var quote = ""
    @State private var text = ""
    @State private var posting = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var selected: PageTextBlock? {
        guard let id = chosen ?? block else { return nil }
        return blocks?.first { $0.id == id || $0.id.hasPrefix(id) || PageDocument.shortId($0.id) == id }
    }

    private var canPost: Bool {
        selected != nil && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !posting
    }

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                Section {
                    TextField("Write a comment", text: $text, axis: .vertical)
                        .lineLimit(2...8)
                        .focused($focused)
                        .accessibilityIdentifier("newCommentField")
                }
                if let selected {
                    Section {
                        PageQuotePicker(text: selected.text, quote: $quote)
                            .frame(minHeight: 60)
                            .accessibilityIdentifier("commentQuotePicker")
                    } header: {
                        Text("On")
                    } footer: {
                        Text(quote.isEmpty ? "Select words to mark only them." : "Marks \u{201C}\(quote)\u{201D}.")
                    }
                    if block == nil {
                        Button("Choose Another Block") { chosen = nil; quote = "" }
                    }
                } else {
                    blockList
                }
            }
            .navigationTitle("New Comment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Post") { Task { await post() } }.disabled(!canPost).blockedWhileDictating()
                        .accessibilityIdentifier("newCommentPost")
                }
            }
            .task {
                focused = true
                do {
                    blocks = try await model.backend.blocks(model.pageId)
                } catch {
                    self.error = BBClient.describe(error, server: model.serverURL)
                }
            }
        }
        .interactiveDismissDisabled(!text.isEmpty)
    }

    @ViewBuilder private var blockList: some View {
        Section("On") {
            if let blocks {
                ForEach(blocks) { item in
                    Button { chosen = item.id } label: { Text(item.text).lineLimit(3) }
                        .foregroundStyle(.primary)
                }
                if blocks.isEmpty { Text("This page has no text to comment on.").foregroundStyle(.secondary) }
            } else if error == nil {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
    }

    private func post() async {
        guard let selected else { return }
        posting = true
        defer { posting = false }
        do {
            try await model.backend.create(model.pageId, block: selected.id, quote: quote.isEmpty ? nil : quote,
                                           text: text.trimmingCharacters(in: .whitespacesAndNewlines))
            await model.loadComments()
            dismiss()
        } catch {
            self.error = BBClient.describe(error, server: model.serverURL)
        }
    }
}

/// A block's text to select words in: the selection is the comment's quote.
private struct PageQuotePicker: UIViewRepresentable {
    let text: String
    @Binding var quote: String

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.delegate = context.coordinator
        view.text = text
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.quote = $quote
        if view.text != text { view.text = text }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? 320
        return CGSize(width: width, height: uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height)
    }

    func makeCoordinator() -> Coordinator { Coordinator(quote: $quote) }

    final class Coordinator: NSObject, UITextViewDelegate {
        var quote: Binding<String>
        init(quote: Binding<String>) { self.quote = quote }

        func textViewDidChangeSelection(_ view: UITextView) {
            let selected = (view.text as NSString).substring(with: view.selectedRange)
            quote.wrappedValue = selected.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }
}
