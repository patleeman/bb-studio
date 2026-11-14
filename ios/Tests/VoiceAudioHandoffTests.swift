import AVFAudio
import WebRTC
import XCTest
@testable import BBStudio

// Nov 4: hands-free voice lost its sound mid-session, played on the earpiece, and
// left the composer's mic at 0 Hz afterwards. These drive the fixes with fakes
// (no mic, no WebRTC connection): lines starting "EVIDENCE" go to the evidence file.

extension XCTestCase {
    func onTheSharedAudioSession<T>(_ work: () throws -> T) throws -> T {
        do {
            return try work()
        } catch let error as NSError where error.domain == NSOSStatusErrorDomain && error.code == -50 {
            do {
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
            } catch let baseline as NSError where baseline.domain == NSOSStatusErrorDomain && baseline.code == -50 {
                throw XCTSkip("This simulator can't configure the shared audio session at all (OSStatus -50, even for .playback)")
            }
            throw error
        }
    }
}

/// A fake AVAudioSession: what was called, and a route the test sets.
final class FakeAudioSession: AudioSessionControl {
    var calls: [String] = []
    var category: AVAudioSession.Category = .soloAmbient
    var mode: AVAudioSession.Mode = .default
    var categoryOptions: AVAudioSession.CategoryOptions = []
    var isEchoCancelledInputAvailable = false
    var availableInputPorts: [AVAudioSession.Port] = [.builtInMic]
    var preferredInputPort: AVAudioSession.Port?
    var routeInputs: [AVAudioSession.Port] = [.builtInMic]
    var routeOutputs: [AVAudioSession.Port] = [.builtInReceiver]
    /// setActive(false) fails this many times first ("I/O is running").
    var busyDeactivations = 0
    var routeInputName: String { routeInputs.map(\.rawValue).joined(separator: ", ") }
    var routeOutputName: String { routeOutputs.map(\.rawValue).joined(separator: ", ") }

    func setCategory(_ category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions) throws {
        let name = mode == .voiceChat ? "voiceChat" : mode == .default ? "default" : mode.rawValue
        calls.append("setCategory(\(name), speaker: \(options.contains(.defaultToSpeaker)))")
        self.category = category
        self.mode = mode
        categoryOptions = options
        // .defaultToSpeaker moves the phone's own output to the loudspeaker.
        if routeOutputs == [.builtInReceiver], options.contains(.defaultToSpeaker) { routeOutputs = [.builtInSpeaker] }
    }
    func setPrefersEchoCancelledInput(_ value: Bool) throws { calls.append("prefersEchoCancelled") }
    func setActive(_ active: Bool, options: AVAudioSession.SetActiveOptions) throws {
        if !active, busyDeactivations > 0 {
            busyDeactivations -= 1
            calls.append("setActive(false) busy")
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(AVAudioSession.ErrorCode.isBusy.rawValue))
        }
        calls.append("setActive(\(active))")
    }
    func overrideOutputAudioPort(_ portOverride: AVAudioSession.PortOverride) throws {
        calls.append("override(\(portOverride == .speaker ? "speaker" : "none"))")
        if portOverride == .speaker, routeOutputs == [.builtInReceiver] { routeOutputs = [.builtInSpeaker] }
    }
    func setPreferredInput(port: AVAudioSession.Port) throws {
        calls.append("setPreferredInput(\(port.rawValue))")
        preferredInputPort = port
    }
}

/// A fake RTCAudioSession.
final class FakeRTCAudio: RTCAudioControl {
    var calls: [String] = []
    var useManualAudio = false
    var isAudioEnabled = false { didSet { calls.append("isAudioEnabled=\(isAudioEnabled)") } }
    var locked = 0
    var activations: Int { calls.filter { $0 == "didActivate" }.count }
    var deactivations: Int { calls.filter { $0 == "didDeactivate" }.count }
    func withLock(_ body: () throws -> Void) rethrows {
        locked += 1
        defer { locked -= 1 }
        try body()
    }
    func didActivate() { calls.append("didActivate") }
    func didDeactivate() { calls.append("didDeactivate") }
    func useConfiguration(_ config: VoiceAudioConfig) { calls.append("useConfiguration(speaker: \(config.options.contains(.defaultToSpeaker)))") }
}

@MainActor
final class FakePeer: LivePeer {
    var onMessage: ((Data) -> Void)?
    var onClosed: ((String?) -> Void)?
    var onLevels: (([Float], Float) -> Void)?
    var closed = false
    var sent: [Data] = []
    func makeOffer() async throws -> String { "v=0 fake offer" }
    func setAnswer(_ sdp: String) async throws {}
    func send(_ data: Data) { sent.append(data) }
    func setAgentAudio(enabled: Bool) {}
    func setMicMuted(_ muted: Bool) {}
    func close() { closed = true }
}

