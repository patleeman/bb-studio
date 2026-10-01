import SwiftUI

/// The Studio landing page. The collection remains one tap away.
struct StudioHomeView: View {
    @EnvironmentObject private var app: AppModel
    @State private var home: Studio.HomeOutput?
    @State private var error: String?
    @State private var collection = false

    var body: some View {
        Group {
            if collection {
                StudioView()
            } else {
                List {
                    if let error { Text(error).foregroundStyle(.red) }
                    if let home {
                        Section("Due today") {
                            ForEach(Array((home.due ?? []).enumerated()), id: \.offset) { _, task in
                                if let id = task.id {
                                    NavigationLink(value: Route.task(id: id)) { Label(task.title ?? "Task", systemImage: "calendar") }
                                }
                            }
                        }
                        Section("In review") {
                            ForEach(Array((home.review ?? []).enumerated()), id: \.offset) { _, task in
                                if let id = task.id {
                                    NavigationLink(value: Route.task(id: id)) { Label(task.title ?? "Task", systemImage: "checkmark.circle") }
                                }
                            }
                        }
                        Section("Agents working now") {
                            ForEach(Array((home.working?.threads ?? []).enumerated()), id: \.offset) { _, thread in
                                if let id = thread.id {
                                    NavigationLink(value: Route.thread(id: id)) { Label(thread.title ?? "Thread", systemImage: "bubble.left") }
                                }
                            }
                            ForEach(Array((home.working?.bots ?? []).enumerated()), id: \.offset) { _, bot in
                                if let id = bot.id {
                                    NavigationLink(value: Route.bot(id: id)) { Label(bot.name ?? "Bot", systemImage: "person.crop.square") }
                                }
                            }
                        }
                        Section("Recent items") {
                            ForEach(Array((home.recent ?? []).enumerated()), id: \.offset) { _, item in
                                if let route = item.href.flatMap(Route.init(href:)) {
                                    NavigationLink(value: route) { Label(item.title ?? "Untitled", systemImage: StudioKind.of(item.kind ?? "").symbol) }
                                } else {
                                    Text(item.title ?? "Untitled")
                                }
                            }
                        }
                        Section("Activity") {
                            ForEach(Array((home.activity ?? []).enumerated()), id: \.offset) { _, event in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(event.summary ?? event.verb ?? "Update")
                                    if let at = event.at {
                                        Text(Date(timeIntervalSince1970: at / 1000), style: .relative)
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    } else if error == nil {
                        ProgressView()
                    }
                }
                .navigationTitle("Studio")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { collection = true } label: { Label("Collection", systemImage: "square.stack") }
                            .accessibilityIdentifier("studioCollection")
                    }
                }
                .refreshable { await load() }
                .task { await load() }
            }
        }
    }

    private func load() async {
        do {
            home = try await app.client.studioHome()
            error = nil
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
