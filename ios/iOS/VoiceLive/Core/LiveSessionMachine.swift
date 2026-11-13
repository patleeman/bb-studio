import Foundation

/// Who is talking.
enum LiveSpeaker: String, Sendable {
    case user, agent
}

/// The words under the talking icon: the current (or last) line, as it streams.
struct LiveSubtitle: Equatable, Sendable {
    var speaker: LiveSpeaker
    var text: String
}

/// A tool's result, shown small under the subtitles; the voice says it too.
struct LiveToolCard: Equatable, Sendable {
    enum Kind: String, Sendable { case waiting, sent, loop, reply, notice }
    var kind: Kind
    var title: String
    var detail: String
}

enum LivePhase: Equatable, Sendable {
    case idle
    case connecting
    case listening
    case userSpeaking
    case thinking
    case agentSpeaking
    /// A phone call or Siri took the audio; it resumes by itself.
    case paused(String)
    case ended(String?)
    case failed(String)
}

/// What Studio is told (voiceLive.event / .tool / .end), in its contract's shape.
enum LiveReport: Equatable, Sendable {
    /// A user line also says when its speech started, and the destructive action whose question it came after (answers).
    case transcript(role: LiveSpeaker, text: String, atMs: Int, startedMs: Int? = nil, answers: String? = nil)
    case interrupted(heard: String, atMs: Int)
    case liveUsage(seconds: Double)
    case backendUsage(input: Int, cached: Int, output: Int)
    case realtimeUsage(json: String)
    case transcriptionUsage(json: String)
    /// The level gate muted the voice and no words followed: what it heard, and how long the voice was silent.
    case falseTrigger(atMs: Int, mic: Float, playback: Float, mutedMs: Int)
    /// The audio route changed: why, and the new input and output.
    case routeChange(reason: String, input: String, output: String, atMs: Int)
    /// A call or Siri took the audio (began), or gave it back.
    case audioInterruption(began: Bool, atMs: Int)
    /// The app went to the background or came back.
    case appState(background: Bool, atMs: Int)
    /// Why the session ended; `background` when the app wasn't on screen then.
    case close(LiveCloseReason, detail: String?, background: Bool, atMs: Int)

    var object: [String: Any] {
        func parsed(_ json: String) -> Any { (try? JSONSerialization.jsonObject(with: Data(json.utf8))) ?? [String: Any]() }
        switch self {
        case .transcript(let role, let text, let at, let started, let answers):
            var object: [String: Any] = ["type": "transcript", "role": role == .user ? "user" : "assistant", "text": text, "at": at]
            if let started { object["started_at"] = started }
            if let answers { object["answers"] = answers }
            return object
        case .interrupted(let heard, let at): return ["type": "interrupted", "heard": heard, "at": at]
        case .liveUsage(let seconds): return ["type": "live_usage", "seconds": seconds]
        case .backendUsage(let input, let cached, let output): return ["type": "backend_usage", "input_tokens": input, "cached_tokens": cached, "output_tokens": output]
        case .realtimeUsage(let json): return ["type": "usage", "usage": parsed(json)]
        case .transcriptionUsage(let json): return ["type": "transcription_usage", "usage": parsed(json)]
        case .falseTrigger(let at, let mic, let playback, let mutedMs):
            return ["type": "false_trigger", "at": at, "mic": Self.level(mic), "playback": Self.level(playback), "muted_ms": mutedMs]
        case .routeChange(let reason, let input, let output, let at):
            return ["type": "route_change", "reason": reason, "input": String(input.prefix(200)), "output": String(output.prefix(200)), "at": at]
        case .audioInterruption(let began, let at): return ["type": "audio_interruption", "began": began, "at": at]
        case .appState(let background, let at): return ["type": "app_state", "state": background ? "background" : "foreground", "at": at]
        case .close(let reason, let detail, let background, let at):
            var object: [String: Any] = ["type": "close", "reason": reason.rawValue, "background": background, "at": at]
            if let detail, !detail.isEmpty { object["detail"] = String(detail.prefix(500)) }
            return object
        }
    }

    /// A level to three places (Float's 0.0799999982 reads 0.08).
    private static func level(_ value: Float) -> Double { (Double(min(1, max(0, value))) * 1000).rounded() / 1000 }
}