@MainActor
final class VoiceAudioHandoffTests: XCTestCase {
    private final class FakeStudio: VoiceLiveStudio {
        var ended: [[LiveReport]] = []
        var events: [[LiveReport]] = []
        func voiceLiveState() async throws -> VoiceLiveState { VoiceLiveState(ready: true, model: .gpt_live_1) }
        func voiceLiveStart(model: String?, sdp: String?, threadId: String?) async throws -> VoiceLiveStart {
            VoiceLiveStart(sessionId: "vl_0123456789abcdef", transport: .live_webrtc, answerSdp: "v=0 fake answer")
        }
        func voiceLiveTool(sessionId: String, name: String, arguments: String, reports: [LiveReport]) async throws -> VoiceLiveToolResult { VoiceLiveToolResult(output: "ok") }
        func voiceLiveEvent(sessionId: String, reports: [LiveReport]) async throws -> Studio.VoiceLiveEventOutput {
            events.append(reports)
            return Studio.VoiceLiveEventOutput()
        }
        func voiceLivePoll(sessionId: String) async throws -> [VoiceLiveReply] { [] }
        func voiceLiveEnd(sessionId: String, reports: [LiveReport]) async throws { ended.append(reports) }
    }

    private var session: FakeAudioSession!
    private var rtc: FakeRTCAudio!
    private var peer: FakePeer!
    private var studio: FakeStudio!
    private var trace: [String] = []

