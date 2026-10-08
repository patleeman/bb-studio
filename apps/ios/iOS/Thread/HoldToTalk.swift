import AVFoundation
import Combine
import SwiftUI

/// Hold the composer's mic to talk; let go to send. Slide left before letting
/// go to cancel, which deletes the recording. The Action button starts the
/// same recording hands-free, and the next press or a tap on the mic sends it.
@MainActor
final class HoldToTalk: ObservableObject {
    enum State: Equatable { case idle, recording, cancelling, handsFree, sending }

    @Published private(set) var state: State = .idle
    @Published private(set) var startedAt: Date?
    @Published private(set) var level: Float = 0
    @Published var error: String?

    private let recorder = TalkRecorder(client: AppModel.shared.client)
    private var starting: Task<Void, Never>?
    private var watching: Task<Void, Never>?
    private var interruptions: AnyCancellable?
    /// Set once the recorder's start has returned, so a stale failure isn't mistaken for this one.
    private var startReturned = false
    private let threadId: String
    /// Sends the transcript; the thread puts it back in the field if that fails.
    var send: (String) -> Void = { _ in }

    init(threadId: String) {
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

    func press(handsFree: Bool = false) {
        guard state == .idle else { return }
        state = handsFree ? .handsFree : .recording
        error = nil
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        startReturned = false
        starting = Task { [weak self] in
            guard let self else { return }
            await recorder.start(kind: "dictation", threadId: threadId)
            startReturned = true
        }
        watching = Task { [weak self] in
            while let self, !Task.isCancelled, self.isActive {
                self.startedAt = self.recorder.startedAt
                self.level = self.recorder.level
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
            send(spoken)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
    }

    /// Stops without sending and deletes the recording: its audio stays off
    /// the phone and off Talk. Dictation and voice chat still keep theirs.
    func cancel() {
        guard isActive else { return }
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

    /// The Action button: start hands-free, or send what it started.
    func toggleHandsFree() {
        if isActive { release() } else if state == .idle { press(handsFree: true) }
    }

    private func stop() {
        watching?.cancel()
        state = .idle
        startedAt = nil
        level = 0
    }
}

/// No hidden recording: leaving the thread or the app, or opening dictation or
/// voice chat, ends a talk unsent.
struct TalkLifecycle: ViewModifier {
    @ObservedObject var talk: HoldToTalk
    let dictating: Bool
    @EnvironmentObject private var app: AppModel
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .onDisappear { talk.cancel() }
            .onChange(of: scenePhase) { _, phase in if phase == .background { talk.cancel() } }
            .onChange(of: dictating) { _, on in if on { talk.cancel() } }
            .onChange(of: app.sheet?.id) { _, id in if id != nil { talk.cancel() } }
    }
}

/// The composer's mic: tap for dictation, hold to talk and send.
struct HoldToTalkMic: View {
    @ObservedObject var talk: HoldToTalk
    let tap: () -> Void

    var body: some View {
        Image(systemName: talk.isActive ? "mic.fill" : "mic")
            .font(.title3)
            .foregroundStyle(talk.isActive ? Color.white : Color.secondary)
            .frame(width: 36, height: 36)
            .background(talk.isActive ? (talk.state == .cancelling ? Color.gray : Color.red) : .clear, in: .circle)
            .scaleEffect(talk.isActive ? 1.15 : 1)
            .animation(.snappy, value: talk.state)
            .contentShape(.circle)
            .gesture(
                LongPressGesture(minimumDuration: 0.25)
                    .sequenced(before: DragGesture(minimumDistance: 0))
                    .onChanged { value in
                        guard case .second(true, let drag) = value else { return }
                        if talk.state == .idle { talk.press() }
                        if let drag { talk.drag(drag.translation) }
                    }
                    .onEnded { _ in talk.release() }
                    .exclusively(before: TapGesture().onEnded {
                        if talk.state == .handsFree { talk.release() } else if talk.state == .idle { tap() }
                    })
            )
            .accessibilityLabel("Dictate")
            .accessibilityHint("Hold to talk and send. Slide left before letting go to cancel.")
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
            if let startedAt = talk.startedAt {
                Text(startedAt, style: .timer).monospacedDigit().foregroundStyle(.secondary)
            }
            Text(label)
                .foregroundStyle(talk.state == .cancelling ? Color.secondary : .primary)
                .lineLimit(1)
            Spacer(minLength: 0)
            if talk.state == .handsFree {
                Button("Cancel", action: cancel).font(.subheadline.weight(.semibold))
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
