import AVFoundation
import Combine
import SwiftUI

/// The composer's mic. Tap it to dictate inline: what you say streams into
/// the draft, and a second tap (or ✓) finishes it there, to edit and send.
/// Hold it to talk; let go to send. Slide left before letting go to cancel,
/// which deletes the recording. The Action button starts the same recording
/// hands-free, and the next press or a tap on the mic sends it.
@MainActor
final class HoldToTalk: ObservableObject {
    enum State: Equatable { case idle, recording, cancelling, handsFree, dictating, sending }

    @Published private(set) var state: State = .idle
    @Published private(set) var startedAt: Date?
    @Published private(set) var level: Float = 0
    @Published var error: String?
    /// What Talk has heard so far, while talking in voice mode.
    @Published private(set) var heard = ""
    /// Voice mode: short segments, and `heard` follows the transcript while you talk.
    var voice = false
    /// This talk streams into the draft (an inline dictation, or any talk in voice mode)
    /// instead of covering the field.
    @Published private(set) var inline = false
    /// The last talk ended with Cancel (or ✕): the draft goes back to what was typed.
    @Published private(set) var cancelled = false
    /// An inline dictation's words, for the draft; it isn't sent.
    var insert: (String) -> Void = { _ in }
    /// Where this talk's words go when it finishes.
    private var delivery: (String) -> Void = { _ in }

    private let recorder = TalkRecorder(client: AppModel.shared.client)
    private var starting: Task<Void, Never>?
    private var watching: Task<Void, Never>?
    private var interruptions: AnyCancellable?
    /// Set once the recorder's start has returned, so a stale failure isn't mistaken for this one.
    private var startReturned = false
    private let threadId: String?
    /// Sends the transcript; the thread puts it back in the field if that fails.
    var send: (String) -> Void = { _ in }

