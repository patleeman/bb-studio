import SwiftUI
import UIKit

/// The one indicator over the composer while you dictate or talk: Talk's
/// recorder, with its timer and level. Nothing shows when the mic is idle.
struct TalkIndicator: View {
    @ObservedObject var talk: HoldToTalk

    var body: some View {
        TalkStatusBar(talk: talk)
    }

    /// The field's placeholder while the mic listens, in place of a label beside the controls.
    static func placeholder(_ talk: HoldToTalk) -> String? {
        talk.isActive ? "Listening…" : nil
    }

    #if DEBUG
    /// `-qaDictation listening` (with `-qaBotDemo chat`): the composer caught
    /// dictating, with no server or mic, for screenshots.
    static var qaDictating: Bool {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-qaDictation"), arguments.indices.contains(index + 1) else { return false }
        return arguments[index + 1] == "listening"
    }
    #endif
}

/// Your voice over the composer, while you dictate or talk: a red dot, the
/// time, your level, and what ends it (✓ finish, ✕ cancel).
struct TalkStatusBar: View {
    @ObservedObject var talk: HoldToTalk

    var body: some View {
        Group {
            if talk.state != .idle { listening }
        }
        .animation(.snappy, value: talk.state)
    }

    private var listening: some View {
        HStack(spacing: 10) {
            Circle().fill(talk.state == .cancelling ? Color.gray : .red).frame(width: 8, height: 8)
                .opacity(talk.state == .sending ? 0.4 : 1)
            if let startedAt = talk.startedAt {
                Text(startedAt, style: .timer).monospacedDigit().foregroundStyle(.primary)
                    .frame(minWidth: 34, alignment: .leading)
            }
            // No words beside the controls: the dot, time and level say it; VoiceOver reads the label.
            LevelBars(tint: .red) { [weak talk] in talk?.state == .sending ? 0 : talk?.level ?? 0 }
                .accessibilityElement()
                .accessibilityLabel(listeningLabel)
            if talk.state == .sending { ProgressView().controlSize(.small) }
            Spacer(minLength: 0)
            if talk.state == .handsFree {
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
                .accessibilityLabel("Finish dictation")
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
        case .handsFree: "Listening · tap mic to send"
        case .dictating: "Listening"
        case .sending: talk.cancelled ? "Cancelling…" : "Transcribing…"
        default: "Listening · release to send · slide left to cancel"
        }
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

/// The app's one clock for voice: the level meters and the mic's polling all
/// tick on it, ten times a second, only while something subscribes and only
/// while the app is active. No per-frame animation.
@MainActor
final class VoiceClock {
    static let shared = VoiceClock()
    static let interval: Duration = .milliseconds(100)

    private var subscribers: [UUID: () -> Void] = [:]
    private var task: Task<Void, Never>?
    private var active = true
    private var observers: [NSObjectProtocol] = []

    private init() {
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.setActive(false) }
            },
            center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.setActive(true) }
            },
        ]
        active = UIApplication.shared.applicationState == .active
    }

    var isRunning: Bool { task != nil }

    func subscribe(_ tick: @escaping () -> Void) -> UUID {
        let id = UUID()
        subscribers[id] = tick
        update()
        return id
    }

    func unsubscribe(_ id: UUID) {
        subscribers[id] = nil
        update()
    }

    private func setActive(_ next: Bool) {
        active = next
        update()
    }

    private func update() {
        let needed = active && !subscribers.isEmpty
        if needed, task == nil {
            task = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: Self.interval)
                    guard let self, !Task.isCancelled else { return }
                    for tick in Array(self.subscribers.values) { tick() }
                }
            }
        } else if !needed, let task {
            task.cancel()
            self.task = nil
        }
    }
}
