import SwiftUI

struct RelatedSection: View {
    @EnvironmentObject private var app: AppModel
    let pluginId: String
    let itemId: String
    @State private var links: Studio.LinksOutput?
    @State private var threads: Studio.ItemThreadsOutput?
    @State private var comments: Studio.CommentsOutput?
    @State private var replyingTo: String?
    @State private var reply = ""
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
            ForEach(Array((comments?.comments ?? []).enumerated()), id: \.offset) { _, comment in
                VStack(alignment: .leading, spacing: 6) {
                    Text(comment.body ?? "").textSelection(.enabled)
                    HStack {
                        Button("Reply") { replyingTo = comment.id }
                        if comment.parentId == nil, let id = comment.id {
                            Button(comment.resolvedAt == nil ? "Resolve" : "Reopen") {
                                Task { await resolve(id, resolved: comment.resolvedAt == nil) }
                            }
                        }
                    }
                    .font(.caption)
                }
            }
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            if links == nil, threads == nil, comments == nil, error == nil { ProgressView() }
            if links != nil, threads != nil, comments != nil,
               links?.outgoing?.isEmpty != false, links?.backlinks?.isEmpty != false,
               threads?.threads?.isEmpty != false, comments?.comments?.isEmpty != false {
                Text("No related items yet").foregroundStyle(.secondary)
            }
        }
        .alert("Reply", isPresented: Binding(get: { replyingTo != nil }, set: { if !$0 { replyingTo = nil } })) {
            TextField("Reply", text: $reply, axis: .vertical)
            Button("Cancel", role: .cancel) { reply = "" }
            Button("Send") { Task { await sendReply() } }
        }
        .task(id: itemId) { await load() }
    }

    @ViewBuilder
    private func relatedItem(_ plugin: String?, _ id: String?, label: String) -> some View {
        if let plugin, let id {
            let href = "/plugins/\(plugin)/\(plugin == "pages" ? "pages" : plugin == "studio-tables" ? "tables" : plugin == "talk" ? "recordings" : plugin == "excalidraw" ? "drawings" : plugin == "design" ? "designs" : "artifacts")/\(id)"
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
        guard let parentId = replyingTo else { return }
        let body = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        reply = ""
        replyingTo = nil
        guard !body.isEmpty else { return }
        do {
            try await app.client.replyToStudioComment(pluginId: pluginId, id: itemId, parentId: parentId, body: body)
            await load()
        } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
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
            List { RelatedSection(pluginId: pluginId, itemId: itemId) }
                .navigationTitle("Related")
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}
