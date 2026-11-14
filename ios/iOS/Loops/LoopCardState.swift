import Foundation

/// What a `::loop{id}` card shows and which buttons it offers, apart from the
/// view: the loop's phase, the action in flight, and the one it can undo.
struct LoopCardState: Equatable {
    enum Phase: Equatable {
        case loading
        /// Studio's Attention Router setting is off: a quiet placeholder.
        case off
        case missing(String)
        case open
        /// Owned by the Chief of Staff or a lead: who's on it and Take back.
        case handedOff
        /// Done, dropped, read or decided: one line.
        case closed
        /// Snoozed or waiting for its trigger: one line saying until when.
        case waiting
    }

    var enabled: Bool?
    var loop: LoopItem?
    /// The option a closed decision took, from its history.
    var chosen: String?
    var failure: String?
    /// The action waiting on Studio; its button spins and the others wait.
    var pending: LoopAction?
    /// An action that failed, said under the buttons.
    var error: String?

    var phase: Phase {
        if enabled == false { return .off }
        if let failure, loop == nil { return .missing(failure) }
        guard let loop, enabled == true else { return .loading }
        if loop.isClosed { return .closed }
        if !loop.isYours { return .handedOff }
        if loop.status == .snoozed || loop.status == .queued { return .waiting }
        return .open
    }

    /// Starts an action. False when another is already on its way.
    mutating func begin(_ action: LoopAction) -> Bool {
        guard pending == nil else { return false }
        pending = action
        error = nil
        return true
    }

    /// Studio's answer: the loop as it is now.
    mutating func finish(_ action: LoopAction, loop: LoopItem?) {
        pending = nil
        if let loop { self.loop = loop }
        if case .choose(let option) = action { chosen = option }
        if action == .undo { chosen = nil }
    }

    mutating func fail(_ message: String) {
        pending = nil
        error = message
    }

    /// The buttons shown on the card, and the rest behind ⋯. On the phone a
    /// do card shows Done and Snooze; Hand off and Drop go behind ⋯. Wide
    /// layouts show all four.
    func buttons(wide: Bool) -> (shown: [Button], more: [Button]) {
        guard let loop, phase == .open else { return ([], []) }
        let stale = loop.updatedAt < Date().addingTimeInterval(-3 * 86_400)
        var shown: [Button]
        var more: [Button]
        switch loop.kind {
        case .do:
            shown = [.done, .snooze]
            more = [.handOff, .drop]
        case .decide:
            shown = loop.options.count > Self.inlineOptions ? [.chooseSheet, .snooze] : loop.options.map(Button.option) + [.snooze]
            more = [.handOff, .drop]
        case .read:
            shown = [.gotIt]
            more = [.snooze, .drop]
        case .waiting:
            shown = [.nudge, .drop]
            more = [.snooze, .done]
        }
        if stale { more.insert(.keep, at: 0) }
        if wide, loop.kind == .do {
            shown += more.filter { $0 != .keep }
            more = more.filter { $0 == .keep }
        }
        return (shown, more)
    }

    /// At most this many options sit on the card; more open "Choose…".
    static let inlineOptions = 3

    enum Button: Hashable {
        case done, gotIt, drop, keep, nudge, snooze, handOff, chooseSheet
        case option(String)

        var label: String {
            switch self {
            case .done: "Done"
            case .gotIt: "Got it"
            case .drop: "Drop"
            case .keep: "Keep"
            case .nudge: "Nudge them"
            case .snooze: "Snooze"
            case .handOff: "Hand off"
            case .chooseSheet: "Choose…"
            case .option(let option): LoopOption(option).title
            }
        }
    }

    /// The closed card's line: "Done", "Got it", "Dropped" or the option taken.
    var closedLabel: String {
        guard let loop else { return "" }
        if loop.kind == .decide, let chosen { return LoopOption(chosen).title }
        if loop.status == .dropped { return "Dropped" }
        return loop.kind == .read ? "Got it" : "Done"
    }

    /// You closed it here, so it can come back.
    var canUndo: Bool { phase == .closed && LoopItem.isYou(loop?.closedBy) }
}
