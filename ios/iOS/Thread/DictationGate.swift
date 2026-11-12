import Combine
import SwiftUI
import UIKit

/// Whether dictation still has words on the way into a field. Send waits
/// until they land, so a message never goes out without its last sentence.
///
/// Three sources, tracked apart so one finishing can't release another: the
/// dictation sheet (the composer's mic), hold to talk, and the keyboard's own
/// dictation.
struct DictationState: Equatable {
    enum Phase: Equatable { case idle, listening, transcribing }
    enum Source: Hashable { case sheet, talk, keyboard }

    enum Event: Equatable {
        case listening(Source)
        case transcribing(Source)
        /// The words are in the field (a talk's are sent; the keyboard has left dictation).
        case inserted(Source)
        case failed(Source)
        case cancelled(Source)
        /// The keyboard holds a spot in the field for a result still on its way.
        case placeholderAdded, placeholderRemoved
        /// The field's text changed.
        case edited
    }

    private(set) var phases: [Source: Phase] = [:]
    private(set) var placeholders = 0

    mutating func handle(_ event: Event) {
        switch event {
        case .listening(let source):
            phases[source] = .listening
        case .transcribing(let source):
            // The keyboard says recording ended even when nothing was heard; only a dictation it began counts.
            if source == .keyboard, phases[.keyboard] != .listening { return }
            phases[source] = .transcribing
        case .inserted(let source):
            phases[source] = nil
        case .failed(let source), .cancelled(let source):
            phases[source] = nil
            if source == .keyboard { placeholders = 0 }
        case .placeholderAdded:
            placeholders += 1
        case .placeholderRemoved:
            placeholders = max(0, placeholders - 1)
        case .edited:
            // After the keyboard stopped recording, the next change is its result.
            if phases[.keyboard] == .transcribing { phases[.keyboard] = nil }
        }
    }

    /// Listening wins over transcribing: someone is still talking.
    var phase: Phase {
        if phases.values.contains(.listening) { return .listening }
        if placeholders > 0 || phases.values.contains(.transcribing) { return .transcribing }
        return .idle
    }

    var blocksSend: Bool { phase != .idle }

    var label: String? {
        switch phase {
        case .idle: nil
        case .listening: "Listening…"
        case .transcribing: "Transcribing…"
        }
    }

    /// Hold to talk's state as an event. A talk sends its own words, so idle means done.
    static func talk(_ state: HoldToTalk.State) -> Event {
        switch state {
        case .idle: .inserted(.talk)
        case .recording, .cancelling, .handsFree, .dictating: .listening(.talk)
        case .sending: .transcribing(.talk)
        }
    }

    /// The dictation sheet's recorder as an event; nil where the sheet itself decides.
    static func sheet(_ phase: TalkRecorder.Phase) -> Event? {
        switch phase {
        case .recording: .listening(.sheet)
        case .finishing: .transcribing(.sheet)
        case .failed: .failed(.sheet)
        case .idle, .done: nil
        }
    }
}

/// One composer's `DictationState`, fed by its field, its mic and the keyboard.
@MainActor
final class DictationGate: ObservableObject {
    @Published private(set) var state = DictationState()
    private var keyboard: AnyCancellable?

    init(system: SystemDictation = .shared) {
        keyboard = system.$listening.removeDuplicates().sink { [weak self] listening in
            MainActor.assumeIsolated { self?.handle(listening ? .listening(.keyboard) : .inserted(.keyboard)) }
        }
        #if DEBUG
        // `-qaDictation listening|transcribing`: a composer caught mid-dictation, for screenshots.
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "-qaDictation"), arguments.indices.contains(index + 1) {
            handle(.listening(.sheet))
            if arguments[index + 1] == "transcribing" { handle(.transcribing(.sheet)) }
        }
        #endif
    }

    var blocksSend: Bool { state.blocksSend }

    func handle(_ event: DictationState.Event) {
        var next = state
        next.handle(event)
        if next != state { state = next }
    }
}

/// Whether the keyboard is dictating into whichever field has focus. UIKit
/// switches the input mode to "dictation" while the keyboard's mic is on, and
/// posts a notification each time the mode changes.
@MainActor
final class SystemDictation: ObservableObject {
    static let shared = SystemDictation()
    @Published private(set) var listening = false
    private var observers: [NSObjectProtocol] = []

    private init() {
        let names = [
            UITextInputMode.currentInputModeDidChangeNotification,
            UITextView.textDidBeginEditingNotification, UITextView.textDidEndEditingNotification,
            UITextField.textDidBeginEditingNotification, UITextField.textDidEndEditingNotification,
        ]
        observers = names.map { name in
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.refresh() }
            }
        }
        refresh()
    }

    private func refresh() {
        let now = FirstResponder.current?.textInputMode?.primaryLanguage == "dictation"
        if now != listening { listening = now }
    }
}

@MainActor
private enum FirstResponder {
    static weak var found: UIResponder?

    static var current: UIResponder? {
        found = nil
        UIApplication.shared.sendAction(#selector(UIResponder.bbReportFirstResponder), to: nil, from: nil, for: nil)
        return found
    }
}

extension UIResponder {
    @objc fileprivate func bbReportFirstResponder() {
        MainActor.assumeIsolated { FirstResponder.found = self }
    }
}

/// Disables a send button while the keyboard dictates, for fields that are
/// plain SwiftUI text fields. A disabled button's ⌘↩ shortcut is off too.
struct BlockedWhileDictating: ViewModifier {
    @ObservedObject private var system = SystemDictation.shared

    func body(content: Content) -> some View {
        content.disabled(system.listening)
    }
}

extension View {
    func blockedWhileDictating() -> some View { modifier(BlockedWhileDictating()) }
}

/// "Listening…" or "Transcribing…" beside a send button that's waiting for dictation.
struct DictationSendStatus: View {
    @ObservedObject var gate: DictationGate

    var body: some View {
        if let label = gate.state.label {
            // The red mic already says it's listening; a spinner shows the words landing. VoiceOver reads the label.
            HStack(spacing: 4) {
                if gate.state.phase == .transcribing { ProgressView().controlSize(.mini) }
            }
            .accessibilityLabel(label)
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize()
            .transition(.opacity)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("dictationSendStatus")
        }
    }
}
