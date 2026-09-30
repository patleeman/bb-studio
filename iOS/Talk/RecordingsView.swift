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
    @State private var transcript = ""
    @State private var loaded = false
    @State private var error: String?
    @State private var creatingThread = false
    @State private var confirmingDelete = false
    @State private var renaming = false
    @State private var newTitle = ""

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
                Text(transcript.isEmpty ? (recording?.preview ?? "") : transcript)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding()
        }
        .overlay { if !loaded { ProgressView() } }
        .navigationTitle(recording?.title ?? "Recording")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                ShareLink(item: transcript).disabled(transcript.isEmpty)
                Menu {
                    Button { creatingThread = true } label: { Label("New Thread", systemImage: "square.and.pencil") }
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
            transcript = detail.transcript
            error = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
        loaded = true
    }

    private func delete() async {
        do {
            try await app.client.deleteRecording(id)
            StudioStore.shared.removed(pluginId: "talk", id: id)
            dismiss()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
