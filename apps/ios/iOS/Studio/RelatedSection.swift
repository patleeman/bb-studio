import SwiftUI

struct RelatedSection: View {
    @EnvironmentObject private var app: AppModel
    let pluginId: String
    let itemId: String
    @State private var links: Studio.LinksOutput?
    @State private var threads: Studio.ItemThreadsOutput?
    @State private var comments: Studio.CommentsOutput?
    @StateObject private var reply = RelatedReply()
    @FocusState private var replyFocused: Bool
    /// Scrolls the list that holds this section, so a failed reply's field stays above the keyboard.
    var reveal: (String) -> Void = { _ in }
    @State private var error: String?

    var body: some View {
        Section("Related") {
            ForEach(Array((links?.outgoing ?? []).enumerated()), id: \.offset) { _, link in
                if let target = link.to {
                    relatedItem(target.pluginId, target.id, label: "Linked item")
                }
            }
            ForEach(Array((links?.backlinks ?? []).enumerated()), id: \.offset) { _, link in
                if let source = link.from {
                    relatedItem(source.pluginId, source.id, label: "Linked from")
                }
            }
            ForEach(Array((threads?.threads ?? []).enumerated()), id: \.offset) { _, thread in
                if let id = thread.threadId {
                    NavigationLink(value: Route.thread(id: id)) {
                        Label("Thread · \(thread.state ?? thread.role ?? "")", systemImage: Symbols.thread)
                    }
                }
            }
            ForEach(Array(commentThreads.enumerated()), id: \.offset) { _, thread in
                ForEach(Array(thread.enumerated()), id: \.offset) { _, comment in commentRow(comment) }
                if let parentId = reply.parentId, thread.contains(where: { $0.id == parentId }) { replyRow }
            }
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            if links == nil, threads == nil, comments == nil, error == nil { ProgressView() }
            if links != nil, threads != nil, comments != nil,
               links?.outgoing?.isEmpty != false, links?.backlinks?.isEmpty != false,
               threads?.threads?.isEmpty != false, comments?.comments?.isEmpty != false {
                Text("No related items yet").foregroundStyle(.secondary)
            }
        }
        .task(id: itemId) { await load() }
    }

    /// Each top-level comment with the replies under it, in BB's order. A reply
    /// whose parent isn't in the list stands on its own.
    private var commentThreads: [[Studio.CommentsOutputCommentsItem]] {
        let all = comments?.comments ?? []
        let ids = Set(all.compactMap(\.id))
        func replies(to id: String?) -> [Studio.CommentsOutputCommentsItem] {
            guard let id else { return [] }
            return all.filter { $0.parentId == id }.flatMap { [$0] + replies(to: $0.id) }
        }
        return all.filter { $0.parentId.map { !ids.contains($0) } ?? true }.map { [$0] + replies(to: $0.id) }
    }