/// Why a session ended, as Studio logs it.
enum LiveCloseReason: String, Sendable {
    /// End, or the header's close button.
    case user
    /// The screen went away while live.
    case dismissed
    /// Connecting failed.
    case error
    /// The connection dropped (ICE failed, the data channel closed).
    case transport
    /// Studio's monthly cap.
    case cap
    /// The voice service ended it (session.closed).
    case server
}

enum LiveEarcon: String, Sendable {
    case start, heard, working, sent, error, end
}

/// What the machine asks the controller to do.
enum LiveEffect: Equatable, Sendable {
    case connect
    case send(LiveOutgoing)
    /// Barge-in: silence the voice's audio at once, before the model catches up.
    case muteAgentAudio(Bool)
    case muteMic(Bool)
    /// Relay a tool call to Studio, with the lines heard so far (a yes must reach Studio first).
    case runTool(callId: String, name: String, arguments: String, reports: [LiveReport])
    case hangUp([LiveReport])
    case earcon(LiveEarcon)
    case reconfigureAudio
}

/// A hands-free session's state: who's talking, the subtitles, the read-back
/// waiting for a yes, and barge-in. Pure: time comes in as seconds since the
/// epoch, and every side effect goes out as a `LiveEffect`.
struct LiveSessionMachine: Sendable {
    private(set) var phase: LivePhase = .idle
    private(set) var subtitle: LiveSubtitle?
    /// "Drop the loop '…'? Say yes to drop." while a destructive action waits for a yes.
    private(set) var confirmation: String?
    private(set) var card: LiveToolCard?
    private(set) var agentMuted = false
    private(set) var interruptions = 0
    /// Level triggers the transcript didn't confirm: the voice was unmuted and carried on.
    private(set) var falseTriggers = 0
    /// When the level gate muted the voice, until words confirm it or the window passes.
    private(set) var provisionalSince: TimeInterval?
    /// The loudest mic frame and the playback level when the gate fired, for the false-trigger log and the "still loud" bar.
    private var triggerMic: Float = 0
    private var triggerPlayback: Float = 0
    /// The app is in the background (a close then says so).
    private var background = false
    var gate = BargeInGate()
    /// Words must arrive this soon after the user's level drops back, or the voice comes back.
    /// It counts from the end of the loud part, not the trigger. 0.4 s (was 1 s, Nov 4): a false
    /// mute on the speaker cost a second of the voice each time. Words that come later (GPT-Live's
    /// transcript lags ~2.4 s while the voice talks) still barge in on their own (userHeard).
    var confirmWindow: TimeInterval = 0.4
    /// The last mic frame above the gate's bar during a provisional mute.
    private var loudUntil: TimeInterval = 0
    /// The last mic frame that sounded like the user (above the gate's bar), for ending lines.
    private var lastLoudAt: TimeInterval = 0

    /// GPT-Live and the mock have no end-of-line events: a pause ends a line.
    var endsLinesOnPause: Bool
    var userPause: TimeInterval = 0.9
    /// GPT-Live pauses up to ~0.7 s between phrases of one reply (live run, Nov 1): a line stays open that long.
    var agentPause: TimeInterval = 0.9

    private var userText = ""
    private var agentText = ""
    private var lastUserAt: TimeInterval = 0
    /// When the voice's audio for what it said so far should end (Live's end_ms), or its last words.
    private var agentUntil: TimeInterval = 0
    private var sessionStart: TimeInterval = 0
    private var reports: [LiveReport] = []
    /// What the voice said lately, to tell its echo from the user (echo guard).
    private var recentAgent = ""
    /// After a barge-in, the old reply's tail is ignored until the user's line ends.
    private var awaitingTurn = false
    /// The voice's last finished line: what was heard when the user cuts in while its audio still plays.
    private var lastAgentLine = ""
    /// After an "answer" relay: the one "still waiting" note Studio wrote, and when it's due.
    private var stillWaiting: (note: String, due: TimeInterval)?
    /// When the user's next line started: the first sign of it (the mic, Realtime's speech start, its
    /// first words) since their last line ended. Transcripts come late, so a line's words can arrive
    /// after the question it can't be answering.
    private var lineStart: TimeInterval?
    private var lineEnded: TimeInterval = 0
    /// The destructive action whose question went back to the model, and when: a line that starts after it can be the yes.
    private var question: (actionId: String, at: TimeInterval)?

