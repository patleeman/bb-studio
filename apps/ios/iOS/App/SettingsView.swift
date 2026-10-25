import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var app: AppModel
    @State private var serverURL = ""
    @State private var status: String?
    @AppStorage(ServerScope.key("runningPlugins")) private var runningPlugins = ""
    @ObservedObject private var audioOutbox = TalkOutbox.shared
    @State private var confirmingLegacyUpload = false
    @State private var confirmingLegacyDrafts = false
    @State private var discardingAudio: URL?
    @State private var audioRecoveryError: String?

    var body: some View {
        Form {
            Section {
                TextField("https://machine.tailnet.ts.net", text: $serverURL, axis: .vertical)
                    .accessibilityLabel("BB server URL")
                    .accessibilityIdentifier("settingsServerURL")
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                Button("Save and test") { Task { await save() } }
                if let status { Text(status).font(.footnote).foregroundStyle(Color.primary.opacity(0.75)) }
            } header: {
                Text("BB server").foregroundStyle(Color.primary.opacity(0.75))
            } footer: {
                Text("Reached over Tailscale Serve. BB has no client auth, so the tailnet is the boundary.")
                    .foregroundStyle(Color.primary.opacity(0.75))
            }
            ServerControls()
            if !Drafts.legacyKeys.isEmpty {
                Section("Older drafts") {
                    Text("Older drafts are preserved, but their original server is unknown.").font(.footnote)
                    Button("Recover older drafts…") { confirmingLegacyDrafts = true }
                }
            }
            if audioOutbox.recoveryError != nil || !audioOutbox.recoveryFiles.isEmpty {
                Section("Audio recovery") {
                    if let error = audioOutbox.recoveryError { Text(error).font(.footnote) }
                    Button("Retry recovering audio") { audioOutbox.recoverCaptures() }
                    if let audioRecoveryError { Text(audioRecoveryError).font(.footnote).foregroundStyle(.red) }
                    ForEach(audioOutbox.recoveryFiles, id: \.self) { file in
                        VStack(alignment: .leading, spacing: 8) {
                            if FileManager.default.fileExists(atPath: file.path) {
                                ShareLink(item: file) { Label("Export \(file.lastPathComponent)", systemImage: "square.and.arrow.up") }
                            } else {
                                Text("Missing audio: \(file.lastPathComponent)").font(.footnote)
                            }
                            Button("Discard local copy…", role: .destructive) { discardingAudio = file }
                        }
                    }
                    Text("Unidentified audio is never uploaded automatically. PCM exports are 16 kHz, mono, 16-bit little-endian audio.").font(.footnote)
                }
            }
            if audioOutbox.legacyPending > 0 {
                Section("Older recordings") {
                    Text("\(audioOutbox.legacyPending) recording(s) are preserved on this phone, but their original server was not saved.")
                        .font(.footnote)
                    Button("Resume older uploads…") { confirmingLegacyUpload = true }
                }
            }
            Section {
                NavigationLink { PluginStatusView() } label: {
                    Label("Plugins", systemImage: "puzzlepiece.extension")
                }
                if runningPlugins.split(separator: ",").contains("account-pool") {
                    NavigationLink { UsageView() } label: {
                        Label("Usage", systemImage: "gauge.with.dots.needle.33percent")
                    }
                }
            } header: {
                Text("Server").foregroundStyle(Color.primary.opacity(0.75))
            }
            Section {
                NavigationLink { ArchivedView() } label: {
                    Label("Archived threads", systemImage: "archivebox")
                }
            } header: {
                Text("Threads").foregroundStyle(Color.primary.opacity(0.75))
            }
            if runningPlugins.split(separator: ",").contains("custom-instructions") {
                Section("Agents") {
                    NavigationLink { CustomInstructionsView() } label: {
                        Label("Custom Instructions", systemImage: "text.quote")
                    }
                }
            }
            if runningPlugins.split(separator: ",").contains("studio") {
                Section {
                    NavigationLink { SpeechSettingsView() } label: {
                        Label("Voice", systemImage: "speaker.wave.2")
                    }
                    .accessibilityIdentifier("settingsVoice")
                } header: {
                    Text("Voice").foregroundStyle(Color.primary.opacity(0.75))
                } footer: {
                    Text("Replies in voice threads are spoken in Studio's voice. Turn voice mode on in any thread with the speaker beside the mic.")
                        .foregroundStyle(Color.primary.opacity(0.75))
                }
            }
            ScrollLogSection()
            Section("Action button") {
                Text(
                    "Settings → Action Button → Shortcut, then pick a BB Studio action: Dictate to BB or Open BB thread."
                )
                .font(.footnote)
            }
        }
        .navigationTitle("Settings")
        .onAppear { serverURL = app.serverURL.absoluteString }
        .confirmationDialog("Discard this local audio copy?", isPresented: .init(get: { discardingAudio != nil }, set: { if !$0 { discardingAudio = nil } }), titleVisibility: .visible, presenting: discardingAudio) { file in
            Button("Discard local copy", role: .destructive) {
                do { try audioOutbox.discardLocalCopy(file); audioRecoveryError = nil }
                catch { audioRecoveryError = error.localizedDescription }
                discardingAudio = nil
            }
            Button("Cancel", role: .cancel) { discardingAudio = nil }
        } message: { file in
            Text("This permanently deletes only \(file.lastPathComponent) and its recovery metadata from this phone. It may allow the recording to finish without this audio. Export it first if you want to keep it. Other local files and server audio are unchanged.")
        }
        .confirmationDialog("Recover drafts onto \(app.serverURL.host() ?? app.serverURL.absoluteString)?", isPresented: $confirmingLegacyDrafts, titleVisibility: .visible) {
            Button("Recover onto this server") { Drafts.recoverLegacy(to: app.serverURL) }
        } message: {
            Text("Only continue if these drafts belong to this server. Existing drafts are kept, and the originals remain preserved.")
        }
        .confirmationDialog("Resume older uploads to \(app.serverURL.host() ?? app.serverURL.absoluteString)?", isPresented: $confirmingLegacyUpload, titleVisibility: .visible) {
            Button("Upload to this server") {
                do { try audioOutbox.resumeLegacy(on: app.serverURL) }
                catch { status = error.localizedDescription }
            }
        } message: {
            Text("Continue only if these recordings were created on this server. To use another server, cancel and save its URL first.")
        }
    }

    private func save() async {
        guard let url = URL(string: serverURL.trimmingCharacters(in: .whitespaces)), url.scheme != nil else {
            status = "Not a valid URL"
            return
        }
        app.setServerURL(url)
        do {
            let threads = try await app.client.threads()
            status = "Connected · \(threads.count) open threads"
        } catch {
            status = BBClient.describe(error, server: url)
        }
    }
}
