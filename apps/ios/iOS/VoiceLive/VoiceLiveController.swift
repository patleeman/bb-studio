import AVFAudio
import Foundation
import UIKit
import os

private let log = Logger(subsystem: "nyc.plee.bbgo", category: "voice-live")

/// Studio's side of a session, for the controller (BBClient in the app; fakes in tests).
@MainActor
protocol VoiceLiveStudio: AnyObject {
    func voiceLiveState() async throws -> VoiceLiveState
    func voiceLiveStart(model: String?, sdp: String?) async throws -> VoiceLiveStart
    func voiceLiveTool(sessionId: String, name: String, arguments: String, reports: [LiveReport]) async throws -> String
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
    /// Milliseconds, for the spike's write-up: connect, first words, each tool round trip.
    private(set) var timings: [String: [Int]] = [:]

    private let studio: VoiceLiveStudio
    private var transport: LiveTransport?
    private var sessionId: String?
    private var protocolKind: LiveProtocol = .live
    private var loops: [Task<Void, Never>] = []
    private var observers: [NSObjectProtocol] = []
    private var connectStarted: Date?
    private var firstWords = false
    private let audio = VoiceAudioConfig.handsFree
    private var usesMic = true

    init(studio: VoiceLiveStudio) {
        self.studio = studio
    }

    var phase: LivePhase { machine.phase }
    var isLive: Bool { machine.isLive }

    func start() {
        apply(machine.start(now: Self.now))
    }

    func stop() {
        apply(machine.stop(now: Self.now))
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
            var rtc: WebRTCLiveTransport?
            if chosen == "gpt-live-1", usesMic {
                // Studio needs the offer to create the session; a host running the mock ignores it.
                try await prepareAudio()
                let peer = WebRTCLiveTransport()
                let offer = try await peer.makeOffer()
                started = try await studio.voiceLiveStart(model: chosen, sdp: offer)
                rtc = peer
            } else {
                started = try await studio.voiceLiveStart(model: chosen, sdp: nil)
            }
            sessionId = started.sessionId
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
                let peer = WebRTCLiveTransport()
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
        transport.onClosed = { [weak self] reason in
            guard let self, self.machine.isLive else { return }
            self.apply(self.machine.fail(reason ?? "The voice connection closed.", now: Self.now))
        }
        self.transport = transport
    }

    // MARK: Audio session

    private func prepareAudio() async throws {
        guard await AVAudioApplication.requestRecordPermission() else {
            throw BBError(status: 0, message: "Microphone access is off. Enable it in Settings.")
        }
        let session = AVAudioSession.sharedInstance()
        try audio.apply(to: session)
        try session.setActive(true)
        describeRoute()
        observeAudio()
    }

    private func reconfigureAudio() {
        guard usesMic else { return }
        let session = AVAudioSession.sharedInstance()
        // Only set ours again when it changed: our own setCategory is a category change too.
        if session.category != audio.category || session.mode != audio.mode { try? audio.apply(to: session) }
        try? VoiceAudioConfig.preferBluetoothInput(session)
        try? session.setActive(true)
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
                Task { @MainActor in
                    guard let self else { return }
                    switch VoiceRouteAction.forReason(reason) {
                    case .keep: break
                    case .reroute, .reapply: self.apply(self.machine.routeChanged())
                    }
                }
            },
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
                let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt ?? 0
                let began = AVAudioSession.InterruptionType(rawValue: raw) == .began
                Task { @MainActor in
                    guard let self else { return }
                    self.apply(self.machine.interruption(began: began, now: Self.now))
                }
            },
            center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.reconfigureAudio() }
            },
        ]
    }

    // MARK: Studio

    private func runTool(callId: String, name: String, arguments: String, reports: [LiveReport]) async {
        guard let sessionId else { return }
        let started = Date()
        let output: String
        do {
            output = try await studio.voiceLiveTool(sessionId: sessionId, name: name, arguments: arguments, reports: reports)
        } catch {
            output = "Studio couldn't run that: \(error.localizedDescription)"
        }
        time("tool", since: started)
        apply(machine.toolFinished(callId: callId, name: name, output: output))
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
                    try? await Task.sleep(for: .seconds(3))
                    guard let self, self.machine.isLive else { return }
                    await self.sync()
                }
            },
        ]
    }

    private func sync() async {
        guard let sessionId else { return }
        let reports = machine.drain()
        do {
            let result = try await studio.voiceLiveEvent(sessionId: sessionId, reports: reports)
            costUsd = result.costUsd
            if let stop = result.stop {
                apply(machine.handle(.error(stop), now: Self.now))
                apply(machine.stop(now: Self.now))
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
        if let sessionId {
            try? await studio.voiceLiveEnd(sessionId: sessionId, reports: reports)
        }
        // Let session.close reach the model (it answers with final usage), then drop the line.
        try? await Task.sleep(for: .milliseconds(400))
        transport?.close()
        transport = nil
        sessionId = nil
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        if usesMic { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }

    #if DEBUG
    /// `-qaVoiceLive <state>`: the screen caught in one state, driven through the real machine.
    func qaShow(_ machine: LiveSessionMachine) {
        self.machine = machine
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