    /// Whether a "still waiting" note is due later.
    var waitingOnReply: Bool { stillWaiting != nil }

    init(endsLinesOnPause: Bool) {
        self.endsLinesOnPause = endsLinesOnPause
    }

    var isLive: Bool {
        switch phase {
        case .idle, .ended, .failed: false
        default: true
        }
    }

    /// Who the talking icon animates for.
    var speaking: LiveSpeaker? {
        switch phase {
        case .userSpeaking: .user
        case .agentSpeaking: .agent
        default: nil
        }
    }

    // MARK: Start and stop

    mutating func start(now: TimeInterval) -> [LiveEffect] {
        guard !isLive else { return [] }
        // A new session starts clean, but keeps how it was tuned (B20): the
        // barge-in gate, its confirm window and the line pauses.
        let (background, gate, confirmWindow, userPause, agentPause) = (background, gate, confirmWindow, userPause, agentPause)
        self = LiveSessionMachine(endsLinesOnPause: endsLinesOnPause)
        self.background = background
        self.gate = gate
        self.gate.reset()
        self.confirmWindow = confirmWindow
        self.userPause = userPause
        self.agentPause = agentPause
        phase = .connecting
        sessionStart = now
        return [.earcon(.start), .connect]
    }

    mutating func stop(now: TimeInterval, reason: LiveCloseReason = .user, detail: String? = nil) -> [LiveEffect] {
        guard isLive else { return [] }
        finishUser(now: now)
        finishAgent(now: now)
        closed(reason, detail: detail, now: now)
        phase = .ended(nil)
        confirmation = nil
        stillWaiting = nil
        return [.send(.close), .hangUp(drain()), .earcon(.end)]
    }

    mutating func fail(_ message: String, now: TimeInterval, reason: LiveCloseReason = .error) -> [LiveEffect] {
        let wasLive = isLive
        finishUser(now: now)
        finishAgent(now: now)
        if wasLive { closed(reason, detail: message, now: now) }
        phase = .failed(message)
        confirmation = nil
        stillWaiting = nil
        return (wasLive ? [.hangUp(drain())] : []) + [.earcon(.error)]
    }

    // MARK: The model's events

    mutating func handle(_ signal: LiveSignal, now: TimeInterval) -> [LiveEffect] {
        guard isLive else {
            // session.close's answer brings the final usage after the hang-up: still Studio's to count.
            switch phase {
            case .ended, .failed: usage(signal)
            default: break
            }
            return []
        }
        switch signal {
        case .started:
            if phase == .connecting { phase = .listening }
            sessionStart = now
            return []
        case .userSpeechStarted:
            if case .paused = phase { return [] }
            let effects = phase == .agentSpeaking ? bargeIn(now: now) : []
            phase = .userSpeaking
            lastUserAt = now
            heardStart(now)
            subtitle = LiveSubtitle(speaker: .user, text: userText)
            return effects
        case .userText(let delta):
            return userHeard(delta, now: now)
        case .userLine(let text):
            userText = text
            return finishUser(now: now)
        case .agentText(let delta):
            return agentSaid(delta, now: now)
        case .agentLineDone:
            // The words are done; the audio may still be playing, so the icon keeps going until it is.
            finishAgent(now: now, keepSpeaking: true)
            return []
        case .agentAudioStarted:
            agentUntil = max(agentUntil, now + agentPause)
            if phase == .listening || phase == .thinking { phase = .agentSpeaking }
            return []
        case .agentAudioStopped:
            finishAgent(now: now)
            return []
        case .toolCall(let callId, let name, let arguments):
            var effects = finishUser(now: now)
            finishAgent(now: now)
            phase = .thinking
            effects += [.earcon(.working), .runTool(callId: callId, name: name, arguments: arguments, reports: drain())]
            return effects
        case .liveUsage, .backendUsage, .realtimeUsage, .transcriptionUsage:
            usage(signal)
            return []
        case .closed(let reason):
            finishUser(now: now)
            finishAgent(now: now)
            closed(.server, detail: reason, now: now)
            phase = .ended(Self.closedReason(reason))
            confirmation = nil
            stillWaiting = nil
            return [.hangUp(drain()), .earcon(.end)]
        case .error(let message):
            card = LiveToolCard(kind: .notice, title: "Voice service", detail: message)
            return [.earcon(.error)]
        }
    }

