import SwiftUI

/// The conversation is home (slice 2 of catching up with the desktop): the
/// phone and the folded Duo open on a conversation (Main, or the last one
/// opened) instead of the presence screen; swiping pages between
/// conversations; the header's Bot mark, or its title, opens the one list.
/// The unfolded Duo shows the conversation on the right and its context on
/// the left (`RoomContextPane`). The Bot's presence is a small still: nothing
/// animates all the time, and the scene stays a still behind the list.
enum RoomHome {
    /// `-qaPresenceHome` brings back the presence screen (only for the old room tests).
    static var enabled: Bool {
        #if DEBUG
        !ProcessInfo.processInfo.arguments.contains("-qaPresenceHome")
        #else
        true
        #endif
    }

    private static let lastKey = "roomHomeLastConversation"

    /// The conversation the app opens on: the last one opened, while it's still listed, else Main.
    static func opening(main: String, order: [String], botId: String) -> String {
        guard let last = AppGroup.defaults.string(forKey: lastKey + "." + botId), order.contains(last) else { return main }
        return last
    }

    static func remember(_ threadId: String, botId: String) {
        AppGroup.defaults.set(threadId, forKey: lastKey + "." + botId)
    }
}

/// The header's Bot mark: its avatar still (no animation), amber while
/// something needs you. Opens the conversation list.
struct RoomHomeButton: View {
    let bot: BotSpace
    let view: BotThreadsView?
    let needsYou: Bool
    let action: () -> Void
    @Environment(\.look) private var look

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .topTrailing) {
                PresenceView(bot: bot, state: bot.presenceState(live: view),
                             workers: view?.workers.filter { $0.status == .running }.count ?? bot.activity.workers,
                             size: 34, stillOnly: true)
                if needsYou {
                    Circle().fill(look.needsYou).frame(width: 9, height: 9)
                        .overlay(Circle().strokeBorder(.background, lineWidth: 1.5))
                        .offset(x: 2, y: -2)
                }
            }
            .frame(width: 44, height: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(needsYou ? "Conversations, something needs you" : "Conversations")
        .accessibilityIdentifier("roomList")
    }
}

/// The top of the conversation list: the Bot, what it's doing, and the places
/// the room's menu had (Memory, Library, Schedules, Theme, Settings).
struct RoomListHeader: View {
    let bot: BotSpace
    let view: BotThreadsView?

    var body: some View {
        HStack(spacing: 12) {
            PresenceView(bot: bot, state: bot.presenceState(live: view),
                         workers: view?.workers.filter { $0.status == .running }.count ?? bot.activity.workers,
                         size: 44, stillOnly: true)
            VStack(alignment: .leading, spacing: 2) {
                Text(bot.name).font(.title3.weight(.semibold))
                Text(Self.status(view)).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("roomListHeader")
    }

    static func status(_ view: BotThreadsView?) -> String {
        let workers = view?.workers ?? []
        let running = workers.filter { $0.status == .running }.count + (view?.conversations.filter(\.running).count ?? 0)
        let needs = workers.filter { $0.status == .needsYou }.count + (view?.conversations.filter { $0.needsYou != nil }.count ?? 0)
        let parts = [running > 0 ? "\(running) running" : nil, needs > 0 ? "\(needs) \(needs == 1 ? "needs" : "need") you" : nil].compactMap { $0 }
        return parts.isEmpty ? "Idle" : parts.joined(separator: " · ")
    }
}

/// The unfolded Duo's left screen: the context for the conversation on the
/// right. Its strands (needs you first, with their answer buttons), its
/// workers (running, then finished, nested), the Bot's runners under Main,
/// then every conversation to switch to, and the Bot's places.
struct RoomContextPane: View {
    let bot: BotSpace
    let view: BotThreadsView?
    let shown: String
    let mainThreadId: String
    let order: [String]
    var pick: (String) -> Void
    var openThread: (String) -> Void
    var openPlace: (RoomPlace) -> Void
    var settings: () -> Void
    @State private var openFolds: Set<String> = []
    @Environment(\.look) private var look

    private var title: String {
        guard let conversation = view?.conversations.first(where: { $0.threadId == shown }), !conversation.isMain else { return "Main" }
        return conversation.title.isEmpty ? "Untitled" : conversation.title
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                RoomListHeader(bot: bot, view: view).padding(.horizontal, 4)
                StrandsPanel(threadId: shown, title: title, openThread: openThread)
                workers
                conversations
                places
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
        .scrollIndicators(.hidden)
        .accessibilityIdentifier("roomContext")
    }

    @ViewBuilder private var workers: some View {
        let lines = BotShell.lines(view).map(\.threadId)
        if let nest = BotWorkerNests.make(conversations: lines, workers: view?.workers ?? []).nests[shown], !nest.nodes.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                section(shown == mainThreadId ? "Workers and runners" : "Workers")
                ForEach(BotWorkerNests.lines(nest.nodes, parent: shown, openFolds: openFolds)) { line in
                    switch line {
                    case .worker(let worker, let depth):
                        Button { openThread(worker.threadId) } label: {
                            HStack(spacing: 8) {
                                BotWorkerGlyph(status: worker.status).frame(width: 16)
                                if let logo = ProviderLogo(worker.providerId) { logo.frame(width: 13, height: 13).accessibilityHidden(true) }
                                Text(worker.title.isEmpty ? "Worker" : worker.title).lineLimit(1)
                                Spacer(minLength: 6)
                                Text(BotShell.shortAge(worker.updatedAt)).font(.footnote).monospacedDigit().foregroundStyle(.secondary)
                            }
                            .font(.subheadline)
                            .padding(.leading, CGFloat(depth) * 16)
                            .frame(minHeight: 40)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("contextWorker-\(worker.threadId)")
                    case .fold(let key, let count, let depth):
                        Button {
                            if openFolds.contains(key) { openFolds.remove(key) } else { openFolds.insert(key) }
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: openFolds.contains(key) ? "chevron.down" : "chevron.right").font(.caption2.weight(.semibold))
                                Text("\(count) done")
                                Spacer()
                            }
                            .font(.subheadline).foregroundStyle(.secondary)
                            .padding(.leading, CGFloat(depth) * 16)
                            .frame(minHeight: 40).contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(12)
            .background(look.stackFill, in: .rect(cornerRadius: 14, style: .continuous))
        }
    }

    private var conversations: some View {
        VStack(alignment: .leading, spacing: 0) {
            section("Conversations")
            ForEach(BotShell.lines(view)) { line in
                Button { pick(line.threadId) } label: {
                    BotConversationRow(line: line)
                        .padding(.horizontal, 8).padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(line.threadId == shown ? AnyShapeStyle(.fill.secondary) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 10))
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("contextConversation-\(line.threadId)")
            }
        }
        .padding(12)
        .background(look.stackFill, in: .rect(cornerRadius: 14, style: .continuous))
    }

    private var places: some View {
        HStack(spacing: 4) {
            ForEach(RoomPlace.homeList) { place in
                Button(place.title) { openPlace(place) }
                    .font(.subheadline).buttonStyle(.borderless)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("roomPlace-\(place.rawValue)")
                Spacer(minLength: 0)
            }
            Button("Settings", action: settings)
                .font(.subheadline).buttonStyle(.borderless)
                .frame(minHeight: 44)
                .accessibilityIdentifier("roomSettings")
        }
        .padding(.horizontal, 4)
    }

    private func section(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption2.weight(.semibold)).foregroundStyle(.tertiary)
            .padding(.bottom, 4)
            .accessibilityAddTraits(.isHeader)
    }
}