    private func commentRow(_ comment: Studio.CommentsOutputCommentsItem) -> some View {
        let replying = comment.id != nil && reply.parentId == comment.id
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(comment.actor?.name ?? "Comment").font(.subheadline.weight(.semibold))
                if let createdAt = comment.createdAt {
                    Text(Date(timeIntervalSince1970: createdAt / 1000), format: .relative(presentation: .named, unitsStyle: .abbreviated))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if comment.resolvedAt != nil {
                    Text("Resolved").font(.caption).foregroundStyle(.secondary)
                }
            }
            Text(comment.body ?? "").textSelection(.enabled)
            HStack(spacing: 16) {
                Button(replying ? "Cancel" : "Reply") {
                    if replying { reply.text = ""; reply.parentId = nil } else { reply.parentId = comment.id }
                }
                .disabled(reply.posting)
                if comment.parentId == nil, let id = comment.id {
                    Button(comment.resolvedAt == nil ? "Resolve" : "Reopen") {
                        Task { await resolve(id, resolved: comment.resolvedAt == nil) }
                    }
                }
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.borderless)
            .padding(.top, 2)
        }
        .padding(.vertical, 2)
        .padding(.leading, comment.parentId == nil ? 0 : 16)
        .overlay(alignment: .leading) {
            if comment.parentId != nil { Capsule().fill(.quaternary).frame(width: 2) }
        }
    }

    /// Writes a reply under the comment it answers. What's typed stays until BB has it.
    private var replyRow: some View {
        let empty = reply.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return VStack(alignment: .leading, spacing: 6) {
            // Above the field, where the keyboard can't cover it.
            if let error = reply.error {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text(error)
                }
                .font(.footnote)
                .foregroundStyle(.red)
            }
            HStack(alignment: .bottom) {
                TextField("Reply", text: $reply.text, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($replyFocused)
                Button { Task { await sendReply() } } label: {
                    if reply.posting {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.up.circle.fill").font(.title2)
                    }
                }
                .buttonStyle(.borderless)
                .disabled(empty || reply.posting)
                .blockedWhileDictating()
                .accessibilityLabel("Send Reply")
            }
        }
        .id(Self.replyRowID)
        .onAppear { replyFocused = true }
        .onChange(of: reply.error) { _, error in if error != nil { reveal(Self.replyRowID) } }
    }

    static let replyRowID = "relatedReplyRow"


    @ViewBuilder
    private func relatedItem(_ plugin: String?, _ id: String?, label: String) -> some View {
        if let plugin, let id {
            let href = plugin == "artifacts" ? "/plugins/studio/studio/artifacts/\(id)"
                : plugin == "excalidraw" ? "/plugins/studio/studio/drawings/\(id)"
                : plugin == "talk" ? "/plugins/studio/studio/recordings/\(id)"
                : plugin == "pages" ? "/plugins/studio/studio/pages/\(id)"
                : plugin == "dashboards" ? "/plugins/studio/studio/dashboards/\(id)"
                : plugin == "minis" ? "/plugins/studio/studio/minis/\(id)"
                : "/plugins/studio/studio/designs/\(id)"
            if let route = Route(href: href) {
                NavigationLink(value: route) { Label(label, systemImage: "link") }
            } else {
                Label("\(label): \(plugin)", systemImage: "link")
            }
        }
    }

    private func load() async {
        async let foundLinks = try? app.client.studioLinks(pluginId: pluginId, id: itemId)
        async let foundThreads = try? app.client.studioItemThreads(pluginId: pluginId, id: itemId)
        async let foundComments = try? app.client.studioComments(pluginId: pluginId, id: itemId)
        links = await foundLinks
        threads = await foundThreads
        comments = await foundComments
        if links == nil, threads == nil, comments == nil { error = "Related items are unavailable." }
    }

    private func sendReply() async {
        await reply.send(pluginId: pluginId, itemId: itemId, client: app.client)
        if reply.error == nil { await load() }
    }

    private func resolve(_ id: String, resolved: Bool) async {
        do {
            try await app.client.resolveStudioComment(pluginId: pluginId, id: itemId, commentId: id, resolved: resolved)
            await load()
        } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }
}

struct RelatedView: View {
    let pluginId: String
    let itemId: String

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    RelatedSection(pluginId: pluginId, itemId: itemId) { id in
                        withAnimation { proxy.scrollTo(id, anchor: .bottom) }
                    }
                }
            }
            .navigationTitle("Related")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

@MainActor
final class RelatedReply: ObservableObject {
    @Published var parentId: String?
    @Published var text = ""
    @Published private(set) var posting = false
    @Published private(set) var error: String?

    func send(pluginId: String, itemId: String, client: BBClient) async {
        guard !posting, let parentId else { return }
        let submitted = text
        let body = submitted.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        posting = true
        error = nil
        defer { posting = false }
        do {
            try await client.replyToStudioComment(pluginId: pluginId, id: itemId, parentId: parentId, body: body)
            if text == submitted, self.parentId == parentId {
                text = ""
                self.parentId = nil
            }
        } catch { self.error = BBClient.describe(error, server: client.baseURL) }
    }
}