    private mutating func usage(_ signal: LiveSignal) {
        switch signal {
        case .liveUsage(let seconds):
            reports.removeAll { if case .liveUsage = $0 { return true } else { return false } }
            reports.append(.liveUsage(seconds: seconds))
        case .backendUsage(let input, let cached, let output): reports.append(.backendUsage(input: input, cached: cached, output: output))
        case .realtimeUsage(let json): reports.append(.realtimeUsage(json: json))
        case .transcriptionUsage(let json): reports.append(.transcriptionUsage(json: json))
        default: break
        }
    }

    /// A sign the user's next line has started (see lineStart).
    private mutating func heardStart(_ at: TimeInterval) {
        if at > lineEnded { lineStart = min(lineStart ?? at, at) }
    }

    /// Mic frames (linear RMS, oldest first, with their times) and the voice's playback level.
    /// While the voice talks, the user's voice above its echo mutes it at once (BargeInGate);
    /// the transcript then confirms (userHeard) or the window cancels it (tick).
    mutating func micLevels(_ frames: [(level: Float, at: TimeInterval)], playback: Float) -> [LiveEffect] {
        // While the user is audibly talking, their line isn't over, however slowly the transcript comes.
        let playing = phase == .agentSpeaking && !agentMuted
        for frame in frames where frame.level > gate.threshold(playback: playback, voicePlaying: playing) {
            lastLoudAt = max(lastLoudAt, frame.at)
            heardStart(frame.at)
        }
        // While muted provisionally, keep track of whether the user is still talking: by the bar
        // that fired (the voice is silent now, so playback reads 0; the room's noise doesn't count).
        if let since = provisionalSince {
            let bar = gate.threshold(playback: triggerPlayback, voicePlaying: true)
            for frame in frames where frame.at >= since && frame.level > bar { loudUntil = max(loudUntil, frame.at) }
            return []
        }
        guard isLive, phase == .agentSpeaking, !agentMuted else {
            if phase != .agentSpeaking { gate.reset() }
            return []
        }
        for frame in frames where gate.feed(level: frame.level, playback: playback, voicePlaying: true, at: frame.at) {
            provisionalSince = frame.at
            loudUntil = frame.at
            triggerMic = frames.filter { $0.at <= frame.at }.map(\.level).max() ?? frame.level
            triggerPlayback = playback
            // The rest of this batch: still talking?
            let bar = gate.threshold(playback: playback, voicePlaying: true)
            for later in frames where later.at > frame.at && later.level > bar { loudUntil = max(loudUntil, later.at) }
            agentMuted = true
            gate.reset()
            return [.muteAgentAudio(true)]
        }
        return []
    }

    /// Ends lines on a pause (GPT-Live, the mock), and the voice's turn when its audio should be done.
    mutating func tick(now: TimeInterval) -> [LiveEffect] {
        guard isLive else { return [] }
        var effects: [LiveEffect] = []
        // A level trigger with no words after it: a false alarm (a cough, the car). Let the voice carry on.
        if let since = provisionalSince, now - max(since, loudUntil) > confirmWindow {
            provisionalSince = nil
            agentMuted = false
            falseTriggers += 1
            reports.append(.falseTrigger(atMs: Self.ms(since), mic: triggerMic, playback: triggerPlayback, mutedMs: Self.ms(now - since)))
            effects.append(.muteAgentAudio(false))
        }
        // GPT-Live's transcript of the user comes in bursts while the voice talks: a line ends on a pause in the words and in the mic.
        if endsLinesOnPause, phase == .userSpeaking, !userText.isEmpty, now - lastUserAt > userPause, now - lastLoudAt > userPause {
            effects += finishUser(now: now)
        }
        if phase == .agentSpeaking, provisionalSince == nil, now > agentUntil, endsLinesOnPause || agentText.isEmpty {
            finishAgent(now: now)
        }
        // No reply yet to an "answer" relay: the voice says so once, when neither it nor the user is talking.
        if let waiting = stillWaiting, now >= waiting.due, phase == .listening || phase == .thinking, provisionalSince == nil {
            effects.append(.send(.note(waiting.note, spoken: true)))
            stillWaiting = nil
        }
        return effects
    }

