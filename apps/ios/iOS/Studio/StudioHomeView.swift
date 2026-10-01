import SwiftUI

/// The Studio landing page. The collection remains one tap away.
struct StudioHomeView: View {
    @EnvironmentObject private var app: AppModel
    @State private var home: Studio.HomeOutput?
    @State private var error: String?
    @State private var collection = false
    @State private var answering: Studio.HomeOutputNeedsYouItem?
    @State private var answer = ""

    var body: some View {
        Group {
            if collection {
                StudioView()
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Home") { collection = false }
                        }
                    }
            } else {
                List {
                    if let error { Text(error).foregroundStyle(.red) }
                    if let home {
                        if let needs = home.needsYou, !needs.isEmpty {
                            Section("Needs you") {
                                ForEach(Array(needs.enumerated()), id: \.offset) { _, need in
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(need.title ?? "Needs you").font(.subheadline.weight(.semibold))
                                        Text(need.body ?? "").font(.subheadline).foregroundStyle(.secondary)
                                        HStack {
                                            if let threadId = need.threadId {
                                                Button("Open thread") { app.studioPath.append(.thread(id: threadId)) }
                                            } else if let route = need.href.flatMap(Route.init(href:)) {
                                                Button("Open") { app.studioPath.append(route) }
                                            }
                                            if need.responseKind == .approval {
                                                Button("Approve once") { Task { await respond(need, action: "approve") } }
                                                Button("Deny") { Task { await respond(need, action: "deny") } }
                                            } else if need.responseKind == .question {
                                                Button("Answer") { answering = need }
                                            }
                                        }
                                        .font(.caption)
                                    }
                                    .accessibilityIdentifier("studioNeed")
                                }
                            }
                        }
                        if home.due?.isEmpty == false {
                            Section("Due today") {
                                ForEach(Array((home.due ?? []).enumerated()), id: \.offset) { _, task in
                                    if let id = task.id {
                                        NavigationLink(value: Route.task(id: id)) { Label(task.title ?? "Task", systemImage: "calendar") }
                                    }
                                }
                            }
                        }
                        if home.review?.isEmpty == false {
                            Section("In review") {
                                ForEach(Array((home.review ?? []).enumerated()), id: \.offset) { _, task in
                                    if let id = task.id {
                                        NavigationLink(value: Route.task(id: id)) { Label(task.title ?? "Task", systemImage: "checkmark.circle") }
                                    }
                                }
                            }
                        }
                        if home.working?.threads?.isEmpty == false || home.working?.bots?.isEmpty == false {
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
                        }
                        if home.recent?.isEmpty == false {
                            Section("Recent items") {
                                ForEach(Array((home.recent ?? []).enumerated()), id: \.offset) { _, item in
                                    if let route = item.href.flatMap(Route.init(href:)) {
                                        NavigationLink(value: route) { Label(item.title ?? "Untitled", systemImage: StudioKind.of(item.kind ?? "").symbol) }
                                    } else {
                                        Text(item.title ?? "Untitled")
                                    }
                                }
                            }
                        }
                        if home.activity?.isEmpty == false {
                            Section("Activity") {
                                ForEach(Array((home.activity ?? []).enumerated()), id: \.offset) { _, event in
                                    let row = VStack(alignment: .leading, spacing: 3) {
                                        Text(event.summary ?? "Untitled")
                                        if let at = event.at {
                                            Text("\(event.verb?.capitalized ?? "Updated") \(Date(timeIntervalSince1970: at / 1000), style: .relative) ago")
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                    if let route = event.href.flatMap(Route.init(href:)) {
                                        NavigationLink(value: route) { row }
                                    } else {
                                        row
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
                // Items opened from Home read running add-ons from the shared store.
                .task(id: app.serverURL) {
                    StudioStore.shared.restore()
                    StudioStore.shared.attach(app)
                    await StudioStore.shared.load(app.client)
                }
                .alert("Answer question", isPresented: Binding(get: { answering != nil }, set: { if !$0 { answering = nil } })) {
                    TextField("Answer", text: $answer, axis: .vertical)
                    Button("Cancel", role: .cancel) { answer = "" }
                    Button("Send") {
                        if let need = answering { Task { await respond(need, action: "answer", answer: answer) } }
                        answer = ""
                    }
                }
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

    private func respond(_ need: Studio.HomeOutputNeedsYouItem, action: String, answer: String? = nil) async {
        guard let threadId = need.threadId, let interactionId = need.interactionId else { return }
        do {
            try await app.client.respondToStudioNeed(threadId: threadId, interactionId: interactionId, action: action, answer: answer)
            await load()
        } catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }
}
