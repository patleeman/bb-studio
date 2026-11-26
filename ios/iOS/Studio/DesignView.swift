import SwiftUI

/// What a design shows over itself.
private enum DesignSheet: String, Identifiable {
    case comments, related, web
    var id: Self { self }
}

/// A Studio Design: its rounds, newest first, each a row of live screens, as
/// the desktop's canvas. Tapping or pinching a screen opens the player
/// (zoom, play, comment, edit text). Pushed, its actions are in the bar; in
/// a Workbench tab they go to the shell's More and it draws no bar.
struct DesignView: View {
    @Environment(\.inWorkbench) private var inWorkbench
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var app: AppModel
    @ObservedObject private var studio = StudioStore.shared
    @StateObject private var model: DesignModel
    @State private var playing: DesignPlayerStart?
    @State private var sheet: DesignSheet?
    @State private var chatting = false
    @State private var renaming = false
    @State private var deleting = false
    @State private var newName = ""
    @State private var notice: String?

    init(id: String) {
        _model = StateObject(wrappedValue: DesignModel(id: id))
    }

    var body: some View {
        chrome
            .alert("Rename design", isPresented: $renaming) {
                TextField("Name", text: $newName)
                Button("Cancel", role: .cancel) {}
                Button("Rename") { act { try await $0.renameDesign(model.id, name: newName.trimmingCharacters(in: .whitespacesAndNewlines)) } }
                    .disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .confirmationDialog("Delete this design?", isPresented: $deleting, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { delete() }
            } message: {
                Text("Its rounds, screens and comments are deleted. This can't be undone.")
            }
            .sheet(item: $sheet) { sheet in
                switch sheet {
                case .comments: DesignCommentsSheet(model: model) { playing = DesignPlayerStart(screenId: $0.screenId, mode: .comment, comment: $0.id) }
                case .related: RelatedView(pluginId: "design", itemId: model.id)
                case .web: DesignWebSheet(url: app.client.baseURL.appending(path: "plugins/studio/studio/designs/\(model.id)"))
                }
            }
            .studioChat(isPresented: $chatting, pluginId: "design", itemId: model.id, title: model.design?.displayName ?? "Design",
                        projectId: model.design?.projectId)
            .fullScreenCover(item: $playing) { DesignPlayer(model: model, start: $0) }
            .overlay(alignment: .top) { DesignNotice(notice: $notice) }
            .task(id: model.id) {
                model.attach(app.realtime)
                await model.load()
            }
            .onDisappear { model.detach() }
            .accessibilityIdentifier("designView")
    }

    /// One action list (Comment and Screens first): pushed, the bar's buttons and ⋯ on the
    /// iPhone and the rail on the Duo; in a Workbench tab, the shell's More.
    @ViewBuilder private var chrome: some View {
        if inWorkbench {
            content.screenActions(actions)
        } else {
            content.screenToolbar(model.design?.displayName ?? "Design", actions: actions)
        }
    }

    @ViewBuilder private var content: some View {
        if let design = model.design {
            DesignCanvas(model: model, design: design) { playing = $0 }
                .refreshable { await model.load() }
        } else if model.missing {
            ContentUnavailableView("Design not found", systemImage: StudioKind.of("design").symbol, description: Text("It may have been deleted."))
        } else if let error = model.error {
            ContentUnavailableView("Couldn't open design", systemImage: StudioKind.of("design").symbol, description: Text(error))
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// The desktop's toolbar and header: Comment, the screens, Comments, Present, star,
    /// rename, the conversation, Studio Chat, Related, BB web, delete.
    private var actions: [ScreenAction] {
        guard let design = model.design else { return [] }
        var list: [ScreenAction] = []
        if let newest = design.screens.first?.id {
            list.append(ScreenAction(id: "comment", title: "Comment", systemImage: "text.bubble.badge.plus",
                                     run: { playing = DesignPlayerStart(screenId: newest, mode: .comment) }))
            list.append(ScreenAction(id: "screens", title: "Screens", systemImage: "rectangle.on.rectangle",
                                     children: (design.rounds ?? []).flatMap { $0.screens ?? [] }.compactMap { screen in
                                         screen.id.map { id in
                                             ScreenAction(id: "screen-\(id)", title: [id, screen.title?.isEmpty == false ? screen.title : screen.caption]
                                                             .compactMap { $0 }.joined(separator: " · "),
                                                          systemImage: "rectangle", run: { playing = DesignPlayerStart(screenId: id) })
                                         }
                                     }))
        }
        if let newest = design.screens.first?.id {
            list.append(ScreenAction(id: "present", title: "Present", systemImage: "play.rectangle",
                                     run: { playing = DesignPlayerStart(screenId: newest, mode: .play) }))
        }
        let open = model.openComments.count
        list.append(ScreenAction(id: "comments", title: open > 0 ? "Comments (\(open))" : "Comments", systemImage: "text.bubble",
                                       run: { sheet = .comments }))
        if studio.supportsStars, let item = studio.item(for: .design(id: model.id)) {
            let starred = studio.isStarred(item)
            list.append(ScreenAction(id: "star", title: starred ? "Unstar" : "Star", systemImage: starred ? "star.slash" : "star",
                                           run: { act { try await studio.setStarred(item, !starred, client: $0) } }))
        }
        list.append(ScreenAction(id: "rename", title: "Rename", systemImage: "pencil", run: {
            newName = model.design?.name ?? ""
            renaming = true
        }))
        if let threadId = design.threadId, !inWorkbench {
            list.append(ScreenAction(id: "thread", title: "Open Conversation", systemImage: Symbols.thread, run: { app.push(.thread(id: threadId)) }))
        }
        if studio.plugins.contains("studio") {
            list.append(ScreenAction(id: "chat", title: "Chat About This", systemImage: "bubble.left.and.text.bubble.right", run: { chatting = true }))
        }
        list.append(ScreenAction(id: "related", title: "Related", systemImage: "link", run: { sheet = .related }))
        list.append(ScreenAction(id: "web", title: "Open in BB Web", systemImage: "safari", run: { sheet = .web }))
        list.append(ScreenAction(id: "delete", title: "Delete Design", systemImage: "trash", role: .destructive, run: { deleting = true }))
        return list
    }

    private func act(_ change: @escaping (BBClient) async throws -> Void) {
        Task { notice = await model.run(change) }
    }

    private func delete() {
        Task {
            notice = await model.run { try await $0.deleteDesign(model.id) }
            if notice == nil, !inWorkbench { dismiss() }
        }
    }
}

/// The canvas: the review's state, then each round with its screens in a row.
private struct DesignCanvas: View {
    @ObservedObject var model: DesignModel
    let design: StudioDesign
    let play: (DesignPlayerStart) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if let review = design.review { DesignReviewBanner(review: review) }
                if design.screens.isEmpty {
                    ContentUnavailableView("No screens yet", systemImage: StudioKind.of("design").symbol,
                        description: Text("The agent's first round shows up here as it writes it."))
                }
                ForEach(design.rounds ?? [], id: \.round) { round in
                    DesignRoundRow(model: model, round: round, play: play)
                }
            }
            .padding(.vertical)
        }
    }
}

