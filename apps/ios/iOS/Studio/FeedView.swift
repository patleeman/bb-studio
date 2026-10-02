import SwiftUI

/// Studio Feed: what agents post, newest first, each story once by its newest post.
struct FeedView: View {
    @EnvironmentObject private var app: AppModel
    @State private var posts: [FeedPost] = []
    @State private var topics: [String] = []
    @State private var topic: String?
    @State private var query = ""
    @State private var nextCursor: String?
    @State private var loaded = false
    @State private var loadingMore = false
    @State private var error: String?
    @State private var removing: FeedPost?
    @State private var listener: UUID?

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.red) }
            if topics.count > 1 {
                Section { topicBar }.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
            ForEach(posts) { row($0) }
            if nextCursor != nil {
                Button { Task { await loadMore() } } label: {
                    if loadingMore { ProgressView() } else { Text("More") }
                }
                .frame(maxWidth: .infinity)
                .onAppear { Task { await loadMore() } }
            }
        }
        .overlay {
            if !loaded, error == nil {
                ProgressView()
            } else if loaded, posts.isEmpty {
                if !query.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    ContentUnavailableView(
                        "Nothing posted yet", systemImage: "newspaper",
                        description: Text("Agents post here when a reply ends with a ::post line."))
                }
            }
        }
        .navigationTitle(topic ?? "Feed")
        .toolbar {
            if posts.contains(where: { !$0.read }) {
                Button("Mark all read") { Task { await markAllRead() } }
                .accessibilityIdentifier("feedMarkAllRead")
            }
        }
        .searchable(text: $query, prompt: "Search the feed")
        .refreshable { await load() }
        .task(id: "\(topic ?? "")|\(query)") {
            if !query.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
            guard !Task.isCancelled else { return }
            await load()
        }
        .task {
            listener = app.realtime.listen { event in
                guard case .pluginSignal(let pluginId, _, _) = event, pluginId == "feed" else { return }
                Task { await load() }
            }
        }
        // Back from a post, which marked its story read.
        .onAppear { if loaded { Task { await load() } } }
        .onDisappear { if let listener { app.realtime.removeListener(listener) } }
        .confirmationDialog(
            "Remove \u{201C}\(removing?.title ?? "")\u{201D}?",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                if let post = removing { Task { await remove(post) } }
            }
        } message: {
            Text("It's deleted from the feed for everyone.")
        }
        .accessibilityIdentifier("feed")
    }

    private var topicBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                pill("All", selected: topic == nil) { topic = nil }
                ForEach(topics, id: \.self) { name in
                    pill(name, selected: topic?.lowercased() == name.lowercased()) { topic = name }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
    }

    private func pill(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(selected ? .semibold : .regular))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(selected ? AnyShapeStyle(Color.accentColor.opacity(0.18)) : AnyShapeStyle(.fill.tertiary), in: .capsule)
        }
        .buttonStyle(.plain)
    }

    private func row(_ post: FeedPost) -> some View {
        NavigationLink(value: Route.feedPost(id: post.id)) {
            FeedRow(post: post)
        }
        .swipeActions(edge: .leading) {
            Button { Task { await markRead(post, !post.read) } } label: {
                Label(post.read ? "Unread" : "Read", systemImage: post.read ? "circle.fill" : "circle")
            }
            .tint(.accentColor)
            Button { Task { await resolve(post) } } label: {
                Label(post.isResolved ? "Reopen" : "Resolve", systemImage: post.isResolved ? "arrow.uturn.backward" : "checkmark")
            }
            .tint(.green)
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { removing = post } label: { Label("Remove", systemImage: "trash") }
        }
        .contextMenu {
            if let threadId = post.threadId {
                Button { app.push(.thread(id: threadId)) } label: {
                    Label(post.openThreadLabel, systemImage: "bubble.left")
                }
            }
            Button { app.newThread(text: post.discussPrompt) } label: {
                Label("New thread about this", systemImage: "plus.bubble")
            }
        }
    }

    /// Loading leaves read state alone; opening a post or Mark all read changes it.
    private func load() async {
        do {
            async let names = try? app.client.feedTopics()
            let page = try await app.client.feed(topic: topic, query: query)
            posts = page.posts
            nextCursor = page.nextCursor
            topics = await names ?? topics
            error = nil
            loaded = true
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
            loaded = true
        }
    }

    private func loadMore() async {
        guard let cursor = nextCursor, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        guard let page = try? await app.client.feed(cursor: cursor, topic: topic, query: query) else { return }
        let ids = Set(posts.map(\.id))
        posts += page.posts.filter { !ids.contains($0.id) }
        nextCursor = page.nextCursor
    }

    /// The whole story, as the server marks it.
    private func markRead(_ post: FeedPost, _ read: Bool) async {
        do {
            try await app.client.markFeedPost(post.id, read: read)
            for index in posts.indices where posts[index].id == post.id || (post.story != nil && posts[index].story == post.story) {
                posts[index].read = read
            }
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func markAllRead() async {
        do {
            try await app.client.markFeedSeen()
            for index in posts.indices { posts[index].read = true }
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func resolve(_ post: FeedPost) async {
        do {
            if let updated = try await app.client.resolveFeedPost(post.id, resolved: !post.isResolved),
                let index = posts.firstIndex(where: { $0.id == post.id })
            {
                posts[index].resolvedAt = updated.resolvedAt
            }
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func remove(_ post: FeedPost) async {
        do {
            try await app.client.removeFeedPost(post.id)
            posts.removeAll { $0.id == post.id }
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

/// A feed row: title, who and where, topic, age, earlier updates and linked sites. Unread rows are bold with a dot.
struct FeedRow: View {
    let post: FeedPost

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle().fill(post.read ? .clear : Color.accentColor).frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 4) {
                Text(post.title)
                    .font(.body.weight(post.read ? .regular : .semibold))
                    .foregroundStyle(post.read ? .secondary : .primary)
                    .lineLimit(3)
                if !post.preview.isEmpty {
                    Text(post.preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
                FeedMeta(post: post)
            }
        }
        .opacity(post.isResolved ? 0.6 : 1)
        .accessibilityIdentifier("feedRow")
    }
}

struct FeedMeta: View {
    let post: FeedPost

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                if post.isUrgent, !post.isResolved { FeedBadge(label: "Urgent", color: .red) }
                if post.isResolved { FeedBadge(label: "Resolved", color: .green) }
                Text(post.from).lineLimit(1)
                if let topic = post.topic { Text("· \(topic)").lineLimit(1) }
                Text("· \(post.created, style: .relative)").lineLimit(1)
            }
            if post.storyPosts > 1 || !post.domains.isEmpty {
                HStack(spacing: 6) {
                    if post.storyPosts > 1 {
                        Text("\(post.storyPosts - 1) earlier \(post.storyPosts == 2 ? "update" : "updates")")
                    }
                    if !post.domains.isEmpty {
                        Text(post.domains.prefix(3).joined(separator: ", ")).lineLimit(1)
                    }
                }
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }
}

private struct FeedBadge: View {
    let label: String
    let color: Color

    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.14), in: .capsule)
    }
}

/// One post, with Discuss and Resolve and the story's earlier updates.
struct FeedPostView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var post: FeedPost?
    @State private var story: [FeedPost] = []
    @State private var missing = false
    @State private var error: String?
    @State private var confirmingRemove = false
    @State private var listener: UUID?
    /// Opening it marks its story read, once, so Mark Unread sticks.
    @State private var markedRead = false

    var body: some View {
        Group {
            if let post {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(post.title).font(.title2.bold())
                        FeedMeta(post: post)
                        actions(post)
                        if !post.body.isEmpty { MarkdownText(post.body).textSelection(.enabled) }
                        if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                        let earlier = story.filter { $0.id != post.id && $0.createdAt <= post.createdAt }.reversed()
                        if !earlier.isEmpty {
                            Divider()
                            Text("Earlier in this story").font(.headline)
                            ForEach(Array(earlier)) { update in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(update.title).font(.subheadline.weight(.semibold))
                                    Text("\(update.from) · \(update.created, style: .relative)")
                                        .font(.caption).foregroundStyle(.secondary)
                                    if !update.body.isEmpty { MarkdownText(update.body).font(.subheadline) }
                                }
                                .padding(.leading, 12)
                                .overlay(alignment: .leading) { Capsule().fill(.tertiary).frame(width: 3) }
                            }
                        }
                    }
                    .frame(maxWidth: 720, alignment: .leading)
                    .padding()
                    .frame(maxWidth: .infinity)
                }
            } else if missing {
                ContentUnavailableView("Post removed", systemImage: "newspaper", description: Text("It's no longer in the feed."))
            } else if let error {
                ContentUnavailableView("Couldn't open the post", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .navigationTitle(post?.topic ?? "Feed")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let post {
                Menu {
                    ShareLink(item: URL(string: post.href, relativeTo: app.serverURL)!.absoluteURL) {
                        Label("Share link", systemImage: "square.and.arrow.up")
                    }
                    Button { Task { await markRead(post, !post.read) } } label: {
                        Label(post.read ? "Mark unread" : "Mark read", systemImage: post.read ? "circle.fill" : "circle")
                    }
                    Button(role: .destructive) { confirmingRemove = true } label: { Label("Remove", systemImage: "trash") }
                } label: {
                    Label("More", systemImage: "ellipsis")
                }
            }
        }
        .confirmationDialog("Remove this post?", isPresented: $confirmingRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive) { Task { await remove() } }
        } message: {
            Text("It's deleted from the feed for everyone.")
        }
        .refreshable { await load() }
        .task {
            listener = app.realtime.listen { event in
                guard case .pluginSignal(let pluginId, _, let payload) = event, pluginId == "feed" else { return }
                // A removal or a change to this post or its story.
                let changed = payload["postId"]?.stringValue
                let story = payload["story"]?.stringValue
                guard changed == nil || changed == id || (story != nil && story == post?.story) else { return }
                Task { await load() }
            }
            await load()
        }
        .onDisappear { if let listener { app.realtime.removeListener(listener) } }
    }

    private func actions(_ post: FeedPost) -> some View {
        HStack(spacing: 10) {
            Menu {
                if let threadId = post.threadId {
                    Button { app.push(.thread(id: threadId)) } label: {
                        Label(post.openThreadLabel, systemImage: "bubble.left")
                    }
                }
                Button { app.newThread(text: post.discussPrompt) } label: {
                    Label("New thread about this", systemImage: "plus.bubble")
                }
            } label: {
                Label("Discuss", systemImage: "bubble.left.and.bubble.right")
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("feedDiscuss")
            Button {
                Task { await resolve(post) }
            } label: {
                Label(post.isResolved ? "Reopen" : "Resolve", systemImage: post.isResolved ? "arrow.uturn.backward" : "checkmark")
            }
            .buttonStyle(.bordered)
        }
        .controlSize(.small)
    }

    private func load() async {
        do {
            guard let post = try await app.client.feedPost(id) else {
                missing = true
                return
            }
            self.post = post
            if !post.read, !markedRead {
                markedRead = true
                if let updated = try? await app.client.markFeedPost(id, read: true) { self.post = updated }
            }
            if let key = post.story, post.storyPosts > 1 {
                story = (try? await app.client.feedStory(key)) ?? []
            } else {
                story = []
            }
            error = nil
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func markRead(_ post: FeedPost, _ read: Bool) async {
        markedRead = true
        do {
            if let updated = try await app.client.markFeedPost(post.id, read: read) { self.post = updated }
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func resolve(_ post: FeedPost) async {
        do {
            if let updated = try await app.client.resolveFeedPost(post.id, resolved: !post.isResolved) { self.post = updated }
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func remove() async {
        do {
            try await app.client.removeFeedPost(id)
            dismiss()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

/// `::post{title="…"}` in a reply: the feed post it made.
struct FeedPostCard: View {
    @EnvironmentObject private var app: AppModel
    /// The directive line.
    let source: String
    let title: String
    @State private var post: FeedPost?

    var body: some View {
        Button {
            if let post { app.push(.feedPost(id: post.id)) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "newspaper")
                    .font(.body.weight(.medium))
                    .foregroundStyle(.orange)
                    .frame(width: 44, height: 44)
                    .background(Color.orange.opacity(0.12), in: .rect(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 3) {
                    Text(post?.title ?? title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                    Text(post.map { "Posted to the feed\($0.topic.map { " · \($0)" } ?? "")" } ?? "Posting to the feed…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(10)
            .frame(maxWidth: 420, alignment: .leading)
            .background(.fill.quaternary, in: .rect(cornerRadius: 14))
            .contentShape(.rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .disabled(post == nil)
        .accessibilityIdentifier("feedPostCard")
        .task(id: source) {
            // The post is published when the thread goes idle, a moment after the reply shows.
            for _ in 0..<8 {
                if let found = try? await app.client.feedPost(directive: source) {
                    post = found
                    return
                }
                try? await Task.sleep(for: .seconds(1.5))
                if Task.isCancelled { return }
            }
        }
    }
}
