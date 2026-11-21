import SwiftUI

extension BBClient {
    /// Pause, resume or stop a Bot of the spaces (`bot_pause`, `bot_resume`, `bot_stop`); `bot_spaces` then says its state.
    public func setBotSpaceState(_ action: BotInfo.Action, botId: String) async throws {
        let method = switch action {
        case .pause: Studio.Method.bot_pause
        case .resume: Studio.Method.bot_resume
        case .stop: Studio.Method.bot_stop
        }
        let _: JSONValue = try await rpc("studio", method, ["botId": .string(botId)])
    }

    /// Make this the Main: a conversation of the Bot becomes its Main; the old Main stays an ordinary conversation.
    public func makeMain(botId: String, threadId: String) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.bot_make_main, ["botId": .string(botId), "threadId": .string(threadId)])
    }

    /// Start a new Main: a fresh conversation becomes the Main; the old one stays an ordinary conversation.
    public func newMain(botId: String) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.bot_new_main, ["botId": .string(botId)])
    }
}

/// The Bot's controls, as on the desktop's header and Bot settings: Pause or
/// Resume, Stop… (it also stops the threads the Bot started and its
/// schedules), the Main conversation picker, and New Main.
struct BotControlsMenu: View {
    let bot: BotSpace
    let view: BotThreadsView?
    var refresh: () async -> Void
    @EnvironmentObject private var app: AppModel
    @State private var stopping = false
    @State private var startingMain = false

    private var mainId: String? { view?.main?.threadId ?? bot.mainThreadId }

    var body: some View {
        Menu {
            if bot.paused {
                Button { act(.resume) } label: { Label("Resume \(bot.name)", systemImage: "play") }
                    .accessibilityIdentifier("botResume")
            } else {
                Button { act(.pause) } label: { Label("Pause \(bot.name)", systemImage: "pause") }
                    .accessibilityIdentifier("botPause")
            }
            Button(role: .destructive) { stopping = true } label: { Label("Stop…", systemImage: "stop") }
                .accessibilityIdentifier("botStop")
            Divider()
            Menu {
                ForEach(view?.conversations.filter { $0.forkedFrom == nil || $0.isMain } ?? []) { conversation in
                    Button {
                        guard conversation.threadId != mainId else { return }
                        run("It didn't change the Main") { try await app.client.makeMain(botId: bot.id, threadId: conversation.threadId) }
                    } label: {
                        if conversation.threadId == mainId {
                            Label(conversation.title.isEmpty ? "Main" : conversation.title, systemImage: "checkmark")
                        } else {
                            Text(conversation.title.isEmpty ? "Untitled" : conversation.title)
                        }
                    }
                }
            } label: { Label("Main conversation", systemImage: "star") }
                .accessibilityIdentifier("botMainPicker")
            Button { startingMain = true } label: { Label("New Main", systemImage: "plus.bubble") }
                .accessibilityIdentifier("botNewMain")
        } label: {
            Image(systemName: "ellipsis.circle").frame(width: 44, height: 44).contentShape(.rect)
        }
        .accessibilityLabel("\(bot.name) settings")
        .accessibilityIdentifier("botControls")
        .confirmationDialog("Stop \(bot.name)?", isPresented: $stopping, titleVisibility: .visible) {
            Button("Stop", role: .destructive) { act(.stop) }
        } message: {
            Text("It pauses, stops the threads it started and turns off its schedules. Nothing is deleted; Resume brings it back.")
        }
        .confirmationDialog("Start a new Main?", isPresented: $startingMain, titleVisibility: .visible) {
            Button("New Main") { run("It didn't start a new Main") { try await app.client.newMain(botId: bot.id) } }
        } message: {
            Text("A fresh conversation becomes the Main. The current one stays as an ordinary conversation.")
        }
    }

    private func act(_ action: BotInfo.Action) {
        run(action == .resume ? "It didn't resume" : action == .pause ? "It didn't pause" : "It didn't stop") {
            try await app.client.setBotSpaceState(action, botId: bot.id)
        }
    }

    private func run(_ failure: String, _ work: @escaping () async throws -> Void) {
        Task {
            do {
                try await work()
                await refresh()
            } catch {
                app.flash(failure + ": " + BBClient.describe(error, server: app.client.baseURL))
            }
        }
    }
}

/// A line above the composer while the Bot is paused or stopped, with Resume.
struct BotPausedBanner: View {
    let botId: String
    let botName: String
    let stopped: Bool
    var refresh: () async -> Void
    @EnvironmentObject private var app: AppModel
    @State private var resuming = false
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: stopped ? "stop.circle" : "pause.circle").foregroundStyle(.secondary)
            Text(stopped ? "\(botName) is stopped" : "\(botName) is paused").font(.footnote).lineLimit(1)
            Spacer(minLength: 4)
            Button("Resume") {
                resuming = true
                Task {
                    do {
                        try await app.client.setBotSpaceState(.resume, botId: botId)
                        await refresh()
                    } catch {
                        app.flash("It didn't resume: " + BBClient.describe(error, server: app.client.baseURL))
                    }
                    resuming = false
                }
            }
            .font(.footnote.weight(.semibold))
            .disabled(resuming)
            .accessibilityIdentifier("botPausedResume")
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 40)
        .background(look.stackFill, in: .rect(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("botPausedBanner")
    }
}
