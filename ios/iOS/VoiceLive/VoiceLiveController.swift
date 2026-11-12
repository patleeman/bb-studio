import AVFAudio
import Foundation
import UIKit
import os

private let log = Logger(subsystem: "nyc.plee.bbgo", category: "voice-live")

/// Studio's side of a session, for the controller (BBClient in the app; fakes in tests).
@MainActor
protocol VoiceLiveStudio: AnyObject {
    func voiceLiveState() async throws -> VoiceLiveState
    func voiceLiveStart(model: String?, sdp: String?, threadId: String?) async throws -> VoiceLiveStart
    func voiceLiveTool(sessionId: String, name: String, arguments: String, reports: [LiveReport]) async throws -> VoiceLiveToolResult
    func voiceLiveEvent(sessionId: String, reports: [LiveReport]) async throws -> Studio.VoiceLiveEventOutput
    func voiceLivePoll(sessionId: String) async throws -> [VoiceLiveReply]
    func voiceLiveEnd(sessionId: String, reports: [LiveReport]) async throws
}

extension BBClient: VoiceLiveStudio {}

/// A hands-free voice session on the phone: one tap to start, then no taps.
/// Runs the session machine (LiveSessionMachine), the WebRTC (or mock)
/// transport, the relay of tool calls to Studio, the reply poll, and one
/// audio session held from start to hang-up, kept across route changes and
/// phone calls.
@MainActor
final class VoiceLiveController: ObservableObject {
    @Published private(set) var machine = LiveSessionMachine(endsLinesOnPause: true)
    @Published private(set) var costUsd: Double?
    @Published private(set) var model: String = "gpt-live-1"
    @Published private(set) var route: String = ""
    /// Who the session speaks as, once Studio has started it (the header shows `label`, like the desktop pill).
    @Published private(set) var identity: VoiceLiveIdentity?
    /// Milliseconds, for the spike's write-up: connect, first words, each tool round trip.
    private(set) var timings: [String: [Int]] = [:]

    private let studio: VoiceLiveStudio
    /// The thread it was launched from: the session speaks as it. Nil: the Chief of Staff.
    let threadId: String?
    private var transport: LiveTransport?
    private var sessionId: String?
    private var protocolKind: LiveProtocol = .live
    private var loops: [Task<Void, Never>] = []
    private var observers: [NSObjectProtocol] = []
    private var appObservers: [NSObjectProtocol] = []
    private var connectStarted: Date?
    private var firstWords = false
    /// The audio session, handed between the app and WebRTC.
    let audio: VoiceLiveAudio
    private let makePeer: () -> LivePeer
    private var usesMic = true
    /// The most reports one call takes (the contract's limit): more go in several, oldest first.
    static let reportChunk = 200
    /// Syncs run every 3 s: this many failures in a row (30 s without Studio) hang up.
    static let maxFailedSyncs = 10
    static let lostStudio = "The call couldn't reach Studio for 30 seconds, so it ended."
    var syncEvery: Duration = .seconds(3)
    /// Waits between tries of the hang-up (about two minutes in all).
    var endRetries: [Duration] = [.seconds(1), .seconds(2), .seconds(4), .seconds(8), .seconds(15), .seconds(30), .seconds(60)]
    private var failedSyncs = 0
    private var inflightSync: Task<Void, Never>?

    /// `audio` and `makePeer`: fakes in tests (no mic, no WebRTC).
    init(studio: VoiceLiveStudio, threadId: String? = nil, audio: VoiceLiveAudio? = nil, makePeer: (() -> LivePeer)? = nil) {
        self.studio = studio
        self.threadId = threadId
        self.audio = audio ?? VoiceLiveAudio()
        self.makePeer = makePeer ?? { WebRTCLiveTransport() }
    }

    var phase: LivePhase { machine.phase }
    var isLive: Bool { machine.isLive }

    func start() {
        if !machine.isLive { identity = nil }
        observeApp()
        apply(machine.start(now: Self.now))
    }

