import SwiftUI

/// What bots flagged for you across every channel: decisions, blockers and
/// updates. Acknowledge, snooze, or open the channel to reply.
struct AttentionView: View {
    @EnvironmentObject private var app: AppModel
    @State private var status = "open"
    @State private var items: [AttentionItem] = []
    @State private var nextOffset: Int?
    @State private var rooms: [String: Room] = [:]
    @State private var loaded = false
    @State private var error: String?
    @State private var done = 0

    var body: some View {
        List {
            if let error {
                Section { ConnectionBanner(message: error) { await load() } }
            }
            ForEach(items) { item in
                Button {
                    if let room = rooms[item.roomId] { app.path.append(.room(room)) }
                } label: {
                    AttentionRow(item: item)
                }
                .foregroundStyle(.primary)
                .swipeActions(edge: .leading) {
                    if item.status == "open" {
                        Button { Task { await update(item, "acknowledge") } } label: { Label("Done", systemImage: "checkmark") }
                            .tint(.green)
                    } else {
                        Button { Task { await update(item, "reopen") } } label: { Label("Reopen", systemImage: "arrow.uturn.backward") }
                            .tint(.blue)
                    }
                }
                .swipeActions(edge: .trailing) {
                    if item.status == "open" {
                        Button { Task { await update(item, "snooze", minutes: 60) } } label: { Label("1 hour", systemImage: "moon.zzz") }
                            .tint(.indigo)
                    }
                }
                .contextMenu {
                    if item.status == "open" {
                        Button { Task { await update(item, "acknowledge") } } label: { Label("Mark done", systemImage: "checkmark") }
                        Menu {
                            Button("1 hour") { Task { await update(item, "snooze", minutes: 60) } }
                            Button("3 hours") { Task { await update(item, "snooze", minutes: 180) } }
                            Button("Tomorrow") { Task { await update(item, "snooze", minutes: Self.minutesUntilTomorrow) } }
                            Button("Next week") { Task { await update(item, "snooze", minutes: 7 * 24 * 60) } }
                        } label: { Label("Snooze", systemImage: "moon.zzz") }
                    } else {
                        Button { Task { await update(item, "reopen") } } label: { Label("Reopen", systemImage: "arrow.uturn.backward") }
                    }
                    Button { UIPasteboard.general.string = item.message.text } label: { Label("Copy", systemImage: "doc.on.doc") }
                }
            }
            if nextOffset != nil {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .task { await load(more: true) }
            }
        }
        .safeAreaInset(edge: .top) {
            Picker("Show", selection: $status) {
                Text("Open").tag("open")
                Text("Snoozed").tag("snoozed")
                Text("Done").tag("acknowledged")
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.bottom, 6)
        }
        .overlay {
            if !loaded {
                ProgressView()
            } else if items.isEmpty, error == nil {
                ContentUnavailableView(status == "open" ? "All caught up" : "Nothing here", systemImage: "checkmark.seal",
                    description: Text(status == "open" ? "Decisions, blockers and updates bots flag for you show here." : ""))
            }
        }
        .navigationTitle("Attention")
        .refreshable { await load() }
        .task(id: status) {
            loaded = false
            await load()
        }
        .task {
            if let list = try? await app.client.botTeams() {
                rooms = Dictionary(list.rooms.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            }
        }
        .sensoryFeedback(.success, trigger: done)
    }

    private static var minutesUntilTomorrow: Int {
        let calendar = Calendar.current
        let tomorrow = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: calendar.date(byAdding: .day, value: 1, to: .now)!)!
        return max(1, Int(tomorrow.timeIntervalSinceNow / 60))
    }

    private func load(more: Bool = false) async {
        do {
            let page = try await app.client.attention(status: status, offset: more ? nextOffset ?? 0 : 0)
            items = more ? items + page.items.filter { new in !items.contains { $0.id == new.id } } : page.items
            nextOffset = page.nextOffset
            error = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
            nextOffset = nil
        }
        loaded = true
    }

    private func update(_ item: AttentionItem, _ action: String, minutes: Int? = nil) async {
        do {
            try await app.client.updateAttention(item.id, action, minutes: minutes)
            items.removeAll { $0.id == item.id }
            done += 1
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

struct AttentionRow: View {
    let item: AttentionItem

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: icon).foregroundStyle(tint)
                Text("#\(item.channelName)").font(.caption.weight(.semibold))
                Text("·").foregroundStyle(.secondary)
                Text(item.message.speaker).font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Text(Date(timeIntervalSince1970: item.createdAt / 1000), format: .relative(presentation: .named, unitsStyle: .abbreviated))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .lineLimit(1)
            Text(item.message.text).font(.subheadline).lineLimit(5)
            if let until = item.snoozedUntil, item.status == "snoozed" {
                Label("Until \(Date(timeIntervalSince1970: until / 1000).formatted(date: .abbreviated, time: .shortened))", systemImage: "moon.zzz")
                    .font(.caption)
                    .foregroundStyle(.indigo)
            }
            if let reply = item.pendingReply {
                Label(reply.error ?? "Replying: \(reply.text)", systemImage: reply.error == nil ? "arrowshape.turn.up.left" : "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(reply.error == nil ? Color.secondary : .red)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var icon: String {
        switch item.reason {
        case "decision": "questionmark.circle.fill"
        case "blocker": "exclamationmark.octagon.fill"
        default: "info.circle.fill"
        }
    }

    private var tint: Color {
        switch item.reason {
        case "decision": .orange
        case "blocker": .red
        default: .blue
        }
    }
}
