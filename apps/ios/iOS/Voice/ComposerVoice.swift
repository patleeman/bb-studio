import Combine
import SwiftUI
import UIKit

/// The composer's one mic and one indicator, as on desktop: at most one timer
/// and one level meter at a time, always in the same spot over the composer.
/// Your voice is a red dot and red bars; the Bot's is a blue speaker and blue
/// bars, shown only while it speaks. Input and output never show together.
///
/// Voice mode owns the mic: the dictation mic is hidden and push to talk takes
/// its place. Hold it to talk and let go to send; a quiet long press (held
/// without speaking) switches to hands-free, which listens all the time, sends
/// each turn after a pause, and stops the Bot when you talk over it. Tap the
/// red listening pill to go back to push to talk.
///
/// A pure state machine: events in, effects out. `ComposerVoice` runs it
/// against the thread's `HoldToTalk`, `ThreadVoice` and `VoicePlayer`.
struct VoiceComposer {
    enum Mode: Equatable { case pushToTalk, handsFree }
    /// What the mic is doing.
    enum Input: Equatable { case idle, dictating, holding, handsFree, sending }
    /// The one thing in the indicator's spot.
    enum Indicator: Equatable { case none, input, output, hint }

    enum Event: Equatable {
        case voiceMode(Bool)
        /// Push to talk's hold began (after its short delay) or ended.
        case pressBegan, pressEnded
        /// A short tap on push to talk: shows the hint again.
        case pushToTalkTapped
        /// VoiceOver's "Hands-free" action on push to talk, in place of the quiet long press.
        case handsFreeToggled
        case pillTapped
        /// The thread's reply is playing (or reading aloud), or stopped.
        case botSpeaking(Bool)
        /// The voice clock, ten times a second, with the mic's level 0...1.
        case tick(level: Float)
        /// `HoldToTalk` changed state, whoever started it.
        case talk(HoldToTalk.State)
        case hintExpired
    }

    enum Effect: Equatable {
        case startDictation, finishDictation
        case startTalk(handsFree: Bool)
        /// Send what was said (let go of a hold, or a hands-free turn's pause).
        case sendTalk
        /// Stop without sending and delete what was recorded.
        case cancelTalk
        /// The hold becomes hands-free: letting go no longer sends.
        case goHandsFree
        case stopPlayback
        /// Persist that the first-use hint was shown.
        case rememberHint
    }

    // Levels from `LevelTracker`, 0...1, at ten ticks a second. Quiet rooms read about 0.1–0.2, speech 0.3–0.7.
    static let speechLevel: Float = 0.35
    /// Higher while the Bot speaks, so what's left of its echo isn't taken for you.
    static let bargeInLevel: Float = 0.45
    static let speechTicks = 2
    static let bargeInTicks = 3
    /// A hold this long with nothing said is a long press: hands-free.
    static let longPressTicks = 10
    /// Hands-free sends a turn after this much quiet once you've spoken.
    static let endOfTurnTicks = 15

    private(set) var voiceOn = false
    private(set) var mode = Mode.pushToTalk
    private(set) var input = Input.idle
    private(set) var botSpeaking = false
    private(set) var hintShown: Bool
    private(set) var hintVisible = false
    /// Hands-free: you've spoken in this turn (so it's sent, and a reply waits).
    private(set) var heardSpeech = false
    private var heldTicks = 0
    private var loudTicks = 0
    private var quietTicks = 0
    /// Set when this machine ended a hands-free turn, so it listens again; any other end leaves hands-free.
    private var rearm = false

    init(hintShown: Bool = false) {
        self.hintShown = hintShown
    }

    var indicator: Indicator {
        switch input {
        case .dictating, .holding, .sending: return .input
        case .idle, .handsFree: break
        }
        if botSpeaking { return .output }
        if input == .handsFree { return .input }
        if hintVisible, voiceOn { return .hint }
        return .none
    }

    /// The field's placeholder, in place of a label beside the controls.
    var placeholder: String? {
        switch indicator {
        case .output: "Speaking…"
        case .input where input != .sending: "Listening…"
        default: nil
        }
    }

    /// Only dictation keeps a timer, where length matters; voice mode's turns are short.
    var showsTimer: Bool { !voiceOn }
    /// The dictation mic; voice mode hides it and push to talk takes its place.
    var showsMic: Bool { !voiceOn }
    var showsPushToTalk: Bool { voiceOn }

    /// A reply that arrives now waits rather than play over you.
    var blocksPlayback: Bool {
        switch input {
        case .dictating, .holding: true
        case .handsFree: heardSpeech
        case .idle, .sending: false
        }
    }

