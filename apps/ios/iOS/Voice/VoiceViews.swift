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

/// Over the composer while voice mode has something going on: you talking
/// (red dot, time, your level) or the agent speaking (its level, the speed,
/// and Stop). The desktop's pill beside the mic.
struct VoiceStatusBar: View {
    @ObservedObject var voice: ThreadVoice
    @ObservedObject var talk: HoldToTalk
    @ObservedObject var player: VoicePlayer

    var body: some View {
        Group {
            if voice.on, talk.isActive || talk.state == .sending {
                listening
            } else if player.isPlaying(in: voice.threadId) {
                speaking
            }
        }
        .animation(.snappy, value: talk.state)
        .animation(.snappy, value: player.phase)
    }

    private var listening: some View {
        HStack(spacing: 10) {
            Circle().fill(talk.state == .cancelling ? Color.gray : .red).frame(width: 8, height: 8)
                .opacity(talk.state == .sending ? 0.4 : 1)
            if let startedAt = talk.startedAt {
                Text(startedAt, style: .timer).monospacedDigit().foregroundStyle(.primary)
                    .frame(minWidth: 34, alignment: .leading)
            }
            LevelBars(tint: .red) { talk.state == .sending ? 0 : talk.level }
            Text(listeningLabel)
                .foregroundStyle(talk.state == .cancelling ? Color.secondary : .primary)
                .lineLimit(1)
            Spacer(minLength: 0)
            if talk.state == .handsFree {
                Button("Cancel", action: talk.cancel).font(.subheadline.weight(.semibold))
            }
        }
        .modifier(VoiceStatusCard())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("voiceListening")
    }

    private var listeningLabel: String {
        switch talk.state {
        case .cancelling: "Release to cancel"
        case .handsFree: "Listening · tap mic to send"
        case .sending: "Sending what you said…"
        default: "Listening · release to send"
        }
    }

    private var speaking: some View {
        HStack(spacing: 10) {
            LevelBars(tint: .accentColor) { player.level }
            Text(player.phase == .loading ? "Getting ready…" : player.rowId == nil ? "Speaking" : "Reading aloud")
                .lineLimit(1)
                .accessibilityIdentifier("voiceSpeaking")
            Spacer(minLength: 0)
            Button(VoiceText.speedLabel(voice.speed)) { voice.cycleSpeed() }
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
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

/// A small rolling level meter.
struct LevelBars: View {
    var tint: Color
    let level: () -> Float
    @State private var history = Array(repeating: Float(0), count: 16)
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
        .onReceive(Timer.publish(every: reduceMotion ? 0.4 : 0.08, on: .main, in: .common).autoconnect()) { _ in
            history.removeFirst()
            history.append(min(1, max(0, level())))
        }
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