    /// Lines and usage not yet reported.
    mutating func drain() -> [LiveReport] {
        defer { reports = [] }
        return reports
    }

    /// Reports Studio didn't get (a failed sync, tool or end): back in front, in their order, for the next try.
    mutating func requeue(_ failed: [LiveReport]) {
        reports = failed + reports
    }

    // MARK: Studio's side

    /// A tool's output from Studio: shows its card, or the question a destructive action waits on, and returns it to the model.
    /// `now`: when it went back; without it no line can answer its question (demos).
    mutating func toolFinished(callId: String, name: String, output: String, now: TimeInterval = .infinity) -> [LiveEffect] {
        var effects: [LiveEffect] = [.send(.toolResult(callId: callId, output: output))]
        // Destructive (drop a loop, stop or archive a thread, pause or delete an automation): the only "Waiting for your yes".
        if let question = Self.confirmQuestion(in: output) {
            confirmation = question
            self.question = Self.confirmAction(in: output).map { ($0, now) }
            card = nil
            return effects
        }
        switch name {
        case "send_to_cos", "send_to_thread":
            // Relays go at once: a short "Sent to …" line under the subtitles.
            if output.hasPrefix("Sent to ") {
                let title = String(output.dropFirst("Sent to ".count).prefix { $0 != "." })
                card = LiveToolCard(kind: .sent, title: "Sent to \(title)", detail: "")
                effects.append(.earcon(.sent))
            } else {
                card = LiveToolCard(kind: .notice, title: "Which thread?", detail: Self.firstSentence(output))
            }
        case "confirm":
            // Studio didn't hear the yes: keep asking.
            if output.contains("hasn't heard") || output.contains("didn't hear a clear yes") { break }
            confirmation = nil
            question = nil
            let undone = output.contains("nothing was done") || output.contains("cancelled") || output.contains("timed out")
            card = LiveToolCard(kind: undone ? .notice : .loop, title: undone ? "Not done" : Self.firstSentence(output), detail: undone ? Self.firstSentence(output) : "")
            if !undone { effects.append(.earcon(.sent)) }
        case "cancel":
            confirmation = nil
            question = nil
            card = LiveToolCard(kind: .notice, title: "Not done", detail: "Cancelled")
        case "loops_list":
            card = Self.waitingCard(output)
        case "loops_act", "loops_add":
            let refused = output.hasPrefix("Voice can")
            card = LiveToolCard(kind: refused ? .notice : .loop, title: Self.firstSentence(output), detail: refused ? "" : "Say “undo” to undo")
        case "undo":
            card = LiveToolCard(kind: .loop, title: Self.firstSentence(output), detail: "")
        case "read_replies":
            card = LiveToolCard(kind: .reply, title: "Reply", detail: Self.stripData(output))
        case "stop_thread", "archive_thread", "pause_automation", "delete_automation":
            card = LiveToolCard(kind: .notice, title: "Which one?", detail: Self.firstSentence(output))
        default:
            card = LiveToolCard(kind: .notice, title: "Not by voice", detail: Self.firstSentence(output))
        }
        return effects
    }

    /// After an "answer" relay (voiceLive.tool's waitFor): if no reply comes within `ms`,
    /// tick adds Studio's note once so the voice says it's still waiting. A reply, the user's
    /// next line or the end of the session cancels it; a newer relay replaces it.
    mutating func waitForReply(note: String, ms: Int, now: TimeInterval) {
        guard isLive else { return }
        stillWaiting = (note, now + Double(ms) / 1000)
    }

    /// A relayed thread answered: the voice says it now.
    mutating func reply(title: String, summary: String, note: String) -> [LiveEffect] {
        guard isLive else { return [] }
        stillWaiting = nil
        card = LiveToolCard(kind: .reply, title: "\(title) answered", detail: summary)
        return [.earcon(.sent), .send(.note(note, spoken: true))]
    }

    /// A phone call (or Siri) took the audio, and gave it back. Never falls back to push to talk.
    mutating func interruption(began: Bool, now: TimeInterval) -> [LiveEffect] {
        guard isLive else { return [] }
        reports.append(.audioInterruption(began: began, atMs: Self.ms(now)))
        if began {
            finishUser(now: now)
            finishAgent(now: now)
            phase = .paused("Paused for a call")
            return [.muteMic(true), .muteAgentAudio(true)]
        }
        guard case .paused = phase else { return [] }
        phase = .listening
        agentMuted = false
        return [.reconfigureAudio, .muteMic(false), .muteAgentAudio(false)]
    }