private struct DesignRoundRow: View {
    @ObservedObject var model: DesignModel
    let round: Studio.DesignsGetDesignOutputDesignRoundsItem
    let play: (DesignPlayerStart) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(["Round \(Int(round.round ?? 0))", round.title].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "))
                    .font(.headline)
                if let intro = round.intro, !intro.isEmpty {
                    Text(intro).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 14) {
                    ForEach(round.screens ?? [], id: \.id) { screen in
                        DesignThumbnail(model: model, screen: screen, comments: model.openComments.filter { $0.screenId == screen.id }.count) {
                            play(DesignPlayerStart(screenId: screen.id ?? ""))
                        }
                    }
                }
                .padding(.horizontal)
            }
        }
    }
}

/// A screen at its own size, scaled into a card 300 points tall, with its open comments' count.
private struct DesignThumbnail: View {
    @ObservedObject var model: DesignModel
    let screen: DesignScreen
    let comments: Int
    let open: () -> Void

    var body: some View {
        let size = screen.size
        let scale = 300 / size.height
        Button(action: open) {
            VStack(alignment: .leading, spacing: 6) {
                DesignFrame(url: model.screenURL(screen))
                    .frame(width: size.width, height: size.height)
                    .scaleEffect(scale, anchor: .topLeading)
                    .frame(width: size.width * scale, height: 300, alignment: .topLeading)
                    .clipShape(.rect(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.separator))
                HStack(spacing: 6) {
                    Text(screen.id ?? "").font(.caption.weight(.semibold).monospaced())
                    Text(screen.title?.isEmpty == false ? screen.title! : screen.caption ?? "")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Spacer(minLength: 0)
                    if comments > 0 {
                        Label("\(comments)", systemImage: "text.bubble").font(.caption2.monospacedDigit()).foregroundStyle(.tint)
                    }
                }
                .frame(width: size.width * scale, alignment: .leading)
            }
            // The page takes no touches: the whole card opens the screen.
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        // Pinching a screen opens it full screen, where pinch zooms and a drag pans.
        .simultaneousGesture(MagnifyGesture().onEnded { value in
            if value.magnification > 1.1 { open() }
        })
        .accessibilityLabel("Play screen \(screen.id ?? ""), \(screen.title ?? screen.caption ?? "")")
        .accessibilityIdentifier("designScreen-\(screen.id ?? "")")
    }
}

private struct DesignReviewBanner: View {
    let review: Studio.DesignsGetDesignOutputDesignReview

    var body: some View {
        let round = review.round.map { " round \(Int($0))" } ?? ""
        let (text, symbol, tint): (String, String, Color) = switch review.state {
        case .reviewing: ("Reviewing\(round)…", "eye", .blue)
        case .needs_work: ("The reviewer sent\(round) back for fixes", "exclamationmark.triangle", .secondary)
        case .failed: ("The review\(round) didn't finish", "xmark.octagon", .red)
        default: ("Reviewed\(round)", "checkmark.seal", .green)
        }
        VStack(alignment: .leading, spacing: 4) {
            Label(text, systemImage: symbol).font(.subheadline.weight(.medium)).foregroundStyle(tint)
            if let summary = review.summary, !summary.isEmpty, review.state != .done {
                Text(summary).font(.caption).foregroundStyle(.secondary).lineLimit(4)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.1), in: .rect(cornerRadius: 12))
        .padding(.horizontal)
    }
}

private struct DesignWebSheet: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            WebView(url: url)
                .ignoresSafeArea(edges: .bottom)
                .toolbar { Button("Done") { dismiss() } }
        }
    }
}

extension DesignScreen: Identifiable {}
