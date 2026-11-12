import SwiftUI

// MARK: A thread's Bot menu

/// Whether a thread is the Bot's (the lead of BB's personal project), for its menu.
@MainActor
final class BotModel: ObservableObject {
    /// False until Studio answers, and while it is absent.
    @Published private(set) var available = false
    @Published private(set) var bot: BotInfo?

    var botThreadId: String? { bot?.lead.threadId }

    func load(client: BBClient) async {
        do {
            bot = try await client.bot()
            available = true
        } catch {
            // Keep what was loaded.
        }
    }

    /// What the thread menu says for the Bot's thread.
    static func label(_ bot: BotInfo?) -> String { "\(bot?.title ?? BotInfo.defaultName) · your Bot" }

    func isBot(_ threadId: String) -> Bool { botThreadId == threadId }

    func makeBot(_ threadId: String, client: BBClient) async throws {
        bot = try await client.makeBot(threadId)
    }
}

/// Makes a thread the Bot, or, for the Bot's thread, edits its check-ins.
struct BotMenu: View {
    @ObservedObject var model: BotModel
    let threadId: String
    /// Sub-threads can't be the Bot.
    var isChild = false
    /// Opens the Bot's check-ins sheet; the menu can't present one itself.
    var editHeartbeat: (() -> Void)?
    var failed: (String) -> Void
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }

    var body: some View {
        if model.isBot(threadId) {
            Menu {
                if let editHeartbeat {
                    Button(action: editHeartbeat) { Label("Check-ins…", systemImage: "waveform.path.ecg") }
                }
            } label: {
                Label(BotModel.label(model.bot), systemImage: "person.crop.circle.badge.checkmark")
            }
        } else if model.available, !isChild {
            Button { makeBot() } label: {
                Label("Make this my Bot", systemImage: "person.crop.circle.badge.checkmark")
            }
        }
    }

    private func makeBot() {
        Task {
            do {
                try await model.makeBot(threadId, client: client)
            } catch {
                failed(BBClient.describe(error, server: client.baseURL))
            }
        }
    }
}