    mutating func handle(_ event: Event) -> [Effect] {
        switch event {
        case .voiceMode(let on):
            guard on != voiceOn else { return [] }
            voiceOn = on
            mode = .pushToTalk
            resetCounters()
            var effects: [Effect] = []
            if on {
                // Voice mode owns the mic: a dictation under way finishes into the draft first.
                if input == .dictating { effects.append(.finishDictation) }
                if !hintShown {
                    hintShown = true
                    hintVisible = true
                    effects.append(.rememberHint)
                }
            } else {
                hintVisible = false
                if input == .holding || input == .handsFree { effects.append(.cancelTalk) }
            }
            return effects

        case .pressBegan:
            guard voiceOn, input == .idle else { return [] }
            input = .holding
            hintVisible = false
            resetCounters()
            // Pressing while the Bot speaks interrupts it.
            return (botSpeaking ? [.stopPlayback] : []) + [.startTalk(handsFree: false)]

        case .pressEnded:
            // After a quiet long press it's hands-free: letting go doesn't send.
            guard input == .holding else { return [] }
            input = .sending
            return [.sendTalk]

        case .pushToTalkTapped:
            guard voiceOn, input == .idle else { return [] }
            hintVisible = true
            return []

        case .handsFreeToggled:
            guard voiceOn else { return [] }
            if mode == .handsFree { return handle(.pillTapped) }
            guard input == .idle else { return [] }
            mode = .handsFree
            input = .handsFree
            hintVisible = false
            resetCounters()
            return [.startTalk(handsFree: true)]

        case .pillTapped:
            guard voiceOn, mode == .handsFree else { return [] }
            mode = .pushToTalk
            guard input == .handsFree else { return [] }
            input = .sending
            let said = heardSpeech
            resetCounters()
            return [said ? .sendTalk : .cancelTalk]

        case .botSpeaking(let speaking):
            guard speaking != botSpeaking else { return [] }
            botSpeaking = speaking
            loudTicks = 0
            // The reply played out with nobody talking over it: drop what the mic took in
            // during it (its echo) and listen afresh.
            if !speaking, voiceOn, input == .handsFree, mode == .handsFree, !heardSpeech {
                rearm = true
                input = .sending
                return [.cancelTalk]
            }
            return []

        case .tick(let level):
            return tick(level)

        case .talk(let state):
            return follow(state)

        case .hintExpired:
            hintVisible = false
            return []
        }
    }

    private mutating func tick(_ level: Float) -> [Effect] {
        switch input {
        case .holding:
            heldTicks += 1
            loudTicks = level >= Self.speechLevel ? loudTicks + 1 : 0
            if loudTicks >= Self.speechTicks { heardSpeech = true }
            if voiceOn, !heardSpeech, heldTicks >= Self.longPressTicks {
                mode = .handsFree
                input = .handsFree
                resetCounters()
                return [.goHandsFree]
            }
            return []
        case .handsFree:
            if botSpeaking {
                // Barge-in: talking over the Bot stops it, and this turn is yours.
                loudTicks = level >= Self.bargeInLevel ? loudTicks + 1 : 0
                guard loudTicks >= Self.bargeInTicks else { return [] }
                loudTicks = 0
                quietTicks = 0
                heardSpeech = true
                return [.stopPlayback]
            }
            if level >= Self.speechLevel {
                loudTicks += 1
                quietTicks = 0
                if loudTicks >= Self.speechTicks { heardSpeech = true }
                return []
            }
            loudTicks = 0
            guard heardSpeech else { return [] }
            quietTicks += 1
            guard quietTicks >= Self.endOfTurnTicks else { return [] }
            resetCounters()
            rearm = true
            input = .sending
            return [.sendTalk]
        case .idle, .dictating, .sending:
            return []
        }
    }

    private mutating func follow(_ state: HoldToTalk.State) -> [Effect] {
        let was = input
        switch state {
        case .idle:
            input = .idle
            resetCounters()
            let again = rearm
            rearm = false
            guard mode == .handsFree else { return [] }
            // Hands-free listens again after each turn; ended any other way (an error, a call, leaving), it stops.
            guard again, voiceOn else {
                mode = .pushToTalk
                return []
            }
            input = .handsFree
            return [.startTalk(handsFree: true)]
        case .dictating:
            input = .dictating
        case .recording, .cancelling:
            if input != .handsFree { input = .holding }
        case .handsFree:
            input = .handsFree
            if voiceOn { mode = .handsFree }
        case .sending:
            input = .sending
        }
        // Starting to talk or dictate cuts the reply off.
        if was == .idle, input == .dictating || input == .holding, botSpeaking { return [.stopPlayback] }
        return []
    }

    private mutating func resetCounters() {
        heldTicks = 0
        loudTicks = 0
        quietTicks = 0
        heardSpeech = false
    }

