import SwiftUI

/// Beside the composer's mic: the speaker turns voice mode on or off for the
/// thread (replies are spoken); a long press opens its menu, as iOS menus with
/// a primary action do: conversational replies, speed, and voice settings.
struct VoiceModeButton: View {
    @ObservedObject var voice: ThreadVoice
    let openSettings: () -> Void

    var body: some View {
        Menu {
            Toggle(isOn: Binding(get: { voice.on }, set: { voice.set($0) })) {
                Label("Voice Mode", systemImage: "speaker.wave.2")
            }
            Toggle(isOn: Binding(get: { voice.conversational }, set: { voice.setConversational($0) })) {
                Text("Conversational Replies")
                Text("Short spoken answers, no markdown")
            }
            Picker(selection: Binding(get: { voice.speed }, set: { voice.setSpeed($0) })) {
                ForEach(VoiceText.speeds, id: \.self) { speed in
                    Text(VoiceText.speedLabel(speed)).tag(speed)
                }
            } label: {
                Label("Speed", systemImage: "gauge.with.dots.needle.50percent")
                Text(VoiceText.speedLabel(voice.speed))
            }
            .pickerStyle(.menu)
            Button(action: openSettings) { Label("Voice Settings…", systemImage: "slider.horizontal.3") }
        } label: {
            Image(systemName: voice.on ? "speaker.wave.2.fill" : "speaker.slash")
                .font(.body.weight(voice.on ? .semibold : .regular))
                .foregroundStyle(voice.on ? Color.accentColor : .secondary)
                .frame(width: 36, height: 36)
                .background(voice.on ? Color.accentColor.opacity(0.15) : .clear, in: .circle)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        } primaryAction: {
            voice.toggle()
        }
        .menuIndicator(.hidden)
        .accessibilityLabel("Voice mode")
        .accessibilityValue(voice.on ? "On" : "Off")
        .accessibilityHint("Speaks replies aloud. Touch and hold for voice settings.")
        .accessibilityIdentifier("composerVoice")
        .sensoryFeedback(.selection, trigger: voice.on)
    }
}

/// Your voice over the composer, while you dictate or talk: a red dot, the
/// time (dictation only), your level, and what ends it (✓ finish, ✕ cancel).
/// In voice mode's hands-free the whole pill is the way back to push to talk.
struct TalkStatusBar: View {
    @ObservedObject var talk: HoldToTalk
    /// Dictation's timer; voice mode's turns are short and have none.
    var showsTimer = true
    /// Hands-free in voice mode: a tap on the pill goes back to push to talk.
    var exitHandsFree: (() -> Void)? = nil

    var body: some View {
        Group {
            if talk.state != .idle {
                if let exitHandsFree, talk.state == .handsFree {
                    Button(action: exitHandsFree) { listening }
                        .buttonStyle(.plain)
                        .accessibilityHint("Tap to go back to push to talk.")
                } else {
                    listening
                }
            }
        }
        .animation(.snappy, value: talk.state)
    }