    /// `reason`: End and the header's close are the user's; the screen going away is `.dismissed`.
    func stop(reason: LiveCloseReason = .user) {
        apply(machine.stop(now: Self.now, reason: reason))
    }

    private static var now: TimeInterval { Date().timeIntervalSince1970 }

    // MARK: Effects

    private func apply(_ effects: [LiveEffect]) {
        objectWillChange.send()
        for effect in effects {
            switch effect {
            case .connect:
                Task { await connect() }
            case .send(let outgoing):
                for data in outgoing.encoded(protocolKind) { transport?.send(data) }
            case .muteAgentAudio(let muted):
                transport?.setAgentAudio(enabled: !muted)
            case .muteMic(let muted):
                transport?.setMicMuted(muted)
            case .runTool(let callId, let name, let arguments, let reports):
                Task { await runTool(callId: callId, name: name, arguments: arguments, reports: reports) }
            case .hangUp(let reports):
                Task { await hangUp(reports) }
            case .earcon(let earcon):
                Earcons.play(earcon)
            case .reconfigureAudio:
                reconfigureAudio()
            }
        }
    }

    private func handle(_ data: Data) {
        for signal in LiveEventParser.parse(data) {
            if case .started = signal, let started = connectStarted { time("connect", since: started) }
            if case .agentText = signal, !firstWords, let started = connectStarted { firstWords = true; time("firstWords", since: started) }
            apply(machine.handle(signal, now: Self.now))
        }
    }

    private func time(_ name: String, since start: Date) {
        timings[name, default: []].append(Int(Date().timeIntervalSince(start) * 1000))
    }

    // MARK: Connect

    private func connect() async {
        connectStarted = Date()
        firstWords = false
        do {
            let state = try await studio.voiceLiveState()
            if state.ready == false { throw BBError(status: 0, message: state.problem ?? "Hands-free voice isn't set up.") }
            let chosen = state.model.map(Self.modelName) ?? "gpt-live-1"
            model = chosen
            var started: VoiceLiveStart
            var rtc: LivePeer?
            if chosen == "gpt-live-1", usesMic {
                // Studio needs the offer to create the session; a host running the mock ignores it.
                try await prepareAudio()
                let peer = makePeer()
                let offer = try await peer.makeOffer()
                started = try await studio.voiceLiveStart(model: chosen, sdp: offer, threadId: threadId)
                rtc = peer
            } else {
                started = try await studio.voiceLiveStart(model: chosen, sdp: nil, threadId: threadId)
            }
            sessionId = started.sessionId
            identity = started.identity
            protocolKind = chosen == "gpt-live-1" ? .live : .realtime
            switch started.transport {
            case .mock:
                rtc?.close()
                guard let url = started.mockUrl.flatMap(URL.init(string:)) else { throw BBError(status: 0, message: "The mock server has no address.") }
                protocolKind = .live
                let mock = MockLiveTransport(url: url)
                attach(mock)
                mock.connect()
            case .live_webrtc:
                guard let rtc, let answer = started.answerSdp else { throw BBError(status: 0, message: "Studio didn't return the voice connection.") }
                attach(rtc)
                try await rtc.setAnswer(answer)
            default:
                try await prepareAudio()
                guard let secret = started.clientSecret, let url = started.callsUrl.flatMap(URL.init(string:)) else {
                    throw BBError(status: 0, message: "Studio didn't return a voice session.")
                }
                let peer = makePeer()
                let offer = try await peer.makeOffer()
                attach(peer)
                try await peer.setAnswer(try await WebRTCLiveTransport.exchange(offer: offer, url: url, secret: secret))
                // Realtime says "session.created" on the channel; that counts as started.
            }
            machine.endsLinesOnPause = protocolKind == .live
            UIApplication.shared.isIdleTimerDisabled = true
            startLoops()
        } catch {
            log.error("voice connect failed: \(error.localizedDescription, privacy: .public)")
            apply(machine.fail(error.localizedDescription, now: Self.now))
            transport?.close()
            transport = nil
        }
    }

