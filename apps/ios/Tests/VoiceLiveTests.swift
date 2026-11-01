import AVFAudio
import XCTest
@testable import BBStudio

/// Hands-free voice (iOS/VoiceLive/Core): the session machine, barge-in, the
/// wire events and the audio session (HFP).
final class VoiceLiveMachineTests: XCTestCase {
    private let t0: TimeInterval = 1_800_000_000

    private func live(_ ends: Bool = true) -> LiveSessionMachine {
        var machine = LiveSessionMachine(endsLinesOnPause: ends)
        XCTAssertEqual(machine.start(now: t0), [.earcon(.start), .connect])
        XCTAssertEqual(machine.phase, .connecting)
        _ = machine.handle(.started, now: t0 + 0.5)
        XCTAssertEqual(machine.phase, .listening)
        return machine
    }

    private func transcripts(_ reports: [LiveReport]) -> [String] {
        reports.compactMap { if case .transcript(let role, let text, _) = $0 { return "\(role.rawValue): \(text)" } else { return nil } }
    }

    func testStartsOnceAndStopsWithHangUp() {
        var machine = live()
        XCTAssertEqual(machine.start(now: t0 + 1), [], "a second Start does nothing")
        _ = machine.handle(.userText("Hello"), now: t0 + 1)
        let effects = machine.stop(now: t0 + 2)
        XCTAssertEqual(machine.phase, .ended(nil))
        XCTAssertEqual(effects.first, .send(.close))
        guard case .hangUp(let reports) = effects[1] else { return XCTFail("no hang-up") }
        XCTAssertEqual(transcripts(reports), ["user: Hello"])
        XCTAssertFalse(machine.isLive)
    }

    func testHandsFreeTurnsEndOnAPauseWithNoTap() {
        var machine = live()
        _ = machine.handle(.userText("What's waiting"), now: t0 + 1)
        _ = machine.handle(.userText(" on me?"), now: t0 + 1.3)
        XCTAssertEqual(machine.phase, .userSpeaking)
        XCTAssertEqual(machine.speaking, .user)
        XCTAssertEqual(machine.subtitle, LiveSubtitle(speaker: .user, text: "What's waiting on me?"))
        XCTAssertEqual(machine.tick(now: t0 + 1.6), [], "a short pause isn't the end")
        XCTAssertEqual(machine.tick(now: t0 + 2.3), [.earcon(.heard)])
        XCTAssertEqual(machine.phase, .thinking)
        XCTAssertEqual(transcripts(machine.drain()), ["user: What's waiting on me?"])

        _ = machine.handle(.agentText("Two things need you."), now: t0 + 3)
        XCTAssertEqual(machine.phase, .agentSpeaking)
        XCTAssertEqual(machine.speaking, .agent)
        XCTAssertEqual(machine.subtitle, LiveSubtitle(speaker: .agent, text: "Two things need you."))
        // Still talking while its audio plays; then back to listening, the subtitle stays up.
        _ = machine.tick(now: t0 + 3.5)
        XCTAssertEqual(machine.phase, .agentSpeaking)
        _ = machine.tick(now: t0 + 5)
        XCTAssertEqual(machine.phase, .listening)
        XCTAssertEqual(machine.subtitle?.text, "Two things need you.")
        XCTAssertEqual(transcripts(machine.drain()), ["agent: Two things need you."])
    }