    private func live() async throws -> VoiceLiveController {
        session = FakeAudioSession()
        rtc = FakeRTCAudio()
        peer = FakePeer()
        studio = FakeStudio()
        let audio = VoiceLiveAudio(session: session, rtc: rtc, permission: { true })
        audio.deactivateDelays = [0, 10, 10, 10]
        audio.trace = { [weak self] in self?.trace.append($0) }
        let peer = peer!
        let controller = VoiceLiveController(studio: studio, audio: audio, makePeer: { peer })
        controller.start()
        try await until { controller.phase != .connecting || self.rtc.activations > 0 }
        // The fake answer has no session.started: say it, as GPT-Live would.
        try await until { self.peer.onMessage != nil }
        peer.onMessage?(Data(#"{"type":"session.started"}"#.utf8))
        try await until { controller.phase == .listening }
        return controller
    }

    private func until(_ condition: @escaping () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<150 where !condition() { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertTrue(condition(), "timed out", file: file, line: line)
    }

    private func post(_ name: Notification.Name, _ info: [AnyHashable: Any]) async throws {
        NotificationCenter.default.post(name: name, object: nil, userInfo: info)
        try await Task.sleep(for: .milliseconds(60))
    }

    private func evidence(_ step: String) {
        print("EVIDENCE \(step): session \(session.calls) | rtc \(rtc.calls) | output \(session.routeOutputName)")
        session.calls = []
        rtc.calls = []
    }

    // MARK: The controller, start to hang-up

    func testStartHandsTheSessionToWebRTCOnTheSpeaker() async throws {
        let controller = try await live()
        XCTAssertEqual(controller.phase, .listening)
        XCTAssertEqual(rtc.calls.first, "useConfiguration(speaker: true)", "WebRTC's own config keeps the speaker")
        XCTAssertTrue(rtc.useManualAudio)
        XCTAssertEqual(rtc.activations, 1, "audioSessionDidActivate after our setActive(true)")
        XCTAssertTrue(rtc.isAudioEnabled)
        XCTAssertEqual(session.mode, .voiceChat)
        XCTAssertTrue(session.categoryOptions.contains(.defaultToSpeaker))
        XCTAssertEqual(session.routeOutputs, [.builtInSpeaker], "the loudspeaker, not the earpiece")
        let activeAt = session.calls.firstIndex(of: "setActive(true)")!
        XCTAssertLessThan(session.calls.firstIndex(of: "setCategory(voiceChat, speaker: true)")!, activeAt)
        evidence("start")
        controller.stop()
        try await until { self.peer.closed }
    }

    func testARouteChangeHandsTheSessionToWebRTCAgain() async throws {
        let controller = try await live()
        evidence("start")
        // AirPods connect: a new device.
        session.availableInputPorts = [.builtInMic, .bluetoothHFP]
        session.routeInputs = [.builtInMic]
        session.routeOutputs = [.bluetoothHFP]
        try await post(AVAudioSession.routeChangeNotification, [AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.newDeviceAvailable.rawValue])
        XCTAssertEqual(rtc.calls, ["didDeactivate", "didActivate", "isAudioEnabled=true"], "told again (its count stays at one), audio on")
        XCTAssertTrue(rtc.isAudioEnabled)
        XCTAssertEqual(session.calls, ["setPreferredInput(BluetoothHFP)", "setActive(true)"], "same config: no category reset")
        evidence("route change: AirPods")
        // The same route again (our own preferred input echoes back): nothing set twice.
        session.routeInputs = [.bluetoothHFP]
        try await post(AVAudioSession.routeChangeNotification, [AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.override.rawValue])
        XCTAssertFalse(session.calls.contains { $0.hasPrefix("setPreferredInput") || $0.hasPrefix("setCategory") || $0.hasPrefix("override") }, "\(session.calls)")
        evidence("route change: our own, echoed")
        // WebRTC's own config (no .defaultToSpeaker) set behind our back: earpiece. Ours again, and the speaker.
        session.availableInputPorts = [.builtInMic]
        session.routeInputs = [.builtInMic]
        session.categoryOptions = [.allowBluetoothHFP]
        session.routeOutputs = [.builtInReceiver]
        try await post(AVAudioSession.routeChangeNotification, [AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.categoryChange.rawValue])
        XCTAssertTrue(session.calls.contains("setCategory(voiceChat, speaker: true)"))
        XCTAssertEqual(session.routeOutputs, [.builtInSpeaker])
        evidence("route change: category without the speaker")
        controller.stop()
        try await until { self.peer.closed && !self.studio.ended.isEmpty }
        // Studio is told (voiceLive.event every 3 s, the rest at the end).
        let reports = (studio.events + studio.ended).flatMap { $0 }
        XCTAssertEqual(reports.compactMap { if case .routeChange(let reason, _, let output, _) = $0 { return "\(reason) → \(output)" } else { return nil } },
                       ["new_device → BluetoothHFP", "override → BluetoothHFP", "category_change → Receiver"])
    }

    func testAnInterruptionTurnsWebRTCAudioOffAndBackOn() async throws {
        let controller = try await live()
        evidence("start")
        try await post(AVAudioSession.interruptionNotification, [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
        XCTAssertEqual(controller.phase, .paused("Paused for a call"))
        XCTAssertFalse(rtc.isAudioEnabled)
        XCTAssertEqual(rtc.calls, ["isAudioEnabled=false", "didDeactivate"])
        evidence("interruption began")
        try await post(AVAudioSession.interruptionNotification, [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue])
        XCTAssertEqual(controller.phase, .listening)
        XCTAssertEqual(rtc.calls, ["didActivate", "isAudioEnabled=true"])
        XCTAssertTrue(session.calls.contains("setActive(true)"))
        XCTAssertTrue(rtc.isAudioEnabled)
        evidence("interruption ended")
        controller.stop()
        try await until { self.peer.closed }
    }

    func testHangUpReleasesWebRTCAudioThenTheSession() async throws {
        let controller = try await live()
        evidence("start")
        // WebRTC's unit still winding down: the first deactivation fails.
        session.busyDeactivations = 1
        controller.stop()
        try await until { self.session.calls.contains("setActive(false)") }
        XCTAssertTrue(peer.closed)
        XCTAssertFalse(rtc.isAudioEnabled)
        XCTAssertEqual(rtc.calls, ["isAudioEnabled=false", "didDeactivate"], "audio off before the connection and the session go")
        XCTAssertEqual(session.calls, ["setActive(false) busy", "setActive(false)"], "retried while I/O ran")
        evidence("hang-up")
        XCTAssertEqual(studio.ended.count, 1)
        XCTAssertTrue(studio.ended[0].contains { if case .close(.user, _, false, _) = $0 { return true } else { return false } }, "\(studio.ended[0])")
    }

    func testTheConnectionDroppingIsReportedAsTransport() async throws {
        let controller = try await live()
        peer.onClosed?("The connection was lost.")
        try await until { !self.studio.ended.isEmpty }
        XCTAssertTrue(studio.ended[0].contains { if case .close(.transport, "The connection was lost.", false, _) = $0 { return true } else { return false } }, "\(studio.ended[0])")
        if case .failed = controller.phase {} else { XCTFail("\(controller.phase)") }
        try await until { self.session.calls.contains("setActive(false)") }
        XCTAssertFalse(rtc.isAudioEnabled)
    }

    // MARK: The loudspeaker

    func testTheSpeakerUnlessSomethingIsConnected() {
        XCTAssertEqual(VoiceSpeakerRoute.wanted(outputs: [.builtInReceiver], inputs: [.builtInMic]), .speaker, "the phone alone")
        XCTAssertEqual(VoiceSpeakerRoute.wanted(outputs: [.builtInSpeaker], inputs: [.builtInMic]), .speaker)
        XCTAssertEqual(VoiceSpeakerRoute.wanted(outputs: [.bluetoothHFP], inputs: [.bluetoothHFP]), .none, "AirPods")
        XCTAssertEqual(VoiceSpeakerRoute.wanted(outputs: [.bluetoothA2DP], inputs: [.builtInMic]), .none, "Bluetooth speaker")
        XCTAssertEqual(VoiceSpeakerRoute.wanted(outputs: [.bluetoothLE], inputs: [.builtInMic]), .none)
        XCTAssertEqual(VoiceSpeakerRoute.wanted(outputs: [.carAudio], inputs: [.carAudio]), .none, "the car")
        XCTAssertEqual(VoiceSpeakerRoute.wanted(outputs: [.headphones], inputs: [.headsetMic]), .none, "wired")
        XCTAssertEqual(VoiceSpeakerRoute.wanted(outputs: [.builtInReceiver], inputs: [.bluetoothHFP]), .none, "a headset mic: its own earpiece")

        XCTAssertEqual(VoiceSpeakerRoute.change(outputs: [.builtInReceiver], inputs: [.builtInMic], overridden: false), .speaker)
        XCTAssertNil(VoiceSpeakerRoute.change(outputs: [.builtInSpeaker], inputs: [.builtInMic], overridden: false), "already there: no route change")
        XCTAssertNil(VoiceSpeakerRoute.change(outputs: [.builtInSpeaker], inputs: [.builtInMic], overridden: true))
        XCTAssertEqual(VoiceSpeakerRoute.change(outputs: [.bluetoothHFP], inputs: [.bluetoothHFP], overridden: true), AVAudioSession.PortOverride.none, "AirPods: ours cleared")
        XCTAssertNil(VoiceSpeakerRoute.change(outputs: [.bluetoothHFP], inputs: [.bluetoothHFP], overridden: false))
    }

    func testOnTheEarpieceTheOverrideMovesItAndHeadphonesClearIt() throws {
        let session = FakeAudioSession()
        let rtc = FakeRTCAudio()
        let audio = VoiceLiveAudio(session: session, rtc: rtc, permission: { true })
        session.routeOutputs = [.builtInReceiver]
        audio.routeOutput()
        XCTAssertEqual(session.calls, ["override(speaker)"])
        XCTAssertEqual(session.routeOutputs, [.builtInSpeaker])
        XCTAssertTrue(audio.speakerOverridden)
        audio.routeOutput()
        XCTAssertEqual(session.calls, ["override(speaker)"], "no loop: the override's own route change does nothing")
        session.routeOutputs = [.headphones]
        session.availableInputPorts = [.builtInMic, .headsetMic]
        audio.routeOutput()
        XCTAssertEqual(session.calls, ["override(speaker)", "override(none)"])
        XCTAssertFalse(audio.speakerOverridden)
    }

    func testThePreferredInputIsntSetTwice() throws {
        let session = FakeAudioSession()
        session.availableInputPorts = [.builtInMic, .bluetoothHFP]
        try VoiceAudioConfig.preferBluetoothInput(session)
        try VoiceAudioConfig.preferBluetoothInput(session)
        XCTAssertEqual(session.calls, ["setPreferredInput(BluetoothHFP)"])
        let other = FakeAudioSession()
        other.availableInputPorts = [.builtInMic, .carAudio]
        other.routeInputs = [.carAudio]
        try VoiceAudioConfig.preferBluetoothInput(other)
        XCTAssertEqual(other.calls, [], "already the input")
    }

    func testOptionsCountWhenCheckingTheConfig() {
        let config = VoiceAudioConfig.handsFree
        XCTAssertTrue(config.isApplied(category: .playAndRecord, mode: .voiceChat, options: config.options))
        XCTAssertFalse(config.isApplied(category: .playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP]),
                       "WebRTC's default: same category and mode, no speaker")
        XCTAssertTrue(config.isApplied(category: .playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .allowBluetoothA2DP, .defaultToSpeaker, .duckOthers]),
                      "far-field and high-quality recording don't count")
    }

    /// The real WebRTC and AVAudioSession, no activation (no mic): WebRTC's own config
    /// drops `.defaultToSpeaker`, and main's check (category and mode) didn't notice.
    func testWebRTCsOwnConfigDroppedTheSpeaker() throws {
        let avSession = AVAudioSession.sharedInstance()
        let rtcSession = RTCAudioSession.sharedInstance()
        let original = RTCAudioSessionConfiguration.webRTC()
        defer { RTCAudioSessionConfiguration.setWebRTC(original) }
        try onTheSharedAudioSession { try VoiceAudioConfig.handsFree.apply(to: avSession) }
        let ours = avSession.categoryOptions

        // BEFORE (main): WebRTC configures the session with its default when its audio unit starts.
        let webRTCDefault = RTCAudioSessionConfiguration.webRTC()
        try onTheSharedAudioSession {
            rtcSession.lockForConfiguration()
            defer { rtcSession.unlockForConfiguration() }
            try rtcSession.setCategory(AVAudioSession.Category(rawValue: webRTCDefault.category), mode: AVAudioSession.Mode(rawValue: webRTCDefault.mode), options: webRTCDefault.categoryOptions)
        }
        let before = avSession.categoryOptions
        let mainNoticed = avSession.category != VoiceAudioConfig.handsFree.category || avSession.mode != VoiceAudioConfig.handsFree.mode
        print("EVIDENCE webrtc-config BEFORE: ours \(ours.contains(.defaultToSpeaker) ? "defaultToSpeaker" : "no speaker") → after WebRTC's default \(before.contains(.defaultToSpeaker) ? "defaultToSpeaker" : "NO defaultToSpeaker (earpiece)"); main's category/mode check reapplies: \(mainNoticed); outputs \(avSession.currentRoute.outputs.map { "\($0.portType.rawValue) (\($0.portName))" })")
        XCTAssertTrue(ours.contains(.defaultToSpeaker))
        XCTAssertFalse(before.contains(.defaultToSpeaker), "WebRTC's default plays on the earpiece")
        XCTAssertFalse(mainNoticed, "main kept it: same category and mode")
        XCTAssertFalse(VoiceAudioConfig.handsFree.isApplied(to: avSession), "now noticed")

        // AFTER: ours is WebRTC's config, so its own setup keeps the speaker.
        WebRTCAudioControl().useConfiguration(.handsFree)
        let webRTCOurs = RTCAudioSessionConfiguration.webRTC()
        try onTheSharedAudioSession {
            rtcSession.lockForConfiguration()
            defer { rtcSession.unlockForConfiguration() }
            try rtcSession.setCategory(AVAudioSession.Category(rawValue: webRTCOurs.category), mode: AVAudioSession.Mode(rawValue: webRTCOurs.mode), options: webRTCOurs.categoryOptions)
        }
        print("EVIDENCE webrtc-config AFTER: WebRTC's config now \(avSession.categoryOptions.contains(.defaultToSpeaker) ? "defaultToSpeaker" : "NO defaultToSpeaker"); applied: \(VoiceAudioConfig.handsFree.isApplied(to: avSession)); outputs \(avSession.currentRoute.outputs.map { "\($0.portType.rawValue) (\($0.portName))" })")
        XCTAssertTrue(avSession.categoryOptions.contains(.defaultToSpeaker))
        XCTAssertTrue(VoiceAudioConfig.handsFree.isApplied(to: avSession))
        XCTAssertEqual(webRTCOurs.mode, AVAudioSession.Mode.voiceChat.rawValue)
    }

    // MARK: What Studio is told

    func testCloseReasonsAndTheBackground() {
        let t0: TimeInterval = 1_800_000_000
        func closing(_ run: (inout LiveSessionMachine) -> [LiveEffect]) -> LiveReport? {
            var machine = LiveSessionMachine(endsLinesOnPause: true)
            _ = machine.start(now: t0)
            _ = machine.handle(.started, now: t0)
            let effects = run(&machine)
            for case .hangUp(let reports) in effects { return reports.last { if case .close = $0 { return true } else { return false } } }
            return nil
        }
        XCTAssertEqual(closing { $0.stop(now: t0 + 1) }, .close(.user, detail: nil, background: false, atMs: LiveSessionMachine.ms(t0 + 1)))
        XCTAssertEqual(closing { $0.stop(now: t0 + 1, reason: .dismissed) }, .close(.dismissed, detail: nil, background: false, atMs: LiveSessionMachine.ms(t0 + 1)))
        XCTAssertEqual(closing { $0.stop(now: t0 + 1, reason: .cap, detail: "This month's cap") }, .close(.cap, detail: "This month's cap", background: false, atMs: LiveSessionMachine.ms(t0 + 1)))
        XCTAssertEqual(closing { $0.fail("Lost", now: t0 + 1, reason: .transport) }, .close(.transport, detail: "Lost", background: false, atMs: LiveSessionMachine.ms(t0 + 1)))
        XCTAssertEqual(closing { $0.handle(.closed(reason: "expired"), now: t0 + 1) }, .close(.server, detail: "expired", background: false, atMs: LiveSessionMachine.ms(t0 + 1)))
        XCTAssertEqual(closing { machine in
            machine.appState(background: true, now: t0 + 1)
            return machine.fail("Couldn't connect", now: t0 + 2)
        }, .close(.error, detail: "Couldn't connect", background: true, atMs: LiveSessionMachine.ms(t0 + 2)))
        let object = LiveReport.close(.transport, detail: "Lost", background: true, atMs: 5).object
        XCTAssertEqual(object["type"] as? String, "close")
        XCTAssertEqual(object["reason"] as? String, "transport")
        XCTAssertEqual(object["background"] as? Bool, true)
        XCTAssertEqual(LiveReport.routeChange(reason: "new_device", input: "a", output: "b", atMs: 1).object["type"] as? String, "route_change")
        XCTAssertEqual(LiveReport.audioInterruption(began: true, atMs: 1).object["began"] as? Bool, true)
        XCTAssertEqual(LiveReport.appState(background: true, atMs: 1).object["state"] as? String, "background")
    }

    /// A speaker session replayed through the old gate and the new: the voice's echo, room
    /// noise and a door, then the user really talking. Synthetic levels (not a recording).
    func testGateReplayOnTheSpeaker() {
        func replay(_ gate: BargeInGate, confirmWindow: TimeInterval) -> (falseMutes: Int, mutedMs: Int, userCaught: Bool) {
            var machine = LiveSessionMachine(endsLinesOnPause: true)
            let t0: TimeInterval = 1_800_000_000
            _ = machine.start(now: t0)
            // After start, which begins from defaults.
            machine.gate = gate
            machine.confirmWindow = confirmWindow
            _ = machine.handle(.started, now: t0)
            var userCaught = false
            var at = 0.0
            while at < 20 {
                let step = Int((at * 50).rounded())
                // The voice talks the whole time, a few words every half second.
                if step % 25 == 0 { _ = machine.handle(.agentText(" and then"), now: t0 + at) }
                // Its playback swings 0.08–0.32 every 2 s.
                let playback = Float(0.2 + 0.12 * sin(at * .pi))
                // What's left of its echo on the speaker: 60% of its level, plus the room.
                var mic = (machine.agentMuted ? 0 : playback * 0.6) + 0.015
                // A door or a laugh: 0.3 s at 0.12 every 4 s.
                let phase = at.truncatingRemainder(dividingBy: 4)
                if phase > 3.0, phase < 3.3 { mic = max(mic, 0.12) }
                // The user talks over the voice at 17 s, for a second; their words arrive at 17.6 s.
                let user = at >= 17 && at < 18
                if user { mic = max(mic, 0.35) }
                _ = machine.micLevels([(level: mic, at: t0 + at)], playback: machine.agentMuted ? 0 : playback)
                if user, at < 17.6, machine.agentMuted { userCaught = true }
                if step == 880 { _ = machine.handle(.userText("Wait, stop"), now: t0 + at) }
                _ = machine.tick(now: t0 + at)
                at += 0.02
            }
            let mutedMs = machine.drain().reduce(0) { total, report in
                if case .falseTrigger(_, _, _, let ms) = report { return total + ms } else { return total }
            }
            return (machine.falseTriggers, mutedMs, userCaught)
        }
        let before = replay(.before, confirmWindow: 1.0)
        let after = replay(BargeInGate(), confirmWindow: 0.4)
        print("EVIDENCE gate-replay BEFORE: \(before.falseMutes) false mutes, \(before.mutedMs) ms of the voice silenced, user caught: \(before.userCaught)")
        print("EVIDENCE gate-replay AFTER: \(after.falseMutes) false mutes, \(after.mutedMs) ms of the voice silenced, user caught: \(after.userCaught)")
        XCTAssertGreaterThan(before.falseMutes, 3, "the old gate cut the voice again and again")
        XCTAssertEqual(after.falseMutes, 0)
        XCTAssertTrue(before.userCaught)
        XCTAssertTrue(after.userCaught, "the user talking over it still mutes it")
    }
}

// MARK: - The composer's mic after a voice session

/// A fake AVAudioEngine whose input reads 0 Hz until the session is set up again.
final class FakeCaptureEngine: CaptureEngine {
    let hz: Double
    var isRunning = false
    var tapped = false
    var tapFormats: [AVAudioFormat?] = []
    var doubleTaps = 0
    init(hz: Double) { self.hz = hz }
    func inputFormat() -> AVAudioFormat? {
        hz > 0 ? AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: hz, channels: 1, interleaved: false) : nil
    }
    func installTap(bufferSize: AVAudioFrameCount, format: AVAudioFormat?, block: @escaping AVAudioNodeTapBlock) {
        if tapped { doubleTaps += 1 }
        tapFormats.append(format)
        tapped = true
    }
    func removeTap() { tapped = false }
    func prepare() {}
    func start() throws { isRunning = true }
    func stop() { isRunning = false }
    var notificationObject: AnyObject? { nil }
}

@MainActor
final class TalkMicRecoveryTests: XCTestCase {
    private var root: URL!

    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("MicRecovery-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: root) }

    private func journal() throws -> (TalkCaptureJournal, TalkCaptureJournal.Session) {
        let journal = TalkCaptureJournal(directory: root.appendingPathComponent("capture"))
        let session = TalkCaptureJournal.Session(recordingId: "rec_a", sessionId: "session_a", serverURL: URL(string: "https://a.invalid")!)
        try journal.begin(session)
        return (journal, session)
    }

    func testAStartThatSees0HzRecoversOnRetry() async throws {
        let session = FakeAudioSession()
        var engines: [FakeCaptureEngine] = []
        // The first engine was made while the voice session's unit still held the mic: 0 Hz.
        // A new one, after the session is set up again, reads 48 kHz.
        let capture = SegmentCapture(makeEngine: {
            let engine = FakeCaptureEngine(hz: engines.isEmpty || session.calls.isEmpty ? 0 : 48_000)
            engines.append(engine)
            return engine
        }, audioSession: session)
        capture.sessionConfig = .dictation(echoCancelling: false)
        capture.retryDelays = [0, 20, 20, 20]
        var tries: [String] = []
        capture.trace = { tries.append($0) }
        let (journal, recording) = try journal()
        try await capture.start(journal: journal, session: recording, onError: { _ in }, onLevel: { _ in }, onSegment: { _ in })
        print("EVIDENCE talk-0hz AFTER: \(tries) | session \(session.calls) | engines made \(engines.count), input \(engines.last!.inputFormat()?.sampleRate ?? 0) Hz")
        XCTAssertTrue(capture.isCapturing)
        XCTAssertEqual(tries, ["try 1: No microphone is available.", "try 2: started"])
        XCTAssertEqual(session.calls, ["setCategory(default, speaker: true)", "setActive(true)"], "the recorder's config and active again")
        XCTAssertEqual(engines.count, 2, "a new engine: the old one keeps the stale format")
        XCTAssertTrue(engines[1].isRunning && engines[1].tapped)
        XCTAssertFalse(engines[0].isRunning)
        _ = capture.stop()
    }

    func testNoMicAfterEveryTryStillSaysSo() async throws {
        let session = FakeAudioSession()
        var made = 0
        let capture = SegmentCapture(makeEngine: { made += 1; return FakeCaptureEngine(hz: 0) }, audioSession: session)
        capture.sessionConfig = .dictation(echoCancelling: false)
        capture.retryDelays = [0, 5, 5, 5]
        let (journal, recording) = try journal()
        do {
            try await capture.start(journal: journal, session: recording, onError: { _ in }, onLevel: { _ in }, onSegment: { _ in })
            XCTFail("started with no mic")
        } catch {
            XCTAssertEqual(error.localizedDescription, "No microphone is available.")
        }
        XCTAssertEqual(made, 5, "the first engine and one per failed try")
        XCTAssertEqual(session.calls.filter { $0 == "setActive(true)" }.count, 4)
        XCTAssertFalse(capture.isCapturing)
    }

    func testTheTapTakesTheInputsOwnFormatOnAnEngineMadeAtStart() async throws {
        let session = FakeAudioSession()
        var engines: [FakeCaptureEngine] = []
        let capture = SegmentCapture(makeEngine: {
            let engine = FakeCaptureEngine(hz: 24_000)
            engines.append(engine)
            return engine
        }, audioSession: session)
        XCTAssertTrue(engines.isEmpty, "no engine before the session is set up: its input format would be stale")
        let (journal, recording) = try journal()
        try await capture.start(journal: journal, session: recording, onError: { _ in }, onLevel: { _ in }, onSegment: { _ in })
        XCTAssertEqual(engines.count, 1)
        XCTAssertEqual(engines[0].tapFormats.count, 1)
        XCTAssertNil(engines[0].tapFormats[0] as AVAudioFormat?, "the input node's own format, so it always matches the hardware")
        XCTAssertEqual(engines[0].doubleTaps, 0)
        _ = capture.stop()
    }

    func testASecondStartUsesAFreshEngineAndNeverTapsTwice() async throws {
        let session = FakeAudioSession()
        var engines: [FakeCaptureEngine] = []
        let capture = SegmentCapture(makeEngine: {
            let engine = FakeCaptureEngine(hz: engines.isEmpty ? 48_000 : 16_000)
            engines.append(engine)
            return engine
        }, audioSession: session)
        let (journal, recording) = try journal()
        try await capture.start(journal: journal, session: recording, onError: { _ in }, onLevel: { _ in }, onSegment: { _ in })
        _ = capture.stop()
        let second = TalkCaptureJournal.Session(recordingId: "rec_b", sessionId: "session_b", serverURL: URL(string: "https://a.invalid")!)
        try journal.begin(second)
        try await capture.start(journal: journal, session: second, onError: { _ in }, onLevel: { _ in }, onSegment: { _ in })
        XCTAssertEqual(engines.count, 2, "a headset's 16 kHz after the built-in mic's 48 kHz: a new engine reads it")
        XCTAssertTrue(engines[1].isRunning && engines[1].tapped)
        XCTAssertFalse(engines[0].isRunning || engines[0].tapped, "the first engine let go of its tap")
        XCTAssertEqual(engines.map(\.doubleTaps), [0, 0])
        _ = capture.stop()
    }

    func testARestartAfterARouteChangeNeverTapsTwice() async throws {
        let session = FakeAudioSession()
        var engines: [FakeCaptureEngine] = []
        let capture = SegmentCapture(makeEngine: {
            let engine = FakeCaptureEngine(hz: 48_000)
            engines.append(engine)
            return engine
        }, audioSession: session)
        capture.retryDelays = [0, 5]
        let (journal, recording) = try journal()
        try await capture.start(journal: journal, session: recording, onError: { _ in }, onLevel: { _ in }, onSegment: { _ in })
        engines[0].isRunning = false
        capture.restart()
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertTrue(engines.last!.isRunning)
        XCTAssertEqual(engines.map(\.doubleTaps), Array(repeating: 0, count: engines.count))
        _ = capture.stop()
    }

    func testADeniedMicrophoneSaysSoAndNeverStartsCapture() async throws {
        var made = 0
        let capture = SegmentCapture(makeEngine: { made += 1; return FakeCaptureEngine(hz: 48_000) }, audioSession: FakeAudioSession())
        let recorder = TalkRecorder(client: BBClient(baseURL: URL(string: "https://mic-denied.invalid")!), capture: capture, permission: { false })
        await recorder.start(kind: "dictation")
        XCTAssertEqual(recorder.phase, .failed("Microphone access is off. Enable it in Settings."))
        XCTAssertFalse(capture.isCapturing)
        XCTAssertEqual(made, 0, "no engine and no tap without the microphone")
    }

    func testTheRealEngineRecordsTwiceInARowWithoutAborting() async throws {
        guard ProcessInfo.processInfo.environment["REAL_MIC"] != nil else { throw XCTSkip("needs microphone access granted to the test host") }
        let session = AVAudioSession.sharedInstance()
        try VoiceAudioConfig.dictation(echoCancelling: false).apply(to: session)
        try session.setActive(true)
        let capture = SegmentCapture()
        let (journal, first) = try journal()
        try await capture.start(journal: journal, session: first, onError: { _ in }, onLevel: { _ in }, onSegment: { _ in })
        try await Task.sleep(for: .milliseconds(500))
        _ = capture.stop()
        try VoiceAudioConfig.dictation(echoCancelling: true).apply(to: session)
        let second = TalkCaptureJournal.Session(recordingId: "rec_real", sessionId: "session_real", serverURL: URL(string: "https://a.invalid")!)
        try journal.begin(second)
        try await capture.start(journal: journal, session: second, onError: { _ in }, onLevel: { _ in }, onSegment: { _ in })
        try await Task.sleep(for: .milliseconds(500))
        XCTAssertTrue(capture.isCapturing)
        _ = capture.stop()
        try? session.setActive(false)
    }
}
