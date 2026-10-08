import SwiftUI

/// Hold the composer's mic to talk; let go to send. Slide left before letting
/// go to cancel. The Action button starts the same recording hands-free, and
/// the next press or a tap on the mic sends it.
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
    private let threadId: String
    /// Sends the transcript; the thread puts it back in the field if that fails.
    var send: (String) -> Void = { _ in }

    init(threadId: String) { self.threadId = threadId }

    var isActive: Bool { state != .idle && state != .sending }

    func press(handsFree: Bool = false) {
        guard state == .idle else { return }
        state = handsFree ? .handsFree : .recording
        error = nil
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        starting = Task { await recorder.start(kind: "dictation", threadId: threadId) }
        watching = Task { [weak self] in
            while let self, !Task.isCancelled, self.isActive {
                self.startedAt = self.recorder.startedAt
                self.level = self.recorder.level
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
                return
            }
            let spoken = (await recorder.finish() ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if case .failed(let message) = recorder.phase { error = message; return }
            guard !spoken.isEmpty else { return }
            send(spoken)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
    }

    /// Stops without sending. The audio still reaches Talk, as when closing dictation.
    func cancel() {
        guard isActive else { return }
        state = .sending
        let started = starting
        Task {
            await started?.value
            _ = await recorder.cancel()
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
