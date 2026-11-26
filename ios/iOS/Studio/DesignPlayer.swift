import SwiftUI

/// What the player opens at.
struct DesignPlayerStart: Identifiable, Equatable {
    var screenId: String
    var mode: DesignMode = .view
    /// A comment to show active, its pin highlighted.
    var comment: String?
    var id: String { "\(screenId)-\(mode.rawValue)-\(comment ?? "")" }
}

/// A design's screens full screen, one round at a time, as the desktop's
/// canvas and its Play: swipe between the round's screens; View is a still
/// that pinches to 6×; Play runs the prototype; Comment picks an element and
/// pins a comment to it; Edit text types over the screen's text. Decks step
/// with Previous and Next.
struct DesignPlayer: View {
    @ObservedObject var model: DesignModel
    let start: DesignPlayerStart
    @State private var screenId: String
    @State private var mode: DesignMode
    @State private var active: String?
    @State private var step = ""
    @State private var picked: DesignPick?
    @State private var notice: String?
    @State private var sharing: SharedFile?
    /// A zoomed still pans to its edges; the pager waits until it's back at fit.
    @State private var zoomed = false
    @Environment(\.dismiss) private var dismiss

    init(model: DesignModel, start: DesignPlayerStart) {
        self.model = model
        self.start = start
        _screenId = State(initialValue: start.screenId)
        _mode = State(initialValue: start.mode)
        _active = State(initialValue: start.comment)
    }

    private var round: [DesignScreen] { model.design?.round(of: screenId)?.screens ?? [] }
    private var screen: DesignScreen? { model.design?.screen(screenId) }

    var body: some View {
        NavigationStack {
            pager
                .background(Color(.secondarySystemBackground))
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    DesignPlayerBar(mode: $mode, step: $step, steps: screen?.steps ?? [], screens: round.compactMap(\.id), screenId: $screenId)
                }
                .overlay(alignment: .top) { DesignNotice(notice: $notice) }
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { toolbar }
                .sheet(item: $picked) { pick in
                    DesignCommentComposer(model: model, screenId: screenId, step: step, pick: pick) { notice = $0 }
                }
                .sheet(item: $sharing) { ActivitySheet(items: [$0.url]).ignoresSafeArea() }
                .onChange(of: mode) { _, _ in zoomed = false }
                .onChange(of: screenId) { _, _ in
                    step = ""
                    zoomed = false
                }
        }
    }

    private var title: String {
        guard let screen else { return "" }
        return [screen.id, screen.title?.isEmpty == false ? screen.title : screen.caption].compactMap { $0 }.joined(separator: " · ")
    }

    /// View pages through the round's stills; a live mode holds the one screen,
    /// whose page takes the touches.
    @ViewBuilder private var pager: some View {
        if mode == .view {
            stills
        } else if let screen {
            page(screen)
        }
    }

    /// The round's stills side by side, a page each. Paging waits while a zoomed still pans to its edge.
    private var stills: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(round, id: \.id) { screen in
                    page(screen)
                        .containerRelativeFrame([.horizontal, .vertical])
                        .id(screen.id ?? "")
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: pagerPosition)
        .scrollIndicators(.hidden)
        .scrollDisabled(zoomed)
    }

    private func page(_ screen: DesignScreen) -> some View {
        DesignPlayerPage(model: model, screen: screen, mode: screen.id == screenId ? mode : .view,
                         step: screen.id == screenId ? step : "", active: active, event: handle,
                         play: { mode = .play }, zoomed: { zoomed = $0 })
    }

    private var pagerPosition: Binding<String?> {
        Binding(get: { screenId }, set: { if let id = $0 { screenId = id } })
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button { export(print: true) } label: { Label("Export PDF", systemImage: "doc.richtext") }
                Button { export(print: false) } label: { Label("Download HTML", systemImage: "arrow.down.doc") }
            } label: {
                Image(systemName: "square.and.arrow.up")
            }
            .accessibilityLabel("Export")
            .accessibilityIdentifier("designExport")
        }
    }

    private func handle(_ event: DesignFrameEvent) {
        switch event {
        case .pick(let pick): picked = pick
        case .pin(let id):
            active = id
            if let comment = model.comments.first(where: { $0.id == id }) { notice = "\(comment.number). \(comment.body)" }
        case .text(let before, let after):
            Task {
                let reason = await model.api.editDesignTextReason(model.id, screenId: screenId, before: before, after: after)
                notice = reason
                await model.load()
            }
        case .notEditable:
            notice = "Only text can be edited here. Comment on the rest."
        }
    }

    private func export(print: Bool) {
        guard let screen else { return }
        Task {
            do {
                sharing = SharedFile(url: try await DesignExport.file(model.api, designId: model.id, screen: screen, print: print))
            } catch {
                notice = BBClient.describe(error, server: model.api.baseURL)
            }
        }
    }
}

extension DesignPick: Identifiable {
    public var id: String { selector }
}

extension BBClient {
    /// Saves a text edit; what to tell the user when Studio couldn't, nil when it saved.
    func editDesignTextReason(_ designId: String, screenId: String, before: String, after: String) async -> String? {
        do {
            switch try await editDesignText(designId, screenId: screenId, before: before, after: after) {
            case nil: return nil
            case "ambiguous": return "That text appears more than once in the screen; comment on it instead."
            case "markup": return "That text has formatting the phone can't change; comment on it instead."
            default: return "The screen changed meanwhile; try again."
            }
        } catch {
            return BBClient.describe(error, server: baseURL)
        }
    }
}

