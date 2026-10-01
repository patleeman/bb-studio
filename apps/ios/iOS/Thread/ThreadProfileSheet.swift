import SwiftUI

/// The bot profile a thread works as, like the profile control beside the web
/// composer. A thread takes one profile; adding another bot opens a new
/// channel with both, its draft linked back to this thread.
struct ThreadProfileSheet: View {
    let thread: ThreadEntry
    /// The attached bot's id, or nil for an ordinary thread.
    let botId: String?
    let onChange: (String?) -> Void
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var bots: [Bot] = []
    @State private var loaded = false
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let botId {
                    let bot = bots.first { $0.id == botId }
                    Section {
                        if let bot { BotRow(bot: bot) } else { Text("Archived bot").foregroundStyle(.secondary) }
                        Button("Remove profile", role: .destructive) { Task { await attach(nil) } }
                            .disabled(busy)
                    } header: {
                        Text("Works as")
                    } footer: {
                        Text(busy ? "Change the profile after this response." : "Changing the model keeps the profile.")
                    }
                    let others = bots.filter { $0.id != botId }
                    if !others.isEmpty {
                        Section {
                            ForEach(others) { other in
                                Button { Task { await handoff(with: other, current: bot) } } label: { BotRow(bot: other) }
                                    .foregroundStyle(.primary)
                            }
                        } header: {
                            Text("Add a bot in a new channel")
                        } footer: {
                            Text("A thread works as one bot. Another bot opens a channel with both, linked to this thread.")
                        }
                    }
                } else if bots.isEmpty {
                    ContentUnavailableView("No Bots", systemImage: "person.crop.circle",
                        description: Text("Create a bot in Studio to give threads its profile."))
                } else {
                    Section {
                        ForEach(bots) { bot in
                            Button { Task { await attach(bot.id) } } label: { BotRow(bot: bot) }
                                .foregroundStyle(.primary)
                        }
                        .disabled(busy)
                    } header: {
                        Text("Work as a bot")
                    } footer: {
                        Text(busy
                            ? "Add a bot after this response."
                            : "The thread works as the bot in its own project, with the bot's mission and memory.")
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .disabled(saving)
            .navigationTitle("Bot Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
            .task { await load() }
        }
        .presentationDetents([.medium, .large])
    }

    private var busy: Bool { thread.isRunning }

    private func load() async {
        do {
            bots = try await app.client.profiles()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
        loaded = true
    }

    private func attach(_ id: String?) async {
        saving = true
        defer { saving = false }
        do {
            try await app.client.setThreadProfile(thread.id, botId: id)
            onChange(id)
            dismiss()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func handoff(with other: Bot, current: Bot?) async {
        saving = true
        defer { saving = false }
        do {
            let room = try await app.client.createRoom(memberIds: (current.map { [$0.id] } ?? []) + [other.id])
            ChannelHandoff.save(room.id, text: ChannelHandoff.text(for: thread))
            dismiss()
            app.push(.room(room))
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

/// A new channel's first draft, linking the thread it continues from. Taken
/// once by the channel's composer, as the web keeps it until the channel opens.
enum ChannelHandoff {
    private static let defaults = UserDefaults.standard

    static func text(for thread: ThreadEntry) -> String {
        let title = thread.displayTitle
            .replacingOccurrences(of: #"[\\\[\]<>*_`]"#, with: #"\\$0"#, options: .regularExpression)
            .replacingOccurrences(of: "\n", with: " ")
        let path = thread.projectId == "proj_personal"
            ? "/threads/\(thread.id)"
            : "/projects/\(thread.projectId)/threads/\(thread.id)"
        return "Continue from [\(title)](\(path)) (@thread:\(thread.id))"
    }

    static func save(_ roomId: String, text: String) {
        defaults.set(text, forKey: key(roomId))
    }

    static func take(_ roomId: String) -> String? {
        defer { defaults.removeObject(forKey: key(roomId)) }
        return defaults.string(forKey: key(roomId))
    }

    private static func key(_ roomId: String) -> String { "channelHandoff.\(roomId)" }
}
