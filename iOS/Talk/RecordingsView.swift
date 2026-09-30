import SwiftUI

/// The Talk tab: start a dictation or long recording, and browse past ones.
struct RecordingsView: View {
    @EnvironmentObject private var app: AppModel
    @State private var recordings: [Recording] = []
    @State private var error: String?
    @State private var recordingKind: String?

    var body: some View {
        List {
            Section {
                HStack {
                    Button { recordingKind = "dictation" } label: {
                        Label("Dictate", systemImage: "mic.fill").frame(maxWidth: .infinity)
                    }
                    Button { recordingKind = "recording" } label: {
                        Label("Record", systemImage: "record.circle").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .listRowBackground(Color.clear)
            }
            if let error { Text(error).foregroundStyle(.red).font(.footnote) }
            Section("Recent") {
                ForEach(recordings) { recording in
                    NavigationLink {
                        RecordingDetailView(recording: recording)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(recording.title).lineLimit(1)
                            Text(recording.preview).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            HStack {
                                Text(
                                    Date(timeIntervalSince1970: recording.createdAt / 1000),
                                    format: .relative(presentation: .named, unitsStyle: .abbreviated))
                                Text("· \(Int(recording.durationMs / 1000))s · \(recording.status)")
                            }
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Talk")
        .refreshable { await load() }
        .task { await load() }
        .sheet(item: $recordingKind) { kind in
            DictationView(threadId: nil, autoStart: true, kind: kind)
                .onDisappear { Task { await load() } }
        }
    }

    private func load() async {
        do {
            recordings = try await app.client.recordings()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension String: @retroactive Identifiable {
    public var id: String { self }
}

struct RecordingDetailView: View {
    @EnvironmentObject private var app: AppModel
    let recording: Recording
    @State private var transcript = ""
    @State private var creatingThread = false

    var body: some View {
        ScrollView {
            Text(transcript.isEmpty ? recording.preview : transcript)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
        }
        .navigationTitle(recording.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                ShareLink(item: transcript)
                Button { creatingThread = true } label: { Image(systemName: "square.and.pencil") }
            }
        }
        .sheet(isPresented: $creatingThread) { NewThreadView(text: transcript) }
        .task { transcript = (try? await app.client.recording(recording.id).transcript) ?? "" }
    }
}
