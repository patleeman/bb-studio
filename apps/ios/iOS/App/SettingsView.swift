import AVFoundation
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var app: AppModel
    @State private var serverURL = ""
    @State private var status: String?
    @AppStorage(VoiceChatEngine.voiceKey) private var voiceId = ""
    @AppStorage(VoiceChatEngine.rateKey) private var rate = 1.08
    @State private var preview = AVSpeechSynthesizer()
    @AppStorage("runningPlugins") private var runningPlugins = ""

    var body: some View {
        Form {
            Section {
                TextField("https://machine.tailnet.ts.net", text: $serverURL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                Button("Save and test") { Task { await save() } }
                if let status { Text(status).font(.footnote).foregroundStyle(.secondary) }
            } header: {
                Text("BB server")
            } footer: {
                Text("Reached over Tailscale Serve. BB has no client auth, so the tailnet is the boundary.")
            }
            ServerControls()
            if runningPlugins.split(separator: ",").contains("custom-instructions") {
                Section("Agents") {
                    NavigationLink { CustomInstructionsView() } label: {
                        Label("Custom Instructions", systemImage: "text.quote")
                    }
                }
            }
            Section {
                Picker("Voice", selection: $voiceId) {
                    Text("Best installed").tag("")
                    ForEach(VoiceChatEngine.voices, id: \.identifier) { voice in
                        Text("\(voice.name)\(Self.quality(voice))").tag(voice.identifier)
                    }
                }
                LabeledContent("Speed") {
                    Slider(value: $rate, in: 0.8...1.5, step: 0.05)
                }
                Button("Preview") {
                    let utterance = AVSpeechUtterance(string: "Hi, this is how BB sounds in voice chat.")
                    utterance.voice = voiceId.isEmpty ? VoiceChatEngine.voices.first : AVSpeechSynthesisVoice(identifier: voiceId)
                    utterance.rate = AVSpeechUtteranceDefaultSpeechRate * Float(rate)
                    preview.stopSpeaking(at: .immediate)
                    preview.speak(utterance)
                }
            } header: {
                Text("Voice chat")
            } footer: {
                Text("Download Premium or Enhanced voices in Settings → Accessibility → Spoken Content → Voices. Talk over BB to interrupt it.")
            }
            Section("Action button") {
                Text(
                    "Settings → Action Button → Shortcut, then pick a BB Studio action: Dictate to BB, Voice chat with BB, or Open BB thread."
                )
                .font(.footnote)
            }
        }
        .navigationTitle("Settings")
        .onAppear { serverURL = app.serverURL.absoluteString }
    }

    private static func quality(_ voice: AVSpeechSynthesisVoice) -> String {
        switch voice.quality {
        case .premium: " · Premium"
        case .enhanced: " · Enhanced"
        default: ""
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