    init(threadId: String?) {
        self.threadId = threadId
        // A call or Siri takes the microphone: stop without sending, as the system won't give it back on release.
        interruptions = NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] note in
                let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
                    .flatMap(AVAudioSession.InterruptionType.init(rawValue:))
                if type == .began { MainActor.assumeIsolated { self?.cancel() } }
            }
    }

    var isActive: Bool { state != .idle && state != .sending }

    /// A tap on the mic: dictate inline, into the draft. In voice mode it's
    /// sent when finished, like a hold.
    func startDictation() {
        start(.dictating)
    }

    func press(handsFree: Bool = false) {
        start(handsFree ? .handsFree : .recording)
    }

    private func start(_ mode: State) {
        guard state == .idle else { return }
        state = mode
        error = nil
        cancelled = false
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        startReturned = false
        heard = ""
        let voice = Self.streams(mode, voice: self.voice)
        inline = voice
        let send = send, insert = insert
        delivery = Self.delivery(for: mode, voice: self.voice) == .insert ? { insert($0) } : { send($0) }
        starting = Task { [weak self] in
            guard let self else { return }
            await recorder.start(kind: "dictation", threadId: threadId, policy: voice ? .voice : .talk)
            startReturned = true
        }
        watching = Task { [weak self] in
            var ticks = 0
            while let self, !Task.isCancelled, self.isActive {
                self.startedAt = self.recorder.startedAt
                self.level = self.recorder.level
                ticks += 1
                // About once a second: segments are cut every few seconds in voice mode.
                if voice, ticks % 10 == 0 {
                    Task { [weak self] in
                        guard let self else { return }
                        await self.recorder.refreshTranscript()
                        if self.isActive { self.heard = self.recorder.transcript }
                    }
                }
                // No microphone (permission, storage, the session): say so now, not when the hand lets go.
                if self.startReturned, case .failed(let message) = self.recorder.phase {
                    self.error = message
                    self.cancel()
                    return
                }
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
    }

    /// While holding: past this far left, letting go cancels.
    func drag(_ translation: CGSize) {
        guard state == .recording || state == .cancelling else { return }
        let next: State = translation.width < -60 ? .cancelling : .recording
        if next != state {
            state = next
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }

    func release() {
        guard isActive else { return }
        if state == .cancelling { return cancel() }
        state = .sending
        let started = starting
        Task {
            await started?.value
            defer { stop() }
            guard recorder.phase == .recording else {
                if case .failed(let message) = recorder.phase { error = message }
                await recorder.discard()
                return
            }
            let spoken = (await recorder.finish() ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if case .failed(let message) = recorder.phase { error = message; return }
            guard !spoken.isEmpty else { return }
            delivery(spoken)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
    }

    /// Stops without sending and deletes the recording: its audio stays off
    /// the phone and off Talk. Dictation and voice chat still keep theirs.
    func cancel() {
        guard isActive else { return }
        cancelled = true
        state = .sending
        let started = starting
        Task {
            // A start still in flight sees the discard and throws away what it made.
            if started != nil { await recorder.discard() }
            await started?.value
            await recorder.discard()
            stop()
        }
    }

    enum Delivery: Equatable { case send, insert }

    /// Where a talk's words go: an inline dictation's into the draft, except in
    /// voice mode, where finishing it sends like letting go of a hold.
    static func delivery(for mode: State, voice: Bool) -> Delivery {
        mode == .dictating && !voice ? .insert : .send
    }

    /// Whether a talk streams into the draft, in short segments: inline
    /// dictations and every talk in voice mode. A plain hold covers the field.
    static func streams(_ mode: State, voice: Bool) -> Bool {
        voice || mode == .dictating
    }

    enum TapAction: Equatable { case dictate, finish, none }

    /// A tap on the mic: start dictating inline, or finish the dictation or
    /// hands-free talk under way. Nothing while words are still landing.
    static func tapAction(for state: State) -> TapAction {
        switch state {
        case .idle: .dictate
        case .handsFree, .dictating: .finish
        case .recording, .cancelling, .sending: .none
        }
    }

    func tap() {
        switch Self.tapAction(for: state) {
        case .finish: release()
        case .dictate: startDictation()
        case .none: break
        }
    }

    /// Leaving the thread or the app, or a sheet over it: an inline dictation
    /// finishes into the draft (it isn't sent, even in voice mode), so no words
    /// are lost; a talk ends unsent and deleted, as before.
    func end() {
        guard isActive else { return }
        if state == .dictating {
            let insert = insert
            delivery = { insert($0) }
            release()
        } else {
            cancel()
        }
    }

    /// The hold ended without `onEnded` (the system cancelled the gesture):
    /// stop unsent, so the mic doesn't stay stuck recording.
    /// Checked a turn later: SwiftUI may reset the gesture state before
    /// `onEnded` runs, and a normal release must reach `release()` first.
    func holdLost() {
        Task { @MainActor [weak self] in
            guard let self, state == .recording || state == .cancelling else { return }
            cancel()
        }
    }

    /// The Action button: start hands-free, or send what it started.
    func toggleHandsFree() {
        if isActive { release() } else if state == .idle { press(handsFree: true) }
    }

    private func stop() {
        watching?.cancel()
        state = .idle
        startedAt = nil
        level = 0
        heard = ""
        inline = false
    }
}

/// No hidden recording: leaving the thread or the app, or a sheet opening over
/// it, ends a talk unsent, and finishes an inline dictation into the draft.
struct TalkLifecycle: ViewModifier {
    @ObservedObject var talk: HoldToTalk
    @EnvironmentObject private var app: AppModel
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .onDisappear { talk.end() }
            .onChange(of: scenePhase) { _, phase in if phase == .background { talk.end() } }
            .onChange(of: app.sheet?.id) { _, id in if id != nil { talk.end() } }
    }
}

/// An inline talk's words in the draft: what was typed stays, and what you say
/// streams in after it as Talk transcribes. Cancel puts back what was typed;
/// anything else leaves the words in.
struct TalkDraft: ViewModifier {
    @ObservedObject var talk: HoldToTalk
    @Binding var draft: String
    /// What was typed before the talk; nil when none is streaming.
    @Binding var typed: String?

    func body(content: Content) -> some View {
        content
            .onChange(of: talk.state) { _, state in
                if talk.isActive, talk.inline, typed == nil {
                    typed = draft
                } else if state == .idle, let before = typed {
                    typed = nil
                    if talk.cancelled { draft = before }
                }
            }
            .onChange(of: talk.heard) { _, heard in
                guard let typed, !heard.isEmpty else { return }
                draft = VoiceText.join(typed: typed, heard: heard)
            }
    }

    /// The finished transcript, after what was typed: it replaces the streamed words.
    static func finished(_ text: String, typed: inout String?, draft: String) -> String {
        let before = typed ?? draft
        typed = nil
        return VoiceText.join(typed: before, heard: text)
    }
}

/// The composer's mic: tap to dictate inline, hold to talk and send.
struct HoldToTalkMic: View {
    @ObservedObject var talk: HoldToTalk
    /// Resets when the hold ends any way, including a cancelled gesture.
    @GestureState private var holding = false
    /// When the last hold ended, so its release doesn't also count as a tap.
    @State private var heldUntil: Date?

    var body: some View {
        Image(systemName: talk.isActive ? "mic.fill" : "mic")
            .font(.title3)
            .foregroundStyle(talk.isActive ? Color.white : Color.secondary)
            .frame(width: 36, height: 36)
            .background(talk.isActive ? (talk.state == .cancelling ? Color.gray : Color.red) : .clear, in: .circle)
            .scaleEffect(talk.isActive ? 1.15 : 1)
            .animation(.snappy, value: talk.state)
            // A 44pt target around the 36pt circle.
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
            // The tap on its own, beside the hold: composed with `exclusively`,
            // SwiftUI (iOS 27) never ended the tap, so the mic did nothing.
            .onTapGesture {
                // A hold's release can end a tap too; that one isn't a tap.
                if let heldUntil, Date.now.timeIntervalSince(heldUntil) < 0.5 { return }
                talk.tap()
            }
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.25)
                    .sequenced(before: DragGesture(minimumDistance: 0))
                    .updating($holding) { value, holding, _ in
                        if case .second(true, _) = value { holding = true }
                    }
                    .onChanged { value in
                        guard case .second(true, let drag) = value else { return }
                        if talk.state == .idle { talk.press() }
                        if let drag { talk.drag(drag.translation) }
                    }
                    .onEnded { _ in talk.release() }
            )
            .onChange(of: holding) { _, holding in
                if !holding { heldUntil = .now; talk.holdLost() }
            }
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("composerMic")
            .accessibilityLabel(talk.state == .dictating ? "Finish dictation" : "Dictate")
            .accessibilityHint("Tap to dictate into the message. Hold to talk and send; slide left before letting go to cancel.")
            .accessibilityAction(named: "Talk and send") { talk.toggleHandsFree() }
    }
}

/// Fills the composer's field while talking: the timer, a level, and what letting go does.
struct HoldToTalkStatus: View {
    @ObservedObject var talk: HoldToTalk
    let cancel: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(talk.state == .cancelling ? Color.gray : .red).frame(width: 8, height: 8)
                .opacity(talk.state == .sending ? 0.4 : 1)
                .accessibilityLabel(label)
            if let startedAt = talk.startedAt {
                Text(startedAt, style: .timer).monospacedDigit().foregroundStyle(.secondary)
            }
            // No words: the dot (grey to cancel), time and spinner say it; VoiceOver reads the label.
            if talk.state == .sending { ProgressView().controlSize(.small) }
            Spacer(minLength: 0)
            if talk.state == .handsFree {
                Button(action: cancel) {
                    Image(systemName: "xmark").font(.footnote.weight(.bold))
                        .frame(width: 30, height: 30)
                        .background(.fill.secondary, in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cancel")
            }
        }
        .font(.subheadline)
        .padding(.horizontal, 12)
        .frame(minHeight: 40)
    }

    private var label: String {
        switch talk.state {
        case .cancelling: "Release to cancel"
        case .handsFree: "Listening · tap mic to send"
        case .sending: "Transcribing…"
        default: "Release to send · ← cancel"
        }
    }
}