    private static func modelName(_ model: Studio.VoiceLiveStateOutputModel) -> String {
        switch model {
        case .gpt_live_1: "gpt-live-1"
        case .gpt_realtime_2_1: "gpt-realtime-2.1"
        case .unknown(let value): value
        }
    }

    private func attach(_ transport: LiveTransport) {
        transport.onMessage = { [weak self] data in self?.handle(data) }
        transport.onLevels = { [weak self] mic, playback in
            guard let self else { return }
            // The frames arrived together; space them 20 ms apart, newest now.
            let now = Self.now
            let frames = mic.enumerated().map { (level: $0.element, at: now - Double(mic.count - 1 - $0.offset) * 0.02) }
            let effects = self.machine.micLevels(frames, playback: playback)
            if !effects.isEmpty { self.apply(effects) }
        }
        transport.onClosed = { [weak self] reason in
            guard let self, self.machine.isLive else { return }
            self.apply(self.machine.fail(reason ?? "The voice connection closed.", now: Self.now, reason: .transport))
        }
        self.transport = transport
    }

    // MARK: Audio session

    private func prepareAudio() async throws {
        try await audio.activate()
        describeRoute()
        observeAudio()
    }

    /// A route change, an interruption's end or a media-services reset: our config again,
    /// WebRTC told, the loudspeaker unless a headset is there.
    private func reconfigureAudio(reset: Bool = false) {
        guard usesMic else { return }
        audio.reactivate(reset: reset)
        describeRoute()
    }

    private func describeRoute() {
        let route = AVAudioSession.sharedInstance().currentRoute
        self.route = route.inputs.first.map { "\($0.portName)" } ?? ""
    }