/// One screen in the player: its still, or the live page in the current mode with its pins.
private struct DesignPlayerPage: View {
    @ObservedObject var model: DesignModel
    let screen: DesignScreen
    let mode: DesignMode
    let step: String
    let active: String?
    let event: (DesignFrameEvent) -> Void
    /// A tap on the still plays the prototype.
    let play: () -> Void
    let zoomed: (Bool) -> Void

    var body: some View {
        if mode == .view {
            DesignStill(url: model.screenURL(screen), size: CGSize(width: screen.size.width, height: screen.size.height), play: play, zoomed: zoomed)
        } else {
            DesignLiveFrame(url: model.screenURL(screen, step: step), pageWidth: screen.size.width, mode: mode, pins: pins, event: event)
                .id(step)
        }
    }

    private var pins: [DesignPin] {
        model.openComments.filter { $0.screenId == screen.id && ($0.step.isEmpty || $0.step == step) }.map {
            DesignPin(id: $0.id, n: $0.number, selector: $0.selector, sent: $0.sent, active: $0.id == active)
        }
    }
}

/// The modes, the deck's Previous and Next, and the screen's place in its round.
private struct DesignPlayerBar: View {
    @Binding var mode: DesignMode
    @Binding var step: String
    let steps: [Studio.DesignsGetDesignOutputDesignRoundsItemScreensItemStepsItem]
    let screens: [String]
    @Binding var screenId: String

    private var stepIds: [String] { [""] + steps.compactMap(\.id) }
    private var stepIndex: Int { stepIds.firstIndex(of: step) ?? 0 }

    var body: some View {
        VStack(spacing: 8) {
            if !steps.isEmpty { stepper }
            HStack(spacing: 8) {
                Picker("Mode", selection: $mode) {
                    ForEach(DesignMode.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("designMode")
                if screens.count > 1 {
                    Text("\((screens.firstIndex(of: screenId) ?? 0) + 1)/\(screens.count)")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        .accessibilityLabel("Screen \((screens.firstIndex(of: screenId) ?? 0) + 1) of \(screens.count)")
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }

    /// A deck's steps: Previous, the step's name, Next; stepping plays it.
    private var stepper: some View {
        HStack {
            Button { move(-1) } label: { Image(systemName: "chevron.backward").frame(width: 44, height: 44) }
                .disabled(stepIndex == 0)
                .accessibilityLabel("Previous step")
            Spacer()
            Text(stepIndex == 0 ? "Beginning" : steps[stepIndex - 1].label ?? steps[stepIndex - 1].id ?? "")
                .font(.subheadline).lineLimit(1)
            Spacer()
            Button { move(1) } label: { Image(systemName: "chevron.forward").frame(width: 44, height: 44) }
                .disabled(stepIndex == stepIds.count - 1)
                .accessibilityLabel("Next step")
        }
        .accessibilityIdentifier("designSteps")
    }

    private func move(_ by: Int) {
        step = stepIds[min(max(0, stepIndex + by), stepIds.count - 1)]
        if mode == .view { mode = .play }
    }
}

/// A comment on a picked element: what it's on, the text, and Save or Send to the agent.
private struct DesignCommentComposer: View {
    @ObservedObject var model: DesignModel
    let screenId: String
    let step: String
    let pick: DesignPick
    let done: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var posting = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var body_: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                Section {
                    TextField("Comment", text: $text, axis: .vertical)
                        .lineLimit(2...8)
                        .focused($focused)
                        .accessibilityIdentifier("designCommentField")
                } header: {
                    Text(pick.text.isEmpty ? "On \(screenId)" : "On \u{201C}\(pick.text.prefix(80))\u{201D} in \(screenId)")
                        .textCase(nil)
                }
                Section {
                    Button { Task { await post(send: true) } } label: { Label("Send to Agent", systemImage: "paperplane") }
                        .disabled(body_.isEmpty || posting || model.design?.threadId == nil)
                        .accessibilityIdentifier("designCommentSend")
                } footer: {
                    if model.design?.threadId == nil { Text("This design has no conversation to send to; Save keeps the comment.") }
                }
            }
            .navigationTitle("New Comment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await post(send: false) } }.disabled(body_.isEmpty || posting)
                        .accessibilityIdentifier("designCommentSave")
                }
            }
            .task { focused = true }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(!text.isEmpty)
    }

    private func post(send: Bool) async {
        posting = true
        defer { posting = false }
        let failure = await model.run { try await $0.addDesignComment(model.id, screenId: screenId, step: step, pick: pick, body: body_, send: send) }
        if let failure {
            error = failure
        } else {
            done(send ? "Sent to the agent." : "Comment saved.")
            dismiss()
        }
    }
}

/// A short note over the player that goes by itself.
struct DesignNotice: View {
    @Binding var notice: String?

    var body: some View {
        if let notice {
            Text(notice).font(.footnote).lineLimit(3).padding(.horizontal, 12).padding(.vertical, 6)
                .background(.regularMaterial, in: .capsule).padding(.top, 4).padding(.horizontal)
                .onTapGesture { self.notice = nil }
                .task(id: notice) {
                    try? await Task.sleep(for: .seconds(4))
                    self.notice = nil
                }
                .accessibilityIdentifier("designNotice")
        }
    }
}