    /// What the composer draws from this state; published only when it changes.
    struct Shown: Equatable {
        var indicator = Indicator.none
        var placeholder: String?
        var showsTimer = true
        var mode = Mode.pushToTalk
        var input = Input.idle
        var voiceOn = false
    }

    var shown: Shown {
        Shown(indicator: indicator, placeholder: placeholder, showsTimer: showsTimer, mode: mode, input: input, voiceOn: voiceOn)
    }

    #if DEBUG
    /// `-qaVoice hint`: the first-use hint, whatever was saved.
    mutating func qaShowHint() {
        hintVisible = true
    }
    #endif
}

/// Runs `VoiceComposer` for one thread's composer.
@MainActor
final class ComposerVoice: ObservableObject {
    @Published private(set) var shown = VoiceComposer.Shown()
    private(set) var machine: VoiceComposer
    private weak var talk: HoldToTalk?
    private var threadId: String?
    private let player: VoicePlayer
    private let defaults: UserDefaults
    private var observers: Set<AnyCancellable> = []
    private var clock: UUID?
    private var hintTimer: Task<Void, Never>?
    #if DEBUG
    private var frozen = false
    #endif

    static let hintKey = "composer.pushToTalkHintShown"
    static let hintText = "Hold to talk · long-press for hands-free"

    init(player: VoicePlayer = .shared, defaults: UserDefaults = .standard) {
        self.player = player
        self.defaults = defaults
        machine = VoiceComposer(hintShown: defaults.bool(forKey: Self.hintKey))
    }

    var blocksPlayback: Bool { machine.blocksPlayback }

    func attach(talk: HoldToTalk, voice: ThreadVoice) {
        guard self.talk !== talk else { return }
        self.talk = talk
        threadId = voice.threadId
        observers = []
        // A turn later: these publish before the value is stored, and effects act on it.
        voice.$on.removeDuplicates().receive(on: DispatchQueue.main)
            .sink { [weak self] on in self?.send(.voiceMode(on)) }.store(in: &observers)
        talk.$state.removeDuplicates().receive(on: DispatchQueue.main)
            .sink { [weak self] state in self?.send(.talk(state)) }.store(in: &observers)
        player.$phase.combineLatest(player.$threadId).receive(on: DispatchQueue.main)
            .map { [threadId = voice.threadId] phase, playing in phase != .idle && playing == threadId }
            .removeDuplicates()
            .sink { [weak self] speaking in self?.send(.botSpeaking(speaking)) }.store(in: &observers)
    }

    func send(_ event: VoiceComposer.Event) {
        #if DEBUG
        if frozen, event != .hintExpired { return }
        #endif
        let effects = machine.handle(event)
        let next = machine.shown
        if next != shown { shown = next }
        effects.forEach(perform)
        followClock()
    }

    private func perform(_ effect: VoiceComposer.Effect) {
        if effect == .rememberHint {
            defaults.set(true, forKey: Self.hintKey)
            return expireHint()
        }
        guard let talk else { return }
        switch effect {
        case .startDictation: talk.startDictation()
        case .finishDictation: talk.end()
        case .startTalk(let handsFree): talk.press(handsFree: handsFree)
        case .sendTalk: talk.release()
        case .cancelTalk: talk.cancel()
        case .goHandsFree: talk.goHandsFree()
        case .stopPlayback: if player.threadId == threadId { player.stop() }
        case .rememberHint: break
        }
    }

    /// The hint is brief: one timer, not an animation.
    func expireHint(after delay: Duration = .seconds(5)) {
        hintTimer?.cancel()
        hintTimer = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.send(.hintExpired)
        }
    }

    /// Voice mode reads the mic's level on the shared clock, only while it listens.
    private func followClock() {
        let listening = machine.voiceOn && (machine.input == .holding || machine.input == .handsFree)
        if listening, clock == nil {
            clock = VoiceClock.shared.subscribe { [weak self] in
                guard let self, let talk = self.talk else { return }
                self.send(.tick(level: talk.level))
            }
        } else if !listening, let clock {
            VoiceClock.shared.unsubscribe(clock)
            self.clock = nil
        }
    }

    func pushToTalkTapped() {
        send(.pushToTalkTapped)
        if shown.indicator == .hint { expireHint(after: .seconds(3)) }
    }

    #if DEBUG
    /// `-qaVoice idle|dictating|ptt|handsfree|speaking|hint` (with `-qaBotDemo chat`):
    /// the composer caught in each state, with no server or mic, for screenshots.
    static var qaVariant: String? {
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "-qaVoice"), arguments.indices.contains(index + 1) { return arguments[index + 1] }
        if let index = arguments.firstIndex(of: "-qaDictation"), arguments.indices.contains(index + 1),
           arguments[index + 1] == "listening" { return "dictating" }
        return nil
    }

    func qaApply(_ variant: String, talk: HoldToTalk, voice: ThreadVoice) {
        let on = ["ptt", "handsfree", "speaking", "hint"].contains(variant)
        voice.qaPretend(on: on)
        machine = VoiceComposer(hintShown: true)
        _ = machine.handle(.voiceMode(on))
        switch variant {
        case "dictating":
            talk.qaPretend(.dictating, voice: false)
            _ = machine.handle(.talk(.dictating))
        case "ptt":
            talk.qaPretend(.recording, voice: true, seconds: 3)
            _ = machine.handle(.pressBegan)
        case "handsfree":
            talk.qaPretend(.handsFree, voice: true, seconds: 3)
            _ = machine.handle(.handsFreeToggled)
        case "speaking":
            player.qaPretendSpeaking(threadId: voice.threadId)
            _ = machine.handle(.botSpeaking(true))
        case "hint":
            machine.qaShowHint()
        default:
            break
        }
        shown = machine.shown
        frozen = true
    }
    #endif
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