    private func observeAudio() {
        guard observers.isEmpty else { return }
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
                let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
                let reason = AVAudioSession.RouteChangeReason(rawValue: raw) ?? .unknown
                Task { @MainActor in self?.routeChanged(reason) }
            },
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
                let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt ?? 0
                let began = AVAudioSession.InterruptionType(rawValue: raw) == .began
                Task { @MainActor in self?.interruption(began: began) }
            },
            center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.reconfigureAudio(reset: true) }
            },
        ]
    }

    private func routeChanged(_ reason: AVAudioSession.RouteChangeReason) {
        let route = audio.route
        log.info("route change \(VoiceRouteAction.name(reason), privacy: .public): in \(route.input, privacy: .public), out \(route.output, privacy: .public)")
        let reconfigure = VoiceRouteAction.forReason(reason) != .keep
        apply(machine.routeChanged(reason: VoiceRouteAction.name(reason), input: route.input, output: route.output, reconfigure: reconfigure, now: Self.now))
    }

    private func interruption(began: Bool) {
        log.info("interruption \(began ? "began" : "ended", privacy: .public)")
        if began, machine.isLive, usesMic { audio.interrupted() }
        apply(machine.interruption(began: began, now: Self.now))
    }

    /// The app going to the background and back, logged so a session that ends there says so.
    private func observeApp() {
        guard appObservers.isEmpty else { return }
        let center = NotificationCenter.default
        appObservers = [
            center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.machine.appState(background: true, now: Self.now) }
            },
            center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.machine.appState(background: false, now: Self.now) }
            },
        ]
    }

    // MARK: Studio

    private func runTool(callId: String, name: String, arguments: String, reports: [LiveReport]) async {
        guard let sessionId else { return }
        let started = Date()
        var result: VoiceLiveToolResult
        // More than one call takes: the older ones go first, so the lines heard (the yes) still arrive before the tool runs.
        let older = Array(reports.dropLast(Self.reportChunk))
        var sent = 0
        do {
            while sent < older.count {
                let chunk = Array(older[sent..<min(sent + Self.reportChunk, older.count)])
                _ = try await studio.voiceLiveEvent(sessionId: sessionId, reports: chunk)
                sent += chunk.count
            }
            result = try await studio.voiceLiveTool(sessionId: sessionId, name: name, arguments: arguments, reports: Array(reports[sent...]))
        } catch {
            // Studio didn't get them: the next sync sends them.
            machine.requeue(Array(reports[sent...]))
            result = VoiceLiveToolResult(output: "Studio couldn't run that: \(error.localizedDescription)")
        }
        time("tool", since: started)
        let effects = machine.toolFinished(callId: callId, name: name, output: result.output ?? "", now: Self.now)
        // An "answer" relay: if no reply comes in time, the voice says once that it's still waiting.
        if let wait = result.waitFor, let note = wait.note, let ms = wait.ms {
            machine.waitForReply(note: note, ms: ms, now: Self.now)
        }
        apply(effects)
    }

    private func startLoops() {
        loops.forEach { $0.cancel() }
        loops = [
            // Lines end on a pause; the icon stops when the voice's audio should be done.
            Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(100))
                    guard let self, self.machine.isLive else { return }
                    let effects = self.machine.tick(now: Self.now)
                    if !effects.isEmpty { self.apply(effects) }
                }
            },
            // Transcript and usage to Studio; replies back; the cap.
            Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: self?.syncEvery ?? .seconds(3))
                    guard let self, self.machine.isLive else { return }
                    let sync = Task { await self.sync() }
                    self.inflightSync = sync
                    await sync.value
                    self.inflightSync = nil
                }
            },
        ]
    }

    /// Reports to Studio, at most `reportChunk` a call, oldest first. What Studio didn't get goes back
    /// in the queue for the next sync; 30 s without Studio ends the call (its end is retried).
    func sync() async {
        guard let sessionId else { return }
        let reports = machine.drain()
        var sent = 0
        var answer: Studio.VoiceLiveEventOutput?
        do {
            repeat {
                let chunk = Array(reports[sent..<min(sent + Self.reportChunk, reports.count)])
                answer = try await studio.voiceLiveEvent(sessionId: sessionId, reports: chunk)
                sent += chunk.count
            } while sent < reports.count
        } catch {
            machine.requeue(Array(reports[sent...]))
            failedSyncs += 1
            log.error("voice sync failed (\(self.failedSyncs)): \(error.localizedDescription, privacy: .public)")
            if failedSyncs >= Self.maxFailedSyncs, machine.isLive {
                apply(machine.fail(Self.lostStudio, now: Self.now, reason: .transport))
            }
            return
        }
        failedSyncs = 0
        guard let result = answer else { return }
        do {
            costUsd = result.costUsd
            if let stop = result.stop {
                apply(machine.handle(.error(stop), now: Self.now))
                apply(machine.stop(now: Self.now, reason: .cap, detail: stop))
                return
            }
            if (result.replies ?? 0) > 0 {
                for reply in try await studio.voiceLivePoll(sessionId: sessionId) {
                    apply(machine.reply(title: reply.title ?? "A thread", summary: reply.summary ?? "", note: reply.note ?? ""))
                }
            }
        } catch {
            log.error("voice sync failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func hangUp(_ reports: [LiveReport]) async {
        loops.forEach { $0.cancel() }
        loops = []
        UIApplication.shared.isIdleTimerDisabled = false
        log.info("voice timings: \(String(describing: self.timings), privacy: .public)")
        let ending = sessionId
        // A sync on its way puts back what it couldn't send.
        await inflightSync?.value
        let earlier = machine.drain()
        // Let session.close reach the model and its final usage come back (the machine keeps it), then drop the line.
        try? await Task.sleep(for: .milliseconds(400))
        let late = machine.drain()
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        appObservers.forEach(NotificationCenter.default.removeObserver)
        appObservers = []
        let closing = transport
        transport = nil
        sessionId = nil
        if usesMic {
            await audio.release { closing?.close() }
        } else {
            closing?.close()
        }
        if let ending { await end(ending, reports: earlier + reports + late) }
    }

    /// voiceLive.end with everything Studio hasn't had, retried for about two minutes (Studio's end is
    /// idempotent; a session it never hears end from, its reaper ends). More than one call takes go
    /// through voiceLive.event first.
    private func end(_ sessionId: String, reports: [LiveReport]) async {
        var rest = reports
        var attempt = 0
        while true {
            do {
                while rest.count > Self.reportChunk {
                    _ = try await studio.voiceLiveEvent(sessionId: sessionId, reports: Array(rest.prefix(Self.reportChunk)))
                    rest.removeFirst(Self.reportChunk)
                }
                try await studio.voiceLiveEnd(sessionId: sessionId, reports: rest)
                return
            } catch {
                log.error("voice end failed (\(attempt + 1)): \(error.localizedDescription, privacy: .public)")
                guard attempt < endRetries.count else { return }
                try? await Task.sleep(for: endRetries[attempt])
                attempt += 1
            }
        }
    }

    #if DEBUG
    /// `-qaVoiceLive <state>`: the screen caught in one state, driven through the real machine.
    func qaShow(_ machine: LiveSessionMachine, identity: VoiceLiveIdentity? = nil) {
        self.machine = machine
        self.identity = identity
        costUsd = 0.04
        route = "iPhone Microphone"
    }

    /// The mock needs no mic: it plays the user's side too.
    func qaUseMock() { usesMic = false }
    #endif
}

/// Short tones for "listening", "heard you", "working", "sent" and errors: state without looking.
@MainActor
enum Earcons {
    private static var players: [LiveEarcon: AVAudioPlayer] = [:]

    static func play(_ earcon: LiveEarcon) {
        let player = players[earcon] ?? tone(earcon).flatMap { try? AVAudioPlayer(data: $0) }
        players[earcon] = player
        player?.volume = 0.35
        player?.currentTime = 0
        player?.play()
    }

    /// (frequency, seconds) steps.
    private static func steps(_ earcon: LiveEarcon) -> [(Double, Double)] {
        switch earcon {
        case .start: [(660, 0.08), (880, 0.12)]
        case .heard: [(990, 0.05)]
        case .working: [(520, 0.05), (0, 0.05), (520, 0.05)]
        case .sent: [(784, 0.08), (1175, 0.14)]
        case .error: [(330, 0.18), (247, 0.22)]
        case .end: [(880, 0.08), (660, 0.12)]
        }
    }

    private static func tone(_ earcon: LiveEarcon) -> Data? {
        let rate = 24_000.0
        var samples: [Int16] = []
        for (frequency, seconds) in steps(earcon) {
            let count = Int(rate * seconds)
            for index in 0..<count {
                let fade = min(1, Double(min(index, count - index)) / (rate * 0.01))
                let value = frequency == 0 ? 0 : sin(2 * .pi * frequency * Double(index) / rate) * 0.5 * fade
                samples.append(Int16(value * Double(Int16.max)))
            }
        }
        var data = Data()
        func append<T>(_ value: T) { withUnsafeBytes(of: value) { data.append(contentsOf: $0) } }
        let bytes = UInt32(samples.count * 2)
        data.append(contentsOf: Array("RIFF".utf8)); append(UInt32(36 + bytes).littleEndian)
        data.append(contentsOf: Array("WAVEfmt ".utf8)); append(UInt32(16).littleEndian); append(UInt16(1).littleEndian); append(UInt16(1).littleEndian)
        append(UInt32(rate).littleEndian); append(UInt32(rate * 2).littleEndian); append(UInt16(2).littleEndian); append(UInt16(16).littleEndian)
        data.append(contentsOf: Array("data".utf8)); append(bytes.littleEndian)
        for sample in samples { append(sample.littleEndian) }
        return data
    }
}