    func testBargeInSilencesTheVoiceAtOnceAndTellsTheModelWhereItWasCutOff() {
        var machine = live()
        _ = machine.handle(.agentText("The Kensico lead says the fetcher"), now: t0 + 1)
        XCTAssertEqual(machine.phase, .agentSpeaking)
        let effects = machine.handle(.userText("Stop, "), now: t0 + 1.2)
        XCTAssertEqual(effects.first, .muteAgentAudio(true), "playback stops before anything else")
        XCTAssertEqual(effects.last, .send(.note(LiveSessionMachine.interruptedNote("The Kensico lead says the fetcher"), spoken: false)))
        XCTAssertTrue(LiveSessionMachine.interruptedNote("The Kensico lead says the fetcher").contains("They heard up to: \"The Kensico lead says the fetcher\""))
        XCTAssertEqual(machine.phase, .userSpeaking)
        XCTAssertTrue(machine.agentMuted)
        XCTAssertEqual(machine.interruptions, 1)
        // The rest of the cut-off reply is ignored while the user talks.
        XCTAssertEqual(machine.handle(.agentText(" is paused until Monday."), now: t0 + 1.3), [])
        XCTAssertEqual(machine.subtitle?.speaker, .user)
        _ = machine.handle(.userText("what about the other one?"), now: t0 + 1.5)
        _ = machine.tick(now: t0 + 2.6)
        let reports = machine.drain()
        XCTAssertTrue(reports.contains(.interrupted(heard: "The Kensico lead says the fetcher", atMs: LiveSessionMachine.ms(t0 + 1.2))))
        XCTAssertEqual(transcripts(reports), ["agent: The Kensico lead says the fetcher", "user: Stop, what about the other one?"])
        // Its next reply plays again.
        XCTAssertEqual(machine.handle(.agentText("The other one is still running."), now: t0 + 3), [.muteAgentAudio(false)])
        XCTAssertFalse(machine.agentMuted)
    }

    func testRealtimeSpeechStartedBargesInBeforeAnyWords() {
        var machine = live(false)
        _ = machine.handle(.agentAudioStarted, now: t0 + 1)
        _ = machine.handle(.agentText("Sure, I can"), now: t0 + 1.1)
        let effects = machine.handle(.userSpeechStarted, now: t0 + 1.3)
        XCTAssertEqual(effects.first, .muteAgentAudio(true))
        XCTAssertEqual(machine.phase, .userSpeaking)
        // Realtime's lines end on its own events, not on a pause.
        XCTAssertEqual(machine.tick(now: t0 + 5), [])
        XCTAssertEqual(machine.handle(.userLine("Never mind."), now: t0 + 5.1), [.earcon(.heard)])
        XCTAssertEqual(machine.phase, .thinking)
    }

    func testTheVoicesOwnEchoIsNotTheUser() {
        var machine = live()
        _ = machine.handle(.agentText("Send to the Kensico lead: pause the eBay fetcher until Monday."), now: t0 + 1)
        XCTAssertEqual(machine.handle(.userText("pause the eBay fetcher"), now: t0 + 1.4), [], "no barge-in on its own words")
        XCTAssertEqual(machine.phase, .agentSpeaking)
        XCTAssertFalse(machine.agentMuted)
    }