    /// A route change (the car connects, AirPods out): logged, and when `reconfigure`,
    /// the session is set up again so the voice keeps talking on the new route.
    mutating func routeChanged(reason: String, input: String, output: String, reconfigure: Bool, now: TimeInterval) -> [LiveEffect] {
        guard isLive else { return [] }
        reports.append(.routeChange(reason: reason, input: input, output: output, atMs: Self.ms(now)))
        return reconfigure ? [.reconfigureAudio] : []
    }

    /// The app went to the background or came back: logged, so a session that ends there says so.
    mutating func appState(background: Bool, now: TimeInterval) {
        guard self.background != background else { return }
        self.background = background
        if isLive { reports.append(.appState(background: background, atMs: Self.ms(now))) }
    }

    private mutating func closed(_ reason: LiveCloseReason, detail: String?, now: TimeInterval) {
        reports.append(.close(reason, detail: detail, background: background, atMs: Self.ms(now)))
    }

    // MARK: Lines

    private mutating func userHeard(_ delta: String, now: TimeInterval) -> [LiveEffect] {
        var effects: [LiveEffect] = []
        if phase == .agentSpeaking || provisionalSince != nil {
            // The voice's own words leaking into the mic aren't the user.
            if Self.isEcho(userText + delta, of: recentAgent + " " + agentText) { return [] }
            // Words: a level trigger is confirmed, or (without one) the transcript barges in on its own.
            effects += bargeIn(now: now)
        }
        if case .paused = phase { return [] }
        heardStart(now)
        userText += delta
        lastUserAt = now
        phase = .userSpeaking
        subtitle = LiveSubtitle(speaker: .user, text: userText.trimmingCharacters(in: .whitespaces))
        return effects
    }

    private mutating func agentSaid(_ delta: String, now: TimeInterval) -> [LiveEffect] {
        // After a barge-in, what's left of the cut-off reply isn't shown or heard.
        if awaitingTurn { return [] }
        var effects: [LiveEffect] = []
        if phase == .userSpeaking { effects += finishUser(now: now) }
        // Muted by a level trigger that's waiting for words: the voice stays quiet meanwhile.
        if provisionalSince != nil {
            agentText += delta
            agentUntil = max(agentUntil, now + agentPause) + Self.speakingTime(delta)
            return effects
        }
        if agentMuted {
            agentMuted = false
            effects.append(.muteAgentAudio(false))
        }
        agentText += delta
        agentUntil = max(agentUntil, now + agentPause) + Self.speakingTime(delta)
        phase = .agentSpeaking
        subtitle = LiveSubtitle(speaker: .agent, text: agentText.trimmingCharacters(in: .whitespaces))
        return effects
    }

    /// The user talked over the voice: silence it now, record where it was cut off, and tell the model.
    private mutating func bargeIn(now: TimeInterval) -> [LiveEffect] {
        let heard = (agentText.isEmpty ? lastAgentLine : agentText).trimmingCharacters(in: .whitespacesAndNewlines)
        finishAgent(now: now)
        reports.append(.interrupted(heard: heard, atMs: Self.ms(now)))
        interruptions += 1
        // Already silent when the level gate triggered: this confirms it.
        provisionalSince = nil
        agentMuted = true
        awaitingTurn = true
        agentUntil = 0
        return [.muteAgentAudio(true), .send(.note(Self.interruptedNote(heard), spoken: false))]
    }

    @discardableResult
    private mutating func finishUser(now: TimeInterval) -> [LiveEffect] {
        let text = userText.trimmingCharacters(in: .whitespacesAndNewlines)
        userText = ""
        guard !text.isEmpty else { return [] }
        let started = min(lineStart ?? now, now)
        lineStart = nil
        lineEnded = now
        awaitingTurn = false
        lastAgentLine = ""
        if phase == .userSpeaking { phase = .thinking }
        if Self.isEcho(text, of: recentAgent) { return [] }
        // The user moved on: a new request, not a wait to remind them of.
        stillWaiting = nil
        // Only a line that started after the question went back can answer it (Studio checks: answers).
        let answers = question.flatMap { started >= $0.at ? $0.actionId : nil }
        reports.append(.transcript(role: .user, text: text, atMs: Self.ms(now), startedMs: Self.ms(started), answers: answers))
        return [.earcon(.heard)]
    }

