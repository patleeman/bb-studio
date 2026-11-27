import SwiftUI
import UIKit

/// Whether anyone is using the app right now, for the things that animate or
/// poll while nothing changes.
///
/// - `idle` turns on `idleAfter` seconds after the last touch or keystroke and
///   off at the next one. The live scene and the live presence pause while
///   idle (they keep their last frame), and polls wait longer.
/// - `typing` is on while the keyboard is up: the live scene pauses behind it.
/// - Polls wait through `pollWait`, which also holds them while the app is in
///   the background and lets them run again when it comes back.
@MainActor
final class EnergyGate: ObservableObject {
    static let shared = EnergyGate()
    nonisolated static let idleAfter: TimeInterval = 30
    /// How much longer a poll waits while idle, and the longest wait.
    nonisolated static let idleBackoff = 3
    nonisolated static let longestPoll: Duration = .seconds(180)
    /// After this long without a touch, every poll waits `restingPoll`.
    nonisolated static let restingAfter: TimeInterval = 300
    nonisolated static let restingPoll: Duration = .seconds(300)

    @Published private(set) var idle = false
    @Published private(set) var typing = false
    private(set) var lastActivity = Date()
    private var check: Task<Void, Never>?
    private var observers: [NSObjectProtocol] = []
    private var watched: Set<ObjectIdentifier> = []
    /// In the background: polls hold until the app is back.
    private(set) var background = false
    private var waitingForForeground: [UUID: CheckedContinuation<Void, Never>] = [:]

    init(watchKeyboard: Bool = true) {
        guard watchKeyboard else { return }
        let center = NotificationCenter.default
        func on(_ name: Notification.Name, _ body: @escaping @MainActor (EnergyGate) -> Void) -> NSObjectProtocol {
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { if let self { body(self) } }
            }
        }
        observers = [
            on(UIResponder.keyboardWillShowNotification) { $0.typing = true; $0.touched() },
            on(UIResponder.keyboardWillHideNotification) { $0.typing = false; $0.touched() },
            on(UITextView.textDidChangeNotification) { $0.touched() },
            on(UITextField.textDidChangeNotification) { $0.touched() },
            on(UIApplication.didBecomeActiveNotification) { $0.touched() },
            on(UIApplication.didEnterBackgroundNotification) { $0.setBackground(true) },
            on(UIApplication.willEnterForegroundNotification) { $0.setBackground(false) },
        ]
    }

    /// Idle when the last touch or keystroke is `after` seconds old.
    nonisolated static func isIdle(lastActivity: Date, now: Date, after: TimeInterval = idleAfter) -> Bool {
        now.timeIntervalSince(lastActivity) >= after
    }

    /// A poll's wait: as given while in use, `idleBackoff` times longer (at
    /// most `longestPoll`) while idle or saving energy (Low Power Mode, a
    /// warm phone), and `restingPoll` once nobody has touched the phone for
    /// `restingAfter`.
    nonisolated static func pollDelay(_ base: Duration, idle: Bool, idleFor: TimeInterval = 0, saving: Bool = false) -> Duration {
        if idle, idleFor >= restingAfter { return max(base, restingPoll) }
        guard idle || saving else { return base }
        return min(max(base, longestPoll), base * idleBackoff)
    }

    func pollDelay(_ base: Duration) -> Duration {
        Self.pollDelay(base, idle: idle, idleFor: Date().timeIntervalSince(lastActivity), saving: Self.saving)
    }

    /// The least time between two refreshes that BB's change signals ask for:
    /// `inUse` while in use (the caller's own pace), at least 30 s while idle,
    /// and `restingPoll` once untouched for `restingAfter`. A caller waiting
    /// on it looks again now and then, so a touch brings a held refresh back
    /// within seconds. In use it never waits longer, warm phone or not: what
    /// shows stays current.
    nonisolated static func changeGap(_ inUse: Duration, idle: Bool, idleFor: TimeInterval = 0) -> Duration {
        guard idle else { return inUse }
        if idleFor >= restingAfter { return max(inUse, restingPoll) }
        return max(inUse * idleBackoff, .seconds(30))
    }

    func changeGap(_ inUse: Duration) -> Duration {
        Self.changeGap(inUse, idle: idle, idleFor: Date().timeIntervalSince(lastActivity))
    }

    /// Low Power Mode or a warm phone (thermal state fair or worse): polls wait longer even in use.
    nonisolated static var saving: Bool {
        let info = ProcessInfo.processInfo
        return info.isLowPowerModeEnabled || info.thermalState.rawValue >= ProcessInfo.ThermalState.fair.rawValue
    }

    /// A poll loop's wait between rounds: `pollDelay(base)` (just `base` when it
    /// mustn't back off), then, while the app is in the background, until it comes back.
    func pollWait(_ base: Duration, backsOff: Bool = true) async {
        try? await Task.sleep(for: backsOff ? pollDelay(base) : base)
        while background, !Task.isCancelled {
            let token = UUID()
            await withTaskCancellationHandler {
                await withCheckedContinuation { continuation in
                    if !background || Task.isCancelled {
                        continuation.resume()
                    } else {
                        waitingForForeground[token] = continuation
                    }
                }
            } onCancel: {
                Task { @MainActor [weak self] in
                    self?.waitingForForeground.removeValue(forKey: token)?.resume()
                }
            }
        }
    }

    func setBackground(_ now: Bool) {
        background = now
        guard !now else { return }
        let waiting = waitingForForeground
        waitingForForeground = [:]
        waiting.values.forEach { $0.resume() }
    }

    /// A touch or keystroke: wake now, and look again when it would turn idle.
    func touched(at now: Date = Date()) {
        lastActivity = now
        if idle { idle = false }
        guard check == nil else { return }
        check = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let left = Self.idleAfter - Date().timeIntervalSince(self.lastActivity)
                if left <= 0 { break }
                try? await Task.sleep(for: .seconds(left + 0.05))
            }
            guard let self, !Task.isCancelled else { return }
            self.check = nil
            #if DEBUG
            // `-qaEnergyAwake`: measure the app as if in use.
            if ProcessInfo.processInfo.arguments.contains("-qaEnergyAwake") { return }
            #endif
            if Self.isIdle(lastActivity: self.lastActivity, now: Date()) { self.idle = true }
        }
    }

    /// Sees every touch in `window` without taking part in its gestures.
    func watch(_ window: UIWindow) {
        guard watched.insert(ObjectIdentifier(window)).inserted else { return }
        window.addGestureRecognizer(TouchWatcher { [weak self] in self?.touched() })
        touched()
    }
}

/// A gesture recognizer that reports each touch down and then steps aside: it
/// never recognizes, cancels or delays anything.
private final class TouchWatcher: UIGestureRecognizer, UIGestureRecognizerDelegate {
    private let seen: @MainActor () -> Void

    init(_ seen: @escaping @MainActor () -> Void) {
        self.seen = seen
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        delegate = self
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        seen()
        state = .failed
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool { false }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRequireFailureOf other: UIGestureRecognizer) -> Bool { false }
}

/// Puts the energy gate on the window this view is in.
struct EnergyGateWatcher: UIViewRepresentable {
    func makeUIView(context: Context) -> WatcherView { WatcherView() }
    func updateUIView(_ view: WatcherView, context: Context) {}

    final class WatcherView: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            isUserInteractionEnabled = false
            if let window { EnergyGate.shared.watch(window) }
        }
    }
}