    private var listening: some View {
        HStack(spacing: 10) {
            Circle().fill(talk.state == .cancelling ? Color.gray : .red).frame(width: 8, height: 8)
                .opacity(talk.state == .sending ? 0.4 : 1)
            if showsTimer, let startedAt = talk.startedAt {
                Text(startedAt, style: .timer).monospacedDigit().foregroundStyle(.primary)
                    .frame(minWidth: 34, alignment: .leading)
            }
            // No words beside the controls: the dot, time and level say it; VoiceOver reads the label.
            LevelBars(tint: .red) { [weak talk] in talk?.state == .sending ? 0 : talk?.level ?? 0 }
                .accessibilityElement()
                .accessibilityLabel(listeningLabel)
            if talk.state == .sending { ProgressView().controlSize(.small) }
            Spacer(minLength: 0)
            if talk.state == .handsFree, exitHandsFree == nil {
                Button(action: talk.cancel) {
                    Image(systemName: "xmark").font(.footnote.weight(.bold))
                        .frame(width: 30, height: 30)
                        .background(.fill.secondary, in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cancel")
            } else if talk.state == .dictating {
                Button(action: talk.cancel) {
                    Image(systemName: "xmark").font(.footnote.weight(.bold))
                        .frame(width: 30, height: 30)
                        .background(.fill.secondary, in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cancel dictation")
                .accessibilityIdentifier("dictationCancel")
                Button(action: talk.release) {
                    Image(systemName: "checkmark").font(.footnote.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(Color.accentColor, in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(talk.voice ? "Finish and send" : "Finish dictation")
                .accessibilityIdentifier("dictationFinish")
            }
        }
        .modifier(VoiceStatusCard())
        .contentShape(.capsule)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("talkListening")
    }

    private var listeningLabel: String {
        switch talk.state {
        case .cancelling: "Release to cancel"
        case .handsFree: exitHandsFree == nil ? "Listening · tap mic to send" : "Listening hands-free"
        case .dictating: "Listening"
        case .sending: talk.cancelled ? "Cancelling…" : talk.voice ? "Sending what you said…" : "Transcribing…"
        default: "Listening · release to send · slide left to cancel"
        }
    }
}

/// Over the composer while a reply is spoken: its level, the speed, and Stop.
struct VoiceStatusBar: View {
    @ObservedObject var voice: ThreadVoice
    @ObservedObject var player: VoicePlayer

    var body: some View {
        Group {
            if player.isPlaying(in: voice.threadId) { speaking }
        }
        .animation(.snappy, value: player.phase)
    }

    private var speaking: some View {
        HStack(spacing: 10) {
            Image(systemName: "speaker.wave.2.fill")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color.botVoice)
                .accessibilityHidden(true)
            LevelBars(tint: .botVoice) { [weak player] in player?.level ?? 0 }
                .accessibilityElement()
                .accessibilityLabel(player.phase == .loading ? "Getting ready…" : player.rowId == nil ? "Speaking" : "Reading aloud")
                .accessibilityIdentifier("voiceSpeaking")
            if player.phase == .loading { ProgressView().controlSize(.small) }
            Spacer(minLength: 0)
            Button(VoiceText.speedLabel(voice.speed)) { voice.cycleSpeed() }
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .tint(.botVoice)
                .accessibilityLabel("Speed \(VoiceText.speedLabel(voice.speed)), change")
            Button { player.stop() } label: {
                Image(systemName: "stop.fill").font(.footnote.weight(.bold))
                    .frame(width: 30, height: 30)
                    .background(.fill.secondary, in: .circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stop speaking")
            .accessibilityIdentifier("voiceStop")
        }
        .modifier(VoiceStatusCard())
    }
}

extension Color {
    /// The Bot's voice: blue, apart from your own voice in red (as on desktop).
    static let botVoice = Color.blue
}

private struct VoiceStatusCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.subheadline)
            .padding(.leading, 14)
            .padding(.trailing, 8)
            .frame(minHeight: 44)
            .background(.fill.tertiary, in: .capsule)
            .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

/// A small rolling level meter, on the shared voice clock (slower with
/// Reduce Motion); it stops with the clock while the app is inactive.
struct LevelBars: View {
    var tint: Color
    let level: () -> Float
    @State private var history = Array(repeating: Float(0), count: 16)
    @State private var subscription: UUID?
    @State private var ticks = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 2) {
            ForEach(history.indices, id: \.self) { index in
                Capsule().fill(tint)
                    .frame(width: 2.5, height: 3 + CGFloat(history[index]) * 15)
            }
        }
        .frame(height: 18)
        .accessibilityHidden(true)
        .onAppear {
            guard subscription == nil else { return }
            subscription = VoiceClock.shared.subscribe { sample() }
        }
        .onDisappear {
            if let subscription { VoiceClock.shared.unsubscribe(subscription) }
            subscription = nil
        }
    }

    private func sample() {
        ticks += 1
        if reduceMotion, ticks % 4 != 0 { return }
        history.removeFirst()
        history.append(min(1, max(0, level())))
    }
}

/// Studio's speech settings: engine, model, voice and speed, with a sample.
/// In Settings, and from a voice thread's composer.
struct SpeechSettingsView: View {
    /// The thread the menu was opened from; Settings has none.
    var voice: ThreadVoice?
    @StateObject private var model = SpeechSettingsModel()
    /// The conversational switch, read without a thread in Settings.
    @State private var conversational: Bool?
    @EnvironmentObject private var app: AppModel

    var body: some View {
        Form {
            if !model.available {
                ContentUnavailableView(BBClient.missingPluginMessage("Studio"), systemImage: "speaker.slash")
            } else if let settings = model.settings {
                Section {
                    Toggle("Conversational Replies", isOn: Binding(
                        get: { voice?.conversational ?? conversational ?? true },
                        set: { setConversational($0) }))
                } footer: {
                    Text("Voice threads answer in a few short spoken sentences, with no markdown, lists or code.")
                }
                Section {
                    if !model.engines.isEmpty {
                        Picker("Engine", selection: Binding(get: { model.engine }, set: { engine in Task { await model.update(engine: engine) } })) {
                            ForEach(model.engines) { Text($0.label).tag($0.id) }
                        }
                    }
                    if model.models.isEmpty {
                        LabeledContent("Model", value: model.model)
                    } else {
                        Picker("Model", selection: Binding(get: { model.model }, set: { id in Task { await model.update(model: id) } })) {
                            if model.currentModel == nil { Text(model.model).tag(model.model) }
                            ForEach(model.models, id: \.id) { item in
                                Text(Self.modelName(item)).tag(item.id ?? "")
                            }
                        }
                    }
                    if !model.voices.isEmpty {
                        Picker("Voice", selection: Binding(get: { model.voice }, set: { id in Task { await model.update(voice: id) } })) {
                            if !model.voices.contains(where: { $0.id == model.voice }) {
                                Text(model.voice.isEmpty ? "Model default" : model.voice).tag(model.voice)
                            }
                            ForEach(model.voices) { Text($0.label).tag($0.id) }
                        }
                    } else if !model.voice.isEmpty {
                        LabeledContent("Voice", value: model.voice)
                    }
                    if let instructions = settings.instructions, !instructions.isEmpty {
                        LabeledContent("Delivery") { Text(instructions).lineLimit(3) }
                    }
                    Picker("Speed", selection: Binding(get: { model.speed }, set: { speed in
                        voice?.follow(speed: speed)
                        Task { await model.update(speed: speed) }
                    })) {
                        if !VoiceText.speeds.contains(model.speed) { Text(VoiceText.speedLabel(model.speed)).tag(model.speed) }
                        ForEach(VoiceText.speeds, id: \.self) { Text(VoiceText.speedLabel($0)).tag($0) }
                    }
                    Button {
                        model.playSample()
                    } label: {
                        Label("Play Sample", systemImage: "play.circle")
                    }
                    .disabled(settings.problem != nil)
                    .accessibilityIdentifier("speechPlaySample")
                } header: {
                    Text("Speech")
                } footer: {
                    if let problem = settings.problem {
                        Text("Replies can't be spoken yet: \(problem) Set it up in Studio → Setup → Speech on the desktop.")
                            .foregroundStyle(.red)
                    } else {
                        Text("Studio speaks replies on the server, in the same voice as the desktop. API keys and custom endpoints are set on the desktop.")
                    }
                }
                if let error = model.error {
                    Section { Text(error).font(.footnote).foregroundStyle(.red) }
                }
            } else if let error = model.error {
                ContentUnavailableView("Couldn't load speech settings", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Voice")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await model.load()
            if voice == nil, let state = try? await app.client.voiceState(Self.settingsThread) {
                conversational = state.conversational
            }
        }
        .refreshable { await model.load() }
    }

    /// `voice.state` and `voice.conversational` name a thread; the switch is the same for every one.
    static let settingsThread = "settings"

    static func modelName(_ model: SpeechModel) -> String {
        let name = model.name ?? model.id ?? ""
        guard let price = model.pricePerMillionChars else { return name }
        return "\(name) · $\(price.formatted(.number.precision(.fractionLength(0...2))))/M chars"
    }

    private func setConversational(_ on: Bool) {
        if let voice { return voice.setConversational(on) }
        let before = conversational
        conversational = on
        Task {
            do {
                conversational = try await app.client.setVoiceConversational(Self.settingsThread, on: on).conversational ?? on
            } catch {
                conversational = before
                model.error = BBClient.describe(error, server: app.client.baseURL)
            }
        }
    }
}