    func testAToolCallCarriesTheLinesHeardSoStudioHearsTheYesFirst() {
        var machine = live()
        _ = machine.handle(.userText("Yes."), now: t0 + 1)
        let effects = machine.handle(.toolCall(callId: "call_9", name: "confirm_send", arguments: #"{"draft_id":"d_1"}"#), now: t0 + 1.2)
        XCTAssertEqual(machine.phase, .thinking)
        guard case .runTool(let callId, let name, _, let reports) = effects.last else { return XCTFail("no tool relay") }
        XCTAssertEqual(callId, "call_9")
        XCTAssertEqual(name, "confirm_send")
        XCTAssertEqual(transcripts(reports), ["user: Yes."])
        XCTAssertTrue(effects.contains(.earcon(.working)))
    }

    func testReadBackWaitsForAYesThenShowsSent() {
        var machine = live()
        let effects = machine.toolFinished(callId: "c1", name: "send_to_thread", output: VoiceLiveDemo.draftOutput)
        XCTAssertEqual(effects, [.send(.toolResult(callId: "c1", output: VoiceLiveDemo.draftOutput))])
        XCTAssertEqual(machine.confirmation, "Send to the Kensico lead: Pause the eBay fetcher until Monday. Say yes to send.")
        // Studio didn't hear a yes: still waiting.
        _ = machine.toolFinished(callId: "c2", name: "confirm_send", output: "Studio didn't hear a clear yes (it heard \"hmm\"), so nothing was sent.")
        XCTAssertNotNil(machine.confirmation)
        let sent = machine.toolFinished(callId: "c3", name: "confirm_send", output: "Sent to the Kensico lead. Say \"Sent.\" Its answer will come back here when it's ready.")
        XCTAssertTrue(sent.contains(.earcon(.sent)))
        XCTAssertNil(machine.confirmation)
        XCTAssertEqual(machine.card, LiveToolCard(kind: .sent, title: "Sent to the Kensico lead", detail: "Its reply will be read to you"))
    }

    func testANoClearsTheReadBack() {
        var machine = live()
        _ = machine.toolFinished(callId: "c1", name: "send_to_cos", output: VoiceLiveDemo.draftOutput)
        _ = machine.toolFinished(callId: "c2", name: "confirm_send", output: "The user said \"no\", so it wasn't sent. Ask what they'd like instead.")
        XCTAssertNil(machine.confirmation)
        XCTAssertEqual(machine.card?.title, "Not sent")
    }

    func testToolCards() {
        var machine = live()
        _ = machine.toolFinished(callId: "c", name: "loops_list", output: VoiceLiveDemo.loopsOutput)
        XCTAssertEqual(machine.card, LiveToolCard(kind: .waiting, title: "2 need you", detail: "Reply to Dana about the pricing deck · Renew bbstudio.app before Friday"))
        _ = machine.toolFinished(callId: "c", name: "loops_act", output: #"Marked "Reply to Dana" done. Say that, and that they can say "undo" in the next 10 seconds (action a_1)."#)
        XCTAssertEqual(machine.card, LiveToolCard(kind: .loop, title: #"Marked "Reply to Dana" done."#, detail: "Say “undo” to undo"))
        _ = machine.toolFinished(callId: "c", name: "send_email", output: "There's no tool named \"send_email\", and voice can't spend money. Offer to pass it on.")
        XCTAssertEqual(machine.card?.title, "Not by voice")
    }

    func testRepliesAreSpokenNotes() {
        var machine = live()
        let effects = machine.reply(title: "the Kensico lead", summary: "Paused.", note: "(Studio, not the user:) the Kensico lead answered: Paused.")
        XCTAssertEqual(effects.last, .send(.note("(Studio, not the user:) the Kensico lead answered: Paused.", spoken: true)))
        XCTAssertEqual(machine.card?.title, "the Kensico lead answered")
    }

    func testAPhoneCallPausesAndResumesWithoutFallingBackToPushToTalk() {
        var machine = live()
        _ = machine.handle(.agentText("Here's"), now: t0 + 1)
        XCTAssertEqual(machine.interruption(began: true, now: t0 + 2), [.muteMic(true), .muteAgentAudio(true)])
        XCTAssertEqual(machine.phase, .paused("Paused for a call"))
        XCTAssertEqual(machine.handle(.userText("hello?"), now: t0 + 3), [], "the call isn't heard as the user")
        XCTAssertEqual(machine.interruption(began: false, now: t0 + 30), [.reconfigureAudio, .muteMic(false), .muteAgentAudio(false)])
        XCTAssertEqual(machine.phase, .listening)
        XCTAssertTrue(machine.isLive)
        XCTAssertEqual(machine.routeChanged(), [.reconfigureAudio], "the car connecting keeps the session")
    }

    func testTheServerEndingTheSessionHangsUp() {
        var machine = live()
        let effects = machine.handle(.closed(reason: "expired"), now: t0 + 9)
        XCTAssertEqual(machine.phase, .ended("expired"))
        XCTAssertTrue(effects.contains { if case .hangUp = $0 { return true } else { return false } })
    }

    func testUsageKeepsOnlyTheLatestLiveTotal() {
        var machine = live()
        _ = machine.handle(.liveUsage(seconds: 10), now: t0)
        _ = machine.handle(.liveUsage(seconds: 25), now: t0)
        _ = machine.handle(.backendUsage(input: 10, cached: 2, output: 5), now: t0)
        XCTAssertEqual(machine.drain(), [.liveUsage(seconds: 25), .backendUsage(input: 10, cached: 2, output: 5)])
        XCTAssertEqual(LiveReport.liveUsage(seconds: 25).object["type"] as? String, "live_usage")
        XCTAssertEqual(LiveReport.transcript(role: .agent, text: "Hi", atMs: 5).object["role"] as? String, "assistant")
    }
}

final class VoiceLiveEventTests: XCTestCase {
    private func parse(_ json: String) -> [LiveSignal] { LiveEventParser.parse(Data(json.utf8)) }

    func testGPTLiveEvents() {
        XCTAssertEqual(parse(#"{"type":"session.started"}"#), [.started])
        XCTAssertEqual(parse(#"{"type":"session.input_transcript.delta","delta":"tell the","start_ms":1,"end_ms":2}"#), [.userText("tell the")])
        XCTAssertEqual(parse(#"{"type":"session.output_transcript.delta","delta":"Sure."}"#), [.agentText("Sure.")])
        XCTAssertEqual(parse(#"{"type":"session.usage.updated","usage":{"seconds":12}}"#), [.liveUsage(seconds: 12)])
        XCTAssertEqual(parse(#"{"type":"session.closed","reason":"expired","usage":{"seconds":90}}"#), [.liveUsage(seconds: 90), .closed(reason: "expired")])
        // Its Responses backend's function calls, inside response.event.
        XCTAssertEqual(parse(#"{"type":"response.event","delegation_id":"item_1","event":{"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_1","name":"loops_list","arguments":"{}"}}}"#),
                       [.toolCall(callId: "call_1", name: "loops_list", arguments: "{}")])
        XCTAssertEqual(parse(#"{"type":"response.event","event":{"type":"response.completed","response":{"usage":{"input_tokens":120,"output_tokens":30,"input_tokens_details":{"cached_tokens":100}}}}}"#),
                       [.backendUsage(input: 120, cached: 100, output: 30)])
        XCTAssertEqual(parse(#"{"type":"response.event","event":{"type":"response.output_item.done","item":{"type":"message"}}}"#), [])
    }

    func testRealtimeEvents() {
        XCTAssertEqual(parse(#"{"type":"input_audio_buffer.speech_started"}"#), [.userSpeechStarted])
        XCTAssertEqual(parse(#"{"type":"conversation.item.input_audio_transcription.completed","transcript":"Yes."}"#), [.userLine("Yes.")])
        XCTAssertEqual(parse(#"{"type":"response.output_audio_transcript.delta","delta":"Sent"}"#), [.agentText("Sent")])
        XCTAssertEqual(parse(#"{"type":"output_audio_buffer.stopped"}"#), [.agentAudioStopped])
        XCTAssertEqual(parse(#"{"type":"response.output_item.done","item":{"type":"function_call","call_id":"c","name":"undo","arguments":"{}"}}"#), [.toolCall(callId: "c", name: "undo", arguments: "{}")])
        XCTAssertEqual(parse(#"{"type":"error","error":{"message":"Bad"}}"#), [.error("Bad")])
        XCTAssertEqual(parse("not json"), [])
    }

    private func messages(_ outgoing: LiveOutgoing, _ kind: LiveProtocol) -> [[String: Any]] {
        outgoing.encoded(kind).compactMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }

    func testToolResultsAndNotes() {
        let live = messages(.toolResult(callId: "call_1", output: "sent"), .live)
        XCTAssertEqual(live.map { $0["type"] as? String }, ["response.item.create", "response.create"])
        XCTAssertEqual((live[0]["item"] as? [String: Any])?["call_id"] as? String, "call_1")
        XCTAssertEqual(messages(.toolResult(callId: "c", output: "x"), .realtime).map { $0["type"] as? String }, ["conversation.item.create", "response.create"])
        XCTAssertEqual(messages(.note("say this", spoken: true), .live).first?["type"] as? String, "session.commentary.append")
        XCTAssertEqual(messages(.note("know this", spoken: false), .live).first?["type"] as? String, "session.thinking.append")
        XCTAssertEqual(messages(.note("know this", spoken: false), .realtime).count, 1, "no response.create for a silent note")
        XCTAssertEqual(messages(.close, .live).first?["type"] as? String, "session.close")
    }
}

final class VoiceAudioSessionTests: XCTestCase {
    func testHandsFreeHoldsOneVoiceChatSessionWithBluetoothHFP() {
        let config = VoiceAudioConfig.handsFree
        XCTAssertEqual(config.category, .playAndRecord)
        XCTAssertEqual(config.mode, .voiceChat, "echo cancelled, which barge-in needs")
        XCTAssertTrue(config.options.contains(.allowBluetoothHFP), "the car's or headset's mic")
        XCTAssertTrue(config.options.contains(.allowBluetoothA2DP))
        XCTAssertTrue(config.options.contains(.bluetoothHighQualityRecording))
        XCTAssertTrue(config.options.contains(.defaultToSpeaker))
        XCTAssertTrue(config.options.contains(.duckOthers))
        XCTAssertTrue(config.prefersEchoCancelledInput)
    }

    func testDictationNowAllowsHFP() {
        XCTAssertTrue(VoiceAudioConfig.dictation(echoCancelling: false).options.contains(.allowBluetoothHFP))
        XCTAssertEqual(VoiceAudioConfig.dictation(echoCancelling: false).mode, .default)
        XCTAssertEqual(VoiceAudioConfig.dictation(echoCancelling: true).mode, .voiceChat)
    }

    func testFarFieldOnlyWithHFP() {
        let withHFP = VoiceAudioConfig.handsFree.resolvedOptions(farFieldAvailable: true)
        if #available(iOS 26.2, *) { XCTAssertTrue(withHFP.contains(.farFieldInput)) }
        var noHFP = VoiceAudioConfig.handsFree
        noHFP.options.remove(.allowBluetoothHFP)
        if #available(iOS 26.2, *) { XCTAssertFalse(noHFP.resolvedOptions(farFieldAvailable: true).contains(.farFieldInput)) }
        XCTAssertEqual(VoiceAudioConfig.handsFree.resolvedOptions(farFieldAvailable: false), VoiceAudioConfig.handsFree.options)
    }

    func testPrefersTheCarThenBluetoothThenAHeadset() {
        XCTAssertEqual(VoiceAudioConfig.preferredInput(among: [.builtInMic, .bluetoothHFP, .carAudio]), .carAudio)
        XCTAssertEqual(VoiceAudioConfig.preferredInput(among: [.builtInMic, .bluetoothHFP]), .bluetoothHFP)
        XCTAssertEqual(VoiceAudioConfig.preferredInput(among: [.headsetMic, .builtInMic]), .headsetMic)
        XCTAssertNil(VoiceAudioConfig.preferredInput(among: [.builtInMic]))
    }

    func testRouteChanges() {
        XCTAssertEqual(VoiceRouteAction.forReason(.newDeviceAvailable), .reroute)
        XCTAssertEqual(VoiceRouteAction.forReason(.oldDeviceUnavailable), .reroute)
        XCTAssertEqual(VoiceRouteAction.forReason(.categoryChange), .reapply)
        XCTAssertEqual(VoiceRouteAction.forReason(.noSuitableRouteForCategory), .keep)
    }

    func testAppliesToTheSharedSession() throws {
        let session = AVAudioSession.sharedInstance()
        try VoiceAudioConfig.handsFree.apply(to: session)
        XCTAssertEqual(session.category, .playAndRecord)
        XCTAssertEqual(session.mode, .voiceChat)
        XCTAssertTrue(session.categoryOptions.contains(.allowBluetoothHFP))
    }
}