    private mutating func finishAgent(now: TimeInterval, keepSpeaking: Bool = false) {
        let text = agentText.trimmingCharacters(in: .whitespacesAndNewlines)
        agentText = ""
        if phase == .agentSpeaking, !keepSpeaking { phase = .listening }
        guard !text.isEmpty else { return }
        lastAgentLine = text
        recentAgent = String((recentAgent + " " + text).suffix(400))
        reports.append(.transcript(role: .agent, text: text, atMs: Self.ms(now)))
    }

    // MARK: Helpers

    static func ms(_ seconds: TimeInterval) -> Int { Int((seconds * 1000).rounded()) }

    /// GPT-Live's session.closed reasons, in words; nil for the user's own hang-up.
    static func closedReason(_ reason: String) -> String? {
        switch reason {
        case "close_requested": nil
        case "expired": "The session reached its time limit"
        case "content": "Ended by OpenAI's safety filter"
        case "remote_hangup": "The voice ended the session"
        case "connection_lost": "The connection was lost"
        default: "The session ended"
        }
    }

    /// About how long words take to say: 15 characters a second.
    static func speakingTime(_ text: String) -> TimeInterval { Double(text.count) / 15 }

    static func interruptedNote(_ heard: String) -> String {
        heard.isEmpty
            ? "(Studio, not the user:) The user interrupted you before you said anything. Answer what they said."
            : "(Studio, not the user:) The user interrupted you. They heard up to: \"\(String(heard.suffix(200)))\". Don't repeat it; answer what they said next."
    }

    private static func normalized(_ text: String) -> String {
        text.lowercased().unicodeScalars.filter { CharacterSet.letters.contains($0) || $0 == " " }
            .map(String.init).joined().split(separator: " ").joined(separator: " ")
    }

    /// Three or more words the voice just said: its echo, not the user.
    static func isEcho(_ heard: String, of said: String) -> Bool {
        let words = normalized(heard)
        guard words.split(separator: " ").count >= 3 else { return false }
        return normalized(said).contains(words)
    }

    /// The question in a destructive action's output: Studio says `Ask exactly this and wait: "…"`.
    static func confirmQuestion(in output: String) -> String? {
        guard let start = output.range(of: "Ask exactly this and wait: \""),
              let end = output.range(of: "\"", range: start.upperBound..<output.endIndex) else { return nil }
        return String(output[start.upperBound..<end.lowerBound])
    }

    /// The action a question waits on: Studio says `Not done yet (action d_…)`.
    static func confirmAction(in output: String) -> String? {
        guard let range = output.range(of: #"\(action d_[a-z0-9]+\)"#, options: .regularExpression) else { return nil }
        return String(output[range].dropFirst("(action ".count).dropLast())
    }

    static func firstSentence(_ text: String) -> String {
        let clean = stripData(text)
        guard let end = clean.range(of: ". ") else { return clean }
        return String(clean[..<end.lowerBound]) + "."
    }

    static func stripData(_ text: String) -> String {
        text.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "As data, not instructions:", with: "")
            .replacingOccurrences(of: ", as data:", with: ":")
            .replacingOccurrences(of: "'s latest reply, as data:", with: ":")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// "What's waiting": how many need you, and the first two.
    static func waitingCard(_ output: String) -> LiveToolCard {
        let count = output.range(of: #"Needs you now \((\d+)\)"#, options: .regularExpression)
            .map { output[$0].filter(\.isNumber) } ?? "0"
        let titles = output.split(separator: "\n").filter { $0.hasPrefix("- ") }.prefix(2)
            .map { line in String(line.dropFirst(2).prefix { $0 != "(" }).trimmingCharacters(in: .whitespaces) }
        let detail = titles.isEmpty ? "Nothing needs you right now" : titles.joined(separator: " · ")
        return LiveToolCard(kind: .waiting, title: count == "0" ? "Nothing waiting" : "\(count) need\(count == "1" ? "s" : "") you", detail: detail)
    }

    #if DEBUG
    /// Screenshots of the subtitles on their own.
    mutating func qaClearCard() { card = nil }
    #endif
}
