import SwiftUI

/// Studio opens on the collection; Today (what needs you, due and recent work) is one tap away.
struct StudioHomeView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var home: Studio.HomeOutput?
    @State private var error: String?
    @State private var collection = true
    @State private var answering: Studio.HomeOutputNeedsYouItem?
    @State private var answer = ""

    var body: some View {
        Group {
            if collection {
                StudioView()
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button { collection = false } label: { Label("Today", systemImage: "sun.max") }
                                .accessibilityIdentifier("studioToday")
                        }
                    }
            } else {
                List {
                    if let error { Text(error).foregroundStyle(.red) }
                    if let home {
                        if let needs = home.needsYou, !needs.isEmpty {
                            Section {
                                ForEach(Array(needs.enumerated()), id: \.offset) { _, need in
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(need.title ?? "Needs you").font(.subheadline.weight(.semibold))
                                        Text(need.body ?? "").font(.subheadline).foregroundStyle(.secondary)
                                        needActionLayout {
                                            needActions(need)
                                        }
                                        .buttonStyle(.borderless)
                                        .font(.caption)
                                    }
                                    .accessibilityIdentifier("studioNeed")
                                }
                            } header: {
                                Text("Needs you").foregroundStyle(Color.primary.opacity(0.75))
                            }
                        }
                        if home.working?.threads?.isEmpty == false {
                            Section {
                                ForEach(Array((home.working?.threads ?? []).enumerated()), id: \.offset) { _, thread in
                                    if let id = thread.id {
                                        NavigationLink(value: Route.thread(id: id)) { Label(thread.title ?? "Thread", systemImage: Symbols.thread) }
                                    }
                                }
                            } header: {
                                Text("Agents working now").foregroundStyle(Color.primary.opacity(0.75))
                            }
                        }
                        if home.recent?.isEmpty == false {
                            Section {
                                ForEach(Array((home.recent ?? []).enumerated()), id: \.offset) { _, item in
                                    if let route = item.href.flatMap(Route.init(href:)) {
                                        NavigationLink(value: route) { Label(item.title ?? "Untitled", systemImage: StudioKind.of(item.kind ?? "").symbol) }
                                    } else {
                                        Text(item.title ?? "Untitled")
                                    }
                                }
                            } header: {
                                Text("Recent items").foregroundStyle(Color.primary.opacity(0.75))
                            }
                        }
                        if home.activity?.isEmpty == false {
                            Section {
                                ForEach(Array((home.activity ?? []).enumerated()), id: \.offset) { _, event in
                                    let row = VStack(alignment: .leading, spacing: 3) {
                                        Text(event.summary ?? "Untitled")
                                        if let at = event.at {
                                            Text("\(event.verb?.capitalized ?? "Updated") \(Date(timeIntervalSince1970: at / 1000), style: .relative) ago")
                                                .font(.caption).foregroundStyle(Color.primary.opacity(0.75))
                                        }
                                    }
                                    if let route = event.href.flatMap(Route.init(href:)) {
                                        NavigationLink(value: route) { row }
                                    } else {
                                        row
                                    }
                                }
                            } header: {
                                Text("Activity").foregroundStyle(Color.primary.opacity(0.75))
                            }
                        }
                    } else if error == nil {
                        ProgressView()
                    }
                }
                .navigationTitle("Today")
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

    private var needActionLayout: AnyLayout {
        if dynamicTypeSize.isAccessibilitySize {
            return AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
        }
        return AnyLayout(HStackLayout())
    }

    @ViewBuilder
    private func needActions(_ need: Studio.HomeOutputNeedsYouItem) -> some View {
        if let threadId = need.threadId {
            needAction("Open thread") { app.studioPath.append(.thread(id: threadId)) }
        } else if let route = need.href.flatMap(Route.init(href:)) {
            needAction("Open") { app.studioPath.append(route) }
        }
        if need.responseKind == .approval {
            needAction("Approve once") { Task { await respond(need, action: "approve") } }
            needAction("Deny") { Task { await respond(need, action: "deny") } }
        } else if need.responseKind == .question {
            needAction("Answer") { answering = need }
        }
    }

    private func needAction(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minWidth: 44,
                       maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : nil,
                       minHeight: 44,
                       alignment: .leading)
                .contentShape(Rectangle())
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