/// The one indicator over the composer: your voice (the recorder or
/// listening pill), the Bot's (speaking, with Stop), or the first-use hint.
struct VoiceIndicator: View {
    @ObservedObject var composer: ComposerVoice
    @ObservedObject var talk: HoldToTalk
    @ObservedObject var voice: ThreadVoice
    @ObservedObject var player: VoicePlayer

    var body: some View {
        Group {
            switch composer.shown.indicator {
            case .input:
                TalkStatusBar(talk: talk, showsTimer: composer.shown.showsTimer,
                              exitHandsFree: composer.shown.voiceOn && composer.shown.mode == .handsFree ? { composer.send(.pillTapped) } : nil)
            case .output:
                VoiceStatusBar(voice: voice, player: player)
            case .hint:
                Text(ComposerVoice.hintText)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 32)
                    .background(.fill.tertiary, in: .capsule)
                    .frame(maxWidth: .infinity)
                    .transition(.opacity)
                    .accessibilityIdentifier("voiceHint")
            case .none:
                EmptyView()
            }
        }
        .animation(.snappy, value: composer.shown.indicator)
    }
}

/// Voice mode's mic, in the dictation mic's place: hold to talk, let go to
/// send, slide left to cancel. Held without speaking it switches to
/// hands-free; tap it (or the red pill) to come back.
struct PushToTalkButton: View {
    @ObservedObject var composer: ComposerVoice
    @ObservedObject var talk: HoldToTalk
    @GestureState private var holding = false
    @State private var heldUntil: Date?

    private var handsFree: Bool { composer.shown.mode == .handsFree }
    private var held: Bool { composer.shown.input == .holding }

    var body: some View {
        Image(systemName: "waveform")
            .font(.body.weight(.semibold))
            .foregroundStyle(held ? Color.white : handsFree ? Color.red : Color.accentColor)
            .frame(width: 36, height: 36)
            .background(held ? (talk.state == .cancelling ? Color.gray : Color.red)
                        : handsFree ? Color.red.opacity(0.15) : Color.accentColor.opacity(0.15), in: .circle)
            .scaleEffect(held ? 1.15 : 1)
            .animation(.snappy, value: composer.shown.input)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
            .onTapGesture {
                if let heldUntil, Date.now.timeIntervalSince(heldUntil) < 0.5 { return }
                if handsFree { composer.send(.pillTapped) } else { composer.pushToTalkTapped() }
            }
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.2)
                    .sequenced(before: DragGesture(minimumDistance: 0))
                    .updating($holding) { value, holding, _ in
                        if case .second(true, _) = value { holding = true }
                    }
                    .onChanged { value in
                        guard case .second(true, let drag) = value else { return }
                        if composer.shown.input == .idle, !handsFree { composer.send(.pressBegan) }
                        if let drag { talk.drag(drag.translation) }
                    }
                    .onEnded { _ in
                        if talk.state == .cancelling { talk.cancel() } else { composer.send(.pressEnded) }
                    }
            )
            .onChange(of: holding) { _, holding in
                if !holding { heldUntil = .now; talk.holdLost() }
            }
            .sensoryFeedback(.impact(weight: .medium), trigger: handsFree)
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("composerPushToTalk")
            .accessibilityLabel(handsFree ? "Hands-free, listening" : "Push to talk")
            .accessibilityHint(handsFree ? "Tap to go back to push to talk."
                               : "Hold to talk, let go to send. Hold without speaking for hands-free.")
            .accessibilityAction(named: handsFree ? "Push to talk" : "Hands-free") { composer.send(.handsFreeToggled) }
    }
}
