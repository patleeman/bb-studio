import SwiftUI

extension String: @retroactive Identifiable {
    public var id: String { self }
}

/// One Talk recording or dictation: its transcript, to share or start a thread with.
struct RecordingDetailView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var recording: Recording?
    @State private var segments: [Segment] = []
    @StateObject private var player = RecordingPlayer()
    @State private var transcript = ""
    @State private var loaded = false
    @State private var error: String?
    @State private var creatingThread = false
    @State private var chatting = false
    @State private var confirmingDelete = false
    @State private var renaming = false
    @State private var newTitle = ""
    @State private var showingRelated = false
    @State private var meetingNotes: Talk.RecordingGetOutputRecordingMeetingNotes?
    @State private var generatingNotes = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let recording {
                    HStack(spacing: 6) {
                        Text(Date(timeIntervalSince1970: recording.createdAt / 1000), format: .dateTime.month().day().hour().minute())
                        Text("·")
                        Text(StudioItem.clock(recording.durationMs))
                        if let words = recording.wordCount {
                            Text("·")
                            Text("\(words) words")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                if let meetingNotes {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Summary").font(.headline)
                            Spacer()
                            Button("Regenerate") { Task { await regenerateNotes() } }
                                .disabled(generatingNotes)
                        }
                        if let summary = meetingNotes.summary, !summary.isEmpty { Text(summary).textSelection(.enabled) }

                    }
                    .padding(12)
                    .background(.fill.quaternary, in: .rect(cornerRadius: 12))
                    .accessibilityIdentifier("recordingMeetingNotes")
                } else if recording?.status == "complete" {
                    Button("Generate summary") { Task { await regenerateNotes() } }
                        .disabled(generatingNotes)
                }
                if segments.contains(where: { $0.offsetMs != nil }) {
                    RecordingTranscript(segments: segments, player: player)
                } else {
                    Text(transcript.isEmpty ? (recording?.preview ?? "") : transcript)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding()
        }
        .overlay { if !loaded { ProgressView() } }
        .safeAreaInset(edge: .bottom) {
            if player.durationMs > 0 { RecordingPlayerBar(player: player) }
        }
        .onDisappear { player.stop() }
        .navigationTitle(recording?.title ?? "Recording")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                ShareLink(item: transcript).disabled(transcript.isEmpty)
                Menu {
                    Button { creatingThread = true } label: { Label("New Thread", systemImage: "square.and.pencil") }
                    StudioChatMenuButton(isPresented: $chatting)
                    Button { showingRelated = true } label: { Label("Related", systemImage: "link") }
                    Button { UIPasteboard.general.string = transcript } label: { Label("Copy Transcript", systemImage: "doc.on.doc") }
                    Button {
                        newTitle = recording?.title ?? ""
                        renaming = true
                    } label: { Label("Rename", systemImage: "pencil") }
                    if let recording, recording.failedCount > 0 {
                        Button { Task { await perform { try await $0.retryRecording(id) } } } label: {
                            Label("Retry Transcription", systemImage: "arrow.clockwise")
                        }
                    }
                    Button(role: .destructive) { confirmingDelete = true } label: { Label("Delete", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .disabled(recording == nil)
            }
        }
        .sheet(isPresented: $creatingThread) { NewThreadView(text: transcript) }
        .sheet(isPresented: $showingRelated) { RelatedView(pluginId: "talk", itemId: id) }
        .studioChat(isPresented: $chatting, pluginId: "talk", itemId: id, title: recording?.title ?? "Recording", projectId: recording?.projectId)
        .confirmationDialog("Delete this recording?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await delete() } }
        } message: {
            Text("Its audio and transcript go too. This can't be undone.")
        }
        .alert("Rename recording", isPresented: $renaming) {
            TextField("Title", text: $newTitle)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !title.isEmpty else { return }
                Task { await perform { try await $0.renameRecording(id, title: title) } }
            }
        }
        .task { await load() }
    }

    private func perform(_ action: (BBClient) async throws -> Void) async {
        do {
            try await action(app.client)
            await load()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func load() async {
        do {
            let detail = try await app.client.recording(id)
            recording = detail.recording
            segments = detail.segments
            transcript = detail.transcript
            meetingNotes = try? await app.client.recordingNotes(id)
            // Expired dictation audio: no segments, so nothing to play.
            player.configure(
                client: app.client, recordingId: id, title: detail.recording.title,
                segments: detail.recording.audioRemoved == true ? [] : detail.segments)
            error = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
        loaded = true
    }

    private func regenerateNotes() async {
        generatingNotes = true
        defer { generatingNotes = false }
        do {
            try await app.client.regenerateRecordingNotes(id)
            await load()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func createTask(_ index: Int) async {
        do {
            let taskId = try await app.client.createTaskFromRecording(id, index: index)
            app.studioPath.append(.task(id: taskId))
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func delete() async {
        do {
            player.stop()
            try await app.client.deleteRecording(id)
            StudioStore.shared.removed(pluginId: "talk", id: id)
            dismiss()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

/// The transcript in paragraphs, one per capture session, like Talk's page.
/// Tap a paragraph's time or any sentence to play from there.
private struct RecordingTranscript: View {
    let segments: [Segment]
    @ObservedObject var player: RecordingPlayer

    private var paragraphs: [[Segment]] {
        var out: [[Segment]] = []
        for segment in segments {
            if let last = out.last?.last, last.sessionId == segment.sessionId {
                out[out.count - 1].append(segment)
            } else {
                out.append([segment])
            }
        }
        return out.filter { $0.contains { $0.status != "empty" } }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(paragraphs, id: \.first?.id) { paragraph in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Button(StudioItem.clock(paragraph.first?.offsetMs ?? 0)) {
                        paragraph.first.map { player.play(segment: $0.id) }
                    }
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Play from \(StudioItem.clock(paragraph.first?.offsetMs ?? 0))")
                    Text(text(paragraph))
                        .tint(.primary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == "bbsegment" else { return .systemAction }
            let id = url.absoluteString.dropFirst("bbsegment:".count)
            if player.playing, player.currentSegmentId == String(id) { player.pause() } else { player.play(segment: String(id)) }
            return .handled
        })
    }

    private func text(_ paragraph: [Segment]) -> AttributedString {
        var out = AttributedString()
        for segment in paragraph {
            var run: AttributedString
            switch segment.status {
            case "empty":
                continue
            case "pending":
                run = AttributedString("… ")
                run.foregroundColor = .secondary
            case "failed":
                run = AttributedString("[\(StudioItem.clock(segment.offsetMs ?? 0)) not transcribed] ")
                run.foregroundColor = .red
            default:
                guard let text = segment.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { continue }
                run = AttributedString(text + " ")
            }
            run.link = URL(string: "bbsegment:\(segment.id)")
            if segment.id == player.currentSegmentId { run.backgroundColor = Color.accentColor.opacity(0.2) }
            out += run
        }
        return out
    }
}

/// Play, skip 15 seconds, scrub the whole recording, change speed.
private struct RecordingPlayerBar: View {
    @ObservedObject var player: RecordingPlayer
    @State private var scrub: Double?
    private static let rates: [Float] = [0.75, 1, 1.25, 1.5, 2]

    var body: some View {
        let position = scrub ?? player.positionMs
        VStack(spacing: 4) {
            if let error = player.error {
                Text(error).font(.footnote).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading)
            }
            Slider(value: Binding(get: { position }, set: { scrub = $0 }), in: 0...max(player.durationMs, 1)) { editing in
                guard !editing, let scrub else { return }
                player.seek(to: scrub)
                self.scrub = nil
            }
            .accessibilityLabel("Position")
            .accessibilityValue(StudioItem.clock(position))
            HStack {
                Text(StudioItem.clock(position))
                    .accessibilityIdentifier("playerPosition")
                Spacer()
                Text("-" + StudioItem.clock(player.durationMs - position))
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
            HStack {
                Menu {
                    Picker("Speed", selection: $player.rate) {
                        ForEach(Self.rates, id: \.self) { Text(Self.label($0)).tag($0) }
                    }
                } label: {
                    Text(Self.label(player.rate))
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .frame(width: 52, alignment: .leading)
                }
                .accessibilityLabel("Speed")
                Spacer()
                Button { player.skip(seconds: -15) } label: { Image(systemName: "gobackward.15") }
                    .accessibilityLabel("Back 15 seconds")
                Button { player.toggle() } label: {
                    ZStack {
                        Image(systemName: player.playing ? "pause.fill" : "play.fill").opacity(player.loading ? 0 : 1)
                        if player.loading { ProgressView() }
                    }
                    .font(.largeTitle)
                    .frame(width: 64, height: 44)
                }
                .accessibilityLabel(player.playing ? "Pause" : "Play")
                Button { player.skip(seconds: 15) } label: { Image(systemName: "goforward.15") }
                    .accessibilityLabel("Forward 15 seconds")
                Spacer()
                Color.clear.frame(width: 52, height: 1)
            }
            .font(.title2)
            .buttonStyle(.borderless)
        }
        .padding(.horizontal)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .background(.bar)
    }

    private static func label(_ rate: Float) -> String {
        (rate == rate.rounded() ? String(format: "%.0f", rate) : String(format: "%g", rate)) + "×"
    }
}
