import SwiftUI
import WidgetKit

/// Pieces the large and extra-large widgets share: a section title and a
/// thread row with its status dot and age, in the small widgets' style
/// (caption type, orange for what needs you, green for what's running).
struct WidgetSectionTitle: View {
    let title: String
    var count: Int? = nil

    var body: some View {
        HStack(spacing: 4) {
            Text(title)
            if let count { Text("\(count)").monospacedDigit() }
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)
        .textCase(.uppercase)
    }
}

/// One line: dot, title, an optional note, and how long ago, opening `url`.
struct WidgetRow: View {
    let url: URL
    let title: String
    var note: String? = nil
    var age: String? = nil
    var dot: Color = .green

    var body: some View {
        Link(destination: url) {
            HStack(spacing: 6) {
                Circle().fill(dot).frame(width: 6, height: 6)
                Text(title).lineLimit(1)
                if let note {
                    Text(note).foregroundStyle(.secondary).lineLimit(1).layoutPriority(-1)
                }
                Spacer(minLength: 4)
                if let age { Text(age).foregroundStyle(.secondary).monospacedDigit() }
            }
            .font(.caption)
        }
    }
}

/// "+3 more" under a list cut to fit.
struct WidgetMore: View {
    let hidden: Int
    var body: some View {
        if hidden > 0 {
            Text("+\(hidden) more").font(.caption2).foregroundStyle(.secondary).padding(.leading, 12)
        }
    }
}

enum WidgetText {
    /// "now", "4m", "3h", "2d": `RelativeTime.ago` without "ago", for a row's end.
    static func age(_ at: Double?, now: Date) -> String? {
        guard let at, at > 0 else { return nil }
        let text = RelativeTime.ago(at, now: now.timeIntervalSince1970 * 1000)
        return text == "just now" ? "now" : text.replacingOccurrences(of: " ago", with: "")
    }

    /// A thread's link, scoped to the widget's server.
    static func thread(_ id: String, serverURL: URL) -> URL {
        AppLink.scoped(URL(string: "bbstudio://thread/\(id)")!, serverURL: serverURL)
    }

    static func link(_ path: String, serverURL: URL) -> URL {
        AppLink.scoped(URL(string: "bbstudio://\(path)")!, serverURL: serverURL)
    }
}

extension ThreadEntry {
    /// What a "needs you" row says about it.
    var widgetNote: String { status == "error" && hasPendingInteraction != true ? "Failed" : "Waiting on you" }

    /// A made-up thread for widget placeholders, the gallery and `-qaStateDemo widgets`.
    static func widgetSample(_ id: String, _ title: String, minutesAgo: Double, pending: Bool = false, status: String = "active",
                             now: Date = .now) -> ThreadEntry {
        let at = (now.timeIntervalSince1970 - minutesAgo * 60) * 1000
        return ThreadEntry(id: id, projectId: "p", title: title, status: status, latestAttentionAt: at, createdAt: at, updatedAt: at,
                           hasPendingInteraction: pending)
    }
}

/// The Bot a widget shows, from Bot spaces: who, its presence and workers.
struct WidgetBot: Hashable {
    var id: String
    var name: String
    var state: BotPresenceState
    var workers: Int
    var look: BotLook
    /// Other Bots that need you.
    var othersNeedingYou: Int

    init(id: String, name: String, state: BotPresenceState, workers: Int, look: BotLook, othersNeedingYou: Int = 0) {
        self.id = id
        self.name = name
        self.state = state
        self.workers = workers
        self.look = look
        self.othersNeedingYou = othersNeedingYou
    }

    init(_ facts: BotWidgetFacts) {
        self.init(id: facts.botId, name: facts.bot?.name ?? BotInfo.defaultName, state: facts.presence,
                  workers: facts.view?.workers.filter { $0.status == .running }.count ?? facts.bot?.activity.workers ?? 0,
                  look: facts.look, othersNeedingYou: facts.othersNeedingYou.count)
    }

    func link(serverURL: URL) -> URL { WidgetText.link("bot/\(id)", serverURL: serverURL) }
}

/// The Bot's presence and name, for a widget's header.
struct WidgetBotBadge: View {
    let bot: WidgetBot
    var size: CGFloat = 22

    var body: some View {
        HStack(spacing: 5) {
            WidgetPresence(botId: bot.id, state: bot.state, look: bot.look, size: size)
            Text(bot.name).font(.caption.weight(.semibold)).lineLimit(1)
        }
    }
}
