import SwiftUI

/// A saved timeline over ordinary BB threads. Work and approvals stay in each thread.
struct SavedViewScreen: View {
    @EnvironmentObject private var app: AppModel
    let id: String
    @State private var page: SavedViewPage?
    @State private var bots: [Bot] = []
    @State private var draft = ""
    @State private var targets = Set<SavedViewMember>()
    @State private var reply: String?
    @State private var fresh = false
    @State private var sending = false
    @State private var error: String?
    @State private var editing = false
    @State private var listener: UUID?
    @State private var retryId = UUID().uuidString.lowercased()
    @State private var retrySignature: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                if let page {
                    ForEach(page.threads.filter { $0.parentThreadId == nil }) { thread in
                        NavigationLink(value: Route.thread(id: thread.id)) {
                            Label(thread.title + (["active", "starting"].contains(thread.status) ? " · Working…" : ""), systemImage: "bubble.left")
                        }.font(.caption)
                    }
                    if page.hasOlder {
                        Button("Earlier replies") { Task { await loadOlder() } }
                    }
                    if page.entries.isEmpty { Text("Send a message to start work in this channel.").foregroundStyle(.secondary).padding(.vertical, 40) }
                    ForEach(page.entries.filter { entry in page.threads.contains { $0.id == entry.threadId && $0.parentThreadId == nil } }) { entry in
                        entryRow(entry)
                        if page.entries.last(where: { $0.threadId == entry.threadId })?.id == entry.id {
                            ForEach(page.threads.filter { $0.parentThreadId == entry.threadId }) { child in
                                childGroup(child, page: page)
                            }
                        }
                    }
                    ForEach(page.threads.filter { thread in thread.parentThreadId == nil && !page.entries.contains { $0.threadId == thread.id } }) { root in
                        ForEach(page.threads.filter { $0.parentThreadId == root.id }) { child in
                            childGroup(child, page: page)
                        }
                    }
                } else { ProgressView() }
            }.padding()
        }
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) { composer }
        .navigationTitle(page?.view.name ?? "Channel")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Edit channel") { editing = true }.disabled(page == nil) } }
        .sheet(isPresented: $editing) { if let view = page?.view { SavedViewEditor(initial: view) { _ in Task { await load() } } } }
        .task {
            listener = app.realtime.listen { event in
                if case .pluginSignal(let pluginId, _, _) = event, pluginId == "bot-teams" { Task { await load() } }
            }
            bots = (try? await app.client.profiles()) ?? []
            await load()
        }
        .onDisappear { if let listener { app.realtime.removeListener(listener) }; listener = nil }
    }

    private func childGroup(_ thread: SavedViewThread, page: SavedViewPage) -> AnyView {
        AnyView(DisclosureGroup(thread.title) {
            NavigationLink("Open thread", value: Route.thread(id: thread.id))
            ForEach(page.entries.filter { $0.threadId == thread.id }) { entry in entryRow(entry) }
            ForEach(page.threads.filter { $0.parentThreadId == thread.id }) { child in
                childGroup(child, page: page)
            }
        })
    }

    private func entryRow(_ entry: SavedViewEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                NavigationLink(entry.role == "user" ? "You" : label(entry.threadId), value: Route.thread(id: entry.threadId)).font(.subheadline.bold())
                Spacer()
                Text(Date(timeIntervalSince1970: entry.createdAt / 1000), style: .time).font(.caption).foregroundStyle(.secondary)
                Button("Reply") { reply = entry.threadId; targets.removeAll() }.font(.caption)
            }
            MarkdownText(entry.text).textSelection(.enabled)
        }.padding(.vertical, 6)
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            if let reply {
                HStack { Text("Replying to \(label(reply))").font(.caption); Spacer(); Button("Cancel") { self.reply = nil } }
            }
            ScrollView(.horizontal) {
                HStack {
                    ForEach(page?.view.members ?? [], id: \.self) { member in
                        Button { if targets.contains(member) { targets.remove(member) } else { targets.insert(member) } } label: {
                            Label(member.kind == "bot" ? bots.first { $0.id == member.id }?.name ?? "Bot" : label(member.id), systemImage: targets.contains(member) ? "checkmark.circle.fill" : "circle")
                        }.font(.caption)
                    }
                }
            }
            Toggle("New bot threads", isOn: $fresh).font(.caption)
            HStack(alignment: .bottom) {
                TextField("Message or @mention members…", text: $draft, axis: .vertical).lineLimit(2...6).textFieldStyle(.roundedBorder)
                Button { Task { await send() } } label: { if sending { ProgressView() } else { Image(systemName: "arrow.up.circle.fill").font(.title2) } }
                    .accessibilityLabel("Send message").disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || page?.view.archived == true)
            }
        }.padding().background(.bar)
    }

    private func label(_ threadId: String) -> String {
        let thread = page?.threads.first { $0.id == threadId }
        return bots.first { $0.id == thread?.botId }?.name ?? thread?.title ?? "Thread"
    }

    private func load() async {
        do {
            let next = try await app.client.savedView(id)
            var updated = next
            if let previous = page {
                let old = previous.entries.filter { $0.createdAt < (next.entries.first?.createdAt ?? 0) }
                updated.entries = old + next.entries
                if !old.isEmpty { updated.hasOlder = previous.hasOlder }
            }
            if page == nil, ["New view", "New channel"].contains(next.view.name), next.view.members.isEmpty { editing = true }
            page = updated
        } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }

    private func loadOlder() async {
        guard let first = page?.entries.first else { return }
        do {
            let older = try await app.client.savedView(id, before: first)
            page?.entries.insert(contentsOf: older.entries, at: 0)
            page?.hasOlder = older.hasOlder
        } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }

    private func send() async {
        sending = true
        defer { sending = false }
        var text = draft
        var mode = "auto"
        for action in ["steer", "followup", "fork"] where text.hasPrefix("/\(action) ") { mode = action; text = String(text.dropFirst(action.count + 2)); break }
        let selected = targets.sorted { ($0.kind + $0.id) < ($1.kind + $1.id) }
        let signature = "\(text)|\(selected)|\(reply ?? "")|\(fresh)|\(mode)"
        if retrySignature != signature { retrySignature = signature; retryId = UUID().uuidString.lowercased() }
        do {
            let result = try await app.client.sendToView(id, text: text, targets: selected, replyThreadId: reply, fresh: fresh, mode: mode, requestId: retryId)
            let failures = result.deliveries.filter { $0.status == "error" }
            if failures.isEmpty { draft = ""; reply = nil; targets.removeAll(); retrySignature = nil; error = nil }
            else { error = failures.compactMap(\.error).joined(separator: "\n") }
            await load()
        } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }
}

struct FormerChannelScreen: View {
    @EnvironmentObject private var app: AppModel
    let id: String
    @State private var page: SavedViewPage?
    @State private var error: String?
    var body: some View {
        Group {
            if let page {
                if page.view.members.count == 1, let thread = page.threads.first { ThreadView(threadId: thread.id) }
                else { SavedViewScreen(id: id) }
            } else if let error { ContentUnavailableView("View unavailable", systemImage: "exclamationmark.bubble", description: Text(error)) }
            else { ProgressView() }
        }.task { do { page = try await app.client.savedView(id) } catch { self.error = BBClient.describe(error, server: app.client.baseURL) } }
    }
}
