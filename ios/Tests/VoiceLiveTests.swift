import AVFAudio
import XCTest
@testable import BBStudio

/// The session speaks as the thread it was launched from: start sends it to Studio.
@MainActor
final class VoiceLiveLaunchThreadTests: XCTestCase {
    private final class FakeStudio: VoiceLiveStudio {
        var starts: [(model: String?, sdp: String?, threadId: String?)] = []
        func voiceLiveState() async throws -> VoiceLiveState { VoiceLiveState(ready: true, model: .gpt_live_1) }
        func voiceLiveStart(model: String?, sdp: String?, threadId: String?) async throws -> VoiceLiveStart {
            starts.append((model, sdp, threadId))
            // No transport: the controller fails right after, which is all this test needs.
            return VoiceLiveStart(sessionId: "vl_0123456789abcdef", transport: .mock)
        }
        func voiceLiveTool(sessionId: String, name: String, arguments: String, reports: [LiveReport]) async throws -> VoiceLiveToolResult { VoiceLiveToolResult(output: "ok") }
        func voiceLiveEvent(sessionId: String, reports: [LiveReport]) async throws -> Studio.VoiceLiveEventOutput { Studio.VoiceLiveEventOutput() }
        func voiceLivePoll(sessionId: String) async throws -> [VoiceLiveReply] { [] }
        func voiceLiveEnd(sessionId: String, reports: [LiveReport]) async throws {}
    }

    private func started(threadId: String?) async throws -> FakeStudio {
        let studio = FakeStudio()
        let controller = VoiceLiveController(studio: studio, threadId: threadId)
        controller.qaUseMock()
        controller.start()
        for _ in 0..<100 where studio.starts.isEmpty { try await Task.sleep(for: .milliseconds(20)) }
        return studio
    }

    func testStartSendsTheLaunchingThread() async throws {
        let studio = try await started(threadId: "thr_larkspur_bot")
        XCTAssertEqual(studio.starts.count, 1)
        XCTAssertEqual(studio.starts.first?.threadId, "thr_larkspur_bot")
    }

    func testNoThreadMeansTheChiefOfStaff() async throws {
        let studio = try await started(threadId: nil)
        XCTAssertEqual(studio.starts.count, 1)
        XCTAssertNil(studio.starts.first?.threadId)
    }

    func testTheSheetCarriesTheThread() {
        XCTAssertEqual(Sheet.handsFree(threadId: "thr_a").id, "hands-free:thr_a")
        XCTAssertNotEqual(Sheet.handsFree(threadId: "thr_a"), Sheet.handsFree(threadId: "thr_b"))
        XCTAssertEqual(Sheet.handsFree(autoStart: true).id, "hands-free:")
    }
}

/// After an "answer" relay, the voice says once that it's still waiting (voiceLive.tool's waitFor).
final class VoiceLiveStillWaitingTests: XCTestCase {
    private let t0: TimeInterval = 1_800_000_000
    private let note = #"(Studio, not the user:) the Larkspur lead hasn't answered yet. Say only, briefly: "Still waiting on the Larkspur lead." Then wait; don't guess."#

    private func relayed() -> LiveSessionMachine {
        var machine = LiveSessionMachine(endsLinesOnPause: true)
        _ = machine.start(now: t0)
        _ = machine.handle(.started, now: t0 + 0.5)
        _ = machine.toolFinished(callId: "c1", name: "send_to_thread", output: #"Sent to the Larkspur lead. Say briefly "Asking the Larkspur lead now.""#)
        machine.waitForReply(note: note, ms: 20_000, now: t0 + 1)
        return machine
    }

    private func notes(_ effects: [LiveEffect]) -> [LiveEffect] {
        effects.filter { if case .send(.note) = $0 { true } else { false } }
    }

    func testSaysItOnce20SecondsAfterTheRelay() {
        var machine = relayed()
        XCTAssertTrue(machine.waitingOnReply)
        XCTAssertEqual(notes(machine.tick(now: t0 + 20.9)), [])
        XCTAssertEqual(notes(machine.tick(now: t0 + 21)), [.send(.note(note, spoken: true))])
        XCTAssertFalse(machine.waitingOnReply)
        XCTAssertEqual(notes(machine.tick(now: t0 + 45)), [], "only once per relay")
    }

    func testWaitsForTheVoiceToFinishTalking() {
        var machine = relayed()
        _ = machine.handle(.agentText("Asking the Larkspur lead now."), now: t0 + 20)
        XCTAssertEqual(notes(machine.tick(now: t0 + 21)), [])
        XCTAssertEqual(notes(machine.tick(now: t0 + 30)).count, 1)
        XCTAssertEqual(machine.phase, .listening)
    }

    func testTheReplyCancelsIt() {
        var machine = relayed()
        _ = machine.reply(title: "the Larkspur lead", summary: "Paused.", note: "(Studio, not the user:) the Larkspur lead answered: Paused.")
        XCTAssertFalse(machine.waitingOnReply)
        XCTAssertEqual(notes(machine.tick(now: t0 + 30)), [])
    }

    func testTheUsersNextRequestCancelsIt() {
        var machine = relayed()
        _ = machine.handle(.userText("And what's on my calendar?"), now: t0 + 5)
        _ = machine.tick(now: t0 + 6.5)
        XCTAssertFalse(machine.waitingOnReply)
        XCTAssertEqual(notes(machine.tick(now: t0 + 30)), [])
    }

    func testTheEndOfTheSessionCancelsIt() {
        var stopped = relayed()
        _ = stopped.stop(now: t0 + 5)
        XCTAssertFalse(stopped.waitingOnReply)
        XCTAssertEqual(stopped.tick(now: t0 + 30), [])
        var failed = relayed()
        _ = failed.fail("The connection was lost", now: t0 + 5)
        XCTAssertFalse(failed.waitingOnReply)
        var closed = relayed()
        _ = closed.handle(.closed(reason: "remote_hangup"), now: t0 + 5)
        XCTAssertFalse(closed.waitingOnReply)
    }

    func testANewerRelayRestartsTheWait() {
        var machine = relayed()
        let dot = note.replacingOccurrences(of: "the Larkspur lead", with: "Dot")
        machine.waitForReply(note: dot, ms: 20_000, now: t0 + 15)
        XCTAssertEqual(notes(machine.tick(now: t0 + 21)), [])
        XCTAssertEqual(notes(machine.tick(now: t0 + 35)), [.send(.note(dot, spoken: true))])
        XCTAssertEqual(notes(machine.tick(now: t0 + 60)), [])
    }

    func testDecodesWaitForAndTheIdentity() throws {
        let tool = try JSONDecoder().decode(VoiceLiveToolResult.self, from: Data(#"{"output":"Sent to Dot.","waitFor":{"title":"Dot","ms":20000,"note":"Still waiting on Dot."}}"#.utf8))
        XCTAssertEqual(tool.waitFor?.ms, 20_000)
        XCTAssertEqual(tool.waitFor?.title, "Dot")
        XCTAssertNil(try JSONDecoder().decode(VoiceLiveToolResult.self, from: Data(#"{"output":"ok"}"#.utf8)).waitFor)
        let start = try JSONDecoder().decode(VoiceLiveStart.self, from: Data(#"{"sessionId":"vl_0123456789abcdef","identity":{"kind":"thread","label":"Larkspur launch","name":"Larkspur launch","threadId":"thr_k"}}"#.utf8))
        XCTAssertEqual(start.identity?.label, "Larkspur launch")
        XCTAssertEqual(start.identity?.kind, .thread)
    }
}

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
        reports.compactMap { if case .transcript(let role, let text, _, _, _) = $0 { return "\(role.rawValue): \(text)" } else { return nil } }
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
        XCTAssertEqual(machine.phase, .agentSpeaking, "a phrase pause doesn't end the line")
        _ = machine.tick(now: t0 + 5.5)
        XCTAssertEqual(machine.phase, .listening)
        XCTAssertEqual(machine.subtitle?.text, "Two things need you.")
        XCTAssertEqual(transcripts(machine.drain()), ["agent: Two things need you."])
    }

    func testBargeInSilencesTheVoiceAtOnceAndTellsTheModelWhereItWasCutOff() {
        var machine = live()
        _ = machine.handle(.agentText("The Larkspur lead says the fetcher"), now: t0 + 1)
        XCTAssertEqual(machine.phase, .agentSpeaking)
        let effects = machine.handle(.userText("Stop, "), now: t0 + 1.2)
        XCTAssertEqual(effects.first, .muteAgentAudio(true), "playback stops before anything else")
        XCTAssertEqual(effects.last, .send(.note(LiveSessionMachine.interruptedNote("The Larkspur lead says the fetcher"), spoken: false)))
        XCTAssertTrue(LiveSessionMachine.interruptedNote("The Larkspur lead says the fetcher").contains("They heard up to: \"The Larkspur lead says the fetcher\""))
        XCTAssertEqual(machine.phase, .userSpeaking)
        XCTAssertTrue(machine.agentMuted)
        XCTAssertEqual(machine.interruptions, 1)
        // The rest of the cut-off reply is ignored while the user talks.
        XCTAssertEqual(machine.handle(.agentText(" is paused until Monday."), now: t0 + 1.3), [])
        XCTAssertEqual(machine.subtitle?.speaker, .user)
        _ = machine.handle(.userText("what about the other one?"), now: t0 + 1.5)
        _ = machine.tick(now: t0 + 2.6)
        let reports = machine.drain()
        XCTAssertTrue(reports.contains(.interrupted(heard: "The Larkspur lead says the fetcher", atMs: LiveSessionMachine.ms(t0 + 1.2))))
        XCTAssertEqual(transcripts(reports), ["agent: The Larkspur lead says the fetcher", "user: Stop, what about the other one?"])
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
        _ = machine.handle(.agentText("Send to the Larkspur lead: pause the eBay fetcher until Monday."), now: t0 + 1)
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

    func testARelayShowsSentAtOnceWithNoQuestion() {
        var machine = live()
        let effects = machine.toolFinished(callId: "c1", name: "send_to_thread", output: VoiceLiveDemo.sentOutput)
        XCTAssertEqual(effects, [.send(.toolResult(callId: "c1", output: VoiceLiveDemo.sentOutput)), .earcon(.sent)])
        XCTAssertNil(machine.confirmation, "relays don't wait for a yes")
        XCTAssertEqual(machine.card, LiveToolCard(kind: .sent, title: "Sent to the Larkspur lead", detail: ""))
    }

    func testOnlyDestructiveActionsWaitForAYes() {
        var machine = live()
        _ = machine.toolFinished(callId: "c1", name: "loops_act", output: VoiceLiveDemo.dropOutput)
        XCTAssertEqual(machine.confirmation, "Drop the loop 'Remove the stale Tailscale node'? Say yes to drop.")
        XCTAssertNil(machine.card)
        // Studio didn't hear the yes: still waiting.
        _ = machine.toolFinished(callId: "c2", name: "confirm", output: "Studio didn't hear a clear yes (it heard \"hmm\"), so nothing was done.")
        XCTAssertNotNil(machine.confirmation)
        let done = machine.toolFinished(callId: "c3", name: "confirm", output: "Dropped the loop 'Remove the stale Tailscale node'. Say that briefly.")
        XCTAssertTrue(done.contains(.earcon(.sent)))
        XCTAssertNil(machine.confirmation)
        XCTAssertEqual(machine.card, LiveToolCard(kind: .loop, title: "Dropped the loop 'Remove the stale Tailscale node'.", detail: ""))
        // Loop actions that aren't destructive just happen, with undo.
        _ = machine.toolFinished(callId: "c4", name: "loops_act", output: #"Snoozed "Renew the domain" to tonight. Say that briefly, and that they can say "undo" in the next 10 seconds (action a_1)."#)
        XCTAssertNil(machine.confirmation)
        XCTAssertEqual(machine.card?.detail, "Say “undo” to undo")
    }

    func testANoClearsTheQuestion() {
        var machine = live()
        _ = machine.toolFinished(callId: "c1", name: "stop_thread", output: VoiceLiveDemo.dropOutput)
        _ = machine.toolFinished(callId: "c2", name: "confirm", output: "The user said \"no\", so nothing was done. Ask what they'd like instead.")
        XCTAssertNil(machine.confirmation)
        XCTAssertEqual(machine.card?.title, "Not done")
    }

    func testToolCards() {
        var machine = live()
        _ = machine.toolFinished(callId: "c", name: "loops_list", output: VoiceLiveDemo.loopsOutput)
        XCTAssertEqual(machine.card, LiveToolCard(kind: .waiting, title: "2 need you", detail: "Reply to Dana about the pricing deck · Renew bbstudio.app before Friday"))
        _ = machine.toolFinished(callId: "c", name: "loops_act", output: #"Marked "Reply to Dana" done. Say that briefly, and that they can say "undo" in the next 10 seconds (action a_1)."#)
        XCTAssertEqual(machine.card, LiveToolCard(kind: .loop, title: #"Marked "Reply to Dana" done."#, detail: "Say “undo” to undo"))
        _ = machine.toolFinished(callId: "c", name: "send_email", output: "There's no tool named \"send_email\", and voice can't spend money. Offer to pass it on.")
        XCTAssertEqual(machine.card?.title, "Not by voice")
    }

    func testRepliesAreSpokenNotes() {
        var machine = live()
        let effects = machine.reply(title: "the Larkspur lead", summary: "Paused.", note: "(Studio, not the user:) the Larkspur lead answered: Paused.")
        XCTAssertEqual(effects.last, .send(.note("(Studio, not the user:) the Larkspur lead answered: Paused.", spoken: true)))
        XCTAssertEqual(machine.card?.title, "the Larkspur lead answered")
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
        XCTAssertEqual(machine.routeChanged(reason: "new_device", input: "CarAudio", output: "CarAudio", reconfigure: true, now: t0 + 31), [.reconfigureAudio], "the car connecting keeps the session")
        XCTAssertEqual(machine.routeChanged(reason: "unknown", input: "MicrophoneBuiltIn", output: "Speaker", reconfigure: false, now: t0 + 32), [], "logged only")
        let reports = machine.drain()
        XCTAssertEqual(reports.filter { if case .audioInterruption = $0 { return true } else { return false } },
                       [.audioInterruption(began: true, atMs: LiveSessionMachine.ms(t0 + 2)), .audioInterruption(began: false, atMs: LiveSessionMachine.ms(t0 + 30))])
        XCTAssertTrue(reports.contains(.routeChange(reason: "new_device", input: "CarAudio", output: "CarAudio", atMs: LiveSessionMachine.ms(t0 + 31))))
    }

    func testTheServerEndingTheSessionHangsUp() {
        var machine = live()
        let effects = machine.handle(.closed(reason: "expired"), now: t0 + 9)
        XCTAssertEqual(machine.phase, .ended("The session reached its time limit"))
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

/// What Studio is told (review findings 1 and 3): reports put back after a failure, the final usage
/// after the hang-up, and the user lines that can be the spoken yes.
final class VoiceLiveReportMachineTests: XCTestCase {
    private let t0: TimeInterval = 1_800_000_000

    private func live(_ ends: Bool) -> LiveSessionMachine {
        var machine = LiveSessionMachine(endsLinesOnPause: ends)
        _ = machine.start(now: t0)
        _ = machine.handle(.started, now: t0 + 0.5)
        return machine
    }

    private func userLines(_ reports: [LiveReport]) -> [LiveReport] {
        reports.filter { if case .transcript(.user, _, _, _, _) = $0 { return true } else { return false } }
    }

    func testReportsPutBackGoFirstInTheirOrder() {
        var machine = live(true)
        _ = machine.handle(.backendUsage(input: 1, cached: 0, output: 1), now: t0 + 1)
        _ = machine.handle(.backendUsage(input: 2, cached: 0, output: 2), now: t0 + 1)
        let failed = machine.drain()
        _ = machine.handle(.backendUsage(input: 3, cached: 0, output: 3), now: t0 + 2)
        machine.requeue(failed)
        XCTAssertEqual(machine.drain(), [.backendUsage(input: 1, cached: 0, output: 1), .backendUsage(input: 2, cached: 0, output: 2), .backendUsage(input: 3, cached: 0, output: 3)])
    }

    func testUsageAfterTheHangUpIsStillReported() {
        var machine = live(true)
        _ = machine.stop(now: t0 + 5)
        _ = machine.drain()
        _ = machine.handle(.liveUsage(seconds: 90), now: t0 + 5.2)
        _ = machine.handle(.closed(reason: "close_requested"), now: t0 + 5.2)
        _ = machine.handle(.userText("too late"), now: t0 + 5.3)
        XCTAssertEqual(machine.drain(), [.liveUsage(seconds: 90)])
    }

    func testRealtimeTheRequestTranscribedAfterTheQuestionDoesNotAnswerIt() {
        var machine = live(false)
        _ = machine.handle(.userSpeechStarted, now: t0 + 1)
        // The model calls delete before the request's transcript arrives.
        _ = machine.handle(.toolCall(callId: "c1", name: "delete_automation", arguments: "{}"), now: t0 + 3)
        _ = machine.toolFinished(callId: "c1", name: "delete_automation", output: VoiceLiveDemo.dropOutput, now: t0 + 3.5)
        _ = machine.handle(.userLine("Okay, delete the heartbeat"), now: t0 + 4)
        _ = machine.handle(.userSpeechStarted, now: t0 + 7)
        _ = machine.handle(.userLine("Yes"), now: t0 + 8)
        XCTAssertEqual(userLines(machine.drain()), [
            .transcript(role: .user, text: "Okay, delete the heartbeat", atMs: LiveSessionMachine.ms(t0 + 4), startedMs: LiveSessionMachine.ms(t0 + 1)),
            .transcript(role: .user, text: "Yes", atMs: LiveSessionMachine.ms(t0 + 8), startedMs: LiveSessionMachine.ms(t0 + 7), answers: "d_5f2a91c0"),
        ])
        let object = LiveReport.transcript(role: .user, text: "Yes", atMs: 8, startedMs: 7, answers: "d_5f2a91c0").object
        XCTAssertEqual(object["started_at"] as? Int, 7)
        XCTAssertEqual(object["answers"] as? String, "d_5f2a91c0")
        XCTAssertNil(LiveReport.transcript(role: .agent, text: "Hi", atMs: 5).object["started_at"])
    }

    func testGPTLiveALineStartsWhenTheMicFirstHeardIt() {
        var machine = live(true)
        _ = machine.micLevels((0..<50).map { (level: Float(0.1), at: t0 + 1 + Double($0) * 0.02) }, playback: 0)
        _ = machine.handle(.toolCall(callId: "c1", name: "delete_automation", arguments: "{}"), now: t0 + 2.5)
        _ = machine.toolFinished(callId: "c1", name: "delete_automation", output: VoiceLiveDemo.dropOutput, now: t0 + 3)
        _ = machine.handle(.userText("Okay delete it"), now: t0 + 3.5)
        _ = machine.tick(now: t0 + 5)
        _ = machine.handle(.userText("Yes"), now: t0 + 8)
        _ = machine.tick(now: t0 + 10)
        XCTAssertEqual(userLines(machine.drain()), [
            .transcript(role: .user, text: "Okay delete it", atMs: LiveSessionMachine.ms(t0 + 5), startedMs: LiveSessionMachine.ms(t0 + 1)),
            .transcript(role: .user, text: "Yes", atMs: LiveSessionMachine.ms(t0 + 10), startedMs: LiveSessionMachine.ms(t0 + 8), answers: "d_5f2a91c0"),
        ])
    }

    func testOnceTheQuestionIsSettledLaterLinesAnswerNothing() {
        var machine = live(false)
        _ = machine.toolFinished(callId: "c1", name: "delete_automation", output: VoiceLiveDemo.dropOutput, now: t0 + 1)
        _ = machine.toolFinished(callId: "c2", name: "cancel", output: "Cancelled; nothing was done.", now: t0 + 2)
        _ = machine.handle(.userLine("Yes"), now: t0 + 3)
        XCTAssertEqual(userLines(machine.drain()), [.transcript(role: .user, text: "Yes", atMs: LiveSessionMachine.ms(t0 + 3), startedMs: LiveSessionMachine.ms(t0 + 3))])
    }
}

/// The controller keeps what Studio didn't get, hangs up after 30 s without Studio and retries the end
/// (review findings 1 and 2).
@MainActor
final class VoiceLiveReportControllerTests: XCTestCase {
    private final class FlakyStudio: VoiceLiveStudio {
        var events: [[LiveReport]] = []
        var ended: [[LiveReport]] = []
        var tools: [[LiveReport]] = []
        var failEvents = 0
        var failEnds = 0
        var failTools = 0
        struct Offline: Error {}
        func voiceLiveState() async throws -> VoiceLiveState { VoiceLiveState(ready: true, model: .gpt_live_1) }
        func voiceLiveStart(model: String?, sdp: String?, threadId: String?) async throws -> VoiceLiveStart {
            VoiceLiveStart(sessionId: "vl_0123456789abcdef", transport: .live_webrtc, answerSdp: "v=0 fake answer")
        }
        func voiceLiveTool(sessionId: String, name: String, arguments: String, reports: [LiveReport]) async throws -> VoiceLiveToolResult {
            tools.append(reports)
            if failTools > 0 { failTools -= 1; throw Offline() }
            return VoiceLiveToolResult(output: "ok")
        }
        func voiceLiveEvent(sessionId: String, reports: [LiveReport]) async throws -> Studio.VoiceLiveEventOutput {
            events.append(reports)
            if failEvents > 0 { failEvents -= 1; throw Offline() }
            return Studio.VoiceLiveEventOutput()
        }
        func voiceLivePoll(sessionId: String) async throws -> [VoiceLiveReply] { [] }
        func voiceLiveEnd(sessionId: String, reports: [LiveReport]) async throws {
            ended.append(reports)
            if failEnds > 0 { failEnds -= 1; throw Offline() }
        }
    }

    private var studio: FlakyStudio!
    private var peer: FakePeer!

    private func live() async throws -> VoiceLiveController {
        studio = FlakyStudio()
        peer = FakePeer()
        let audio = VoiceLiveAudio(session: FakeAudioSession(), rtc: FakeRTCAudio(), permission: { true })
        audio.deactivateDelays = [0, 10, 10, 10]
        let peer = peer!
        let controller = VoiceLiveController(studio: studio, audio: audio, makePeer: { peer })
        // The tests call sync themselves.
        controller.syncEvery = .seconds(3600)
        controller.endRetries = [.milliseconds(1), .milliseconds(1), .milliseconds(1)]
        controller.start()
        try await until { self.peer.onMessage != nil }
        peer.onMessage?(Data(#"{"type":"session.started"}"#.utf8))
        try await until { controller.phase == .listening }
        return controller
    }

    private func until(_ condition: @escaping () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<150 where !condition() { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertTrue(condition(), "timed out", file: file, line: line)
    }

    private func usage(_ index: Int) {
        peer.onMessage?(Data(#"{"type":"response.done","response":{"usage":{"input_tokens":\#(index)}}}"#.utf8))
    }

    private func inputs(_ reports: [LiveReport]) -> [Int] {
        reports.compactMap { report in
            guard case .realtimeUsage(let json) = report,
                  let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { return nil }
            return (object["input_tokens"] as? NSNumber)?.intValue
        }
    }

    func testAFailedSyncKeepsItsReportsAndTheNextSendsThemInOrderAtMost200AtATime() async throws {
        let controller = try await live()
        for index in 0..<150 { usage(index) }
        studio.failEvents = 1
        await controller.sync()
        for index in 150..<250 { usage(index) }
        studio.events = []
        await controller.sync()
        XCTAssertEqual(studio.events.map(\.count), [200, 50])
        XCTAssertEqual(inputs(studio.events.flatMap { $0 }), Array(0..<250))
        XCTAssertTrue(controller.isLive)
        controller.stop()
        try await until { !self.studio.ended.isEmpty }
    }

    func testTenFailedSyncsInARowHangUpSayingWhy() async throws {
        let controller = try await live()
        usage(7)
        studio.failEvents = 100
        for _ in 0..<9 { await controller.sync() }
        XCTAssertTrue(controller.isLive)
        await controller.sync()
        XCTAssertEqual(controller.phase, .failed(VoiceLiveController.lostStudio))
        try await until { !self.studio.ended.isEmpty }
        // The end carries what never got through.
        XCTAssertEqual(inputs(studio.ended[0]), [7])
    }

    func testTheEndIsRetriedWithTheSameReports() async throws {
        let controller = try await live()
        usage(1)
        studio.failEnds = 2
        controller.stop()
        try await until { self.studio.ended.count == 3 }
        XCTAssertEqual(studio.ended[2], studio.ended[0])
        XCTAssertEqual(inputs(studio.ended[0]), [1])
    }

    func testTheFinalUsageAfterSessionCloseGoesWithTheEnd() async throws {
        let controller = try await live()
        controller.stop()
        // GPT-Live answers session.close with the session's final seconds.
        peer.onMessage?(Data(#"{"type":"session.closed","reason":"close_requested","usage":{"seconds":90}}"#.utf8))
        try await until { !self.studio.ended.isEmpty }
        XCTAssertTrue(studio.ended[0].contains(.liveUsage(seconds: 90)), "\(studio.ended[0])")
    }

    func testAFailedToolCallPutsItsLinesBack() async throws {
        let controller = try await live()
        studio.failTools = 1
        peer.onMessage?(Data(#"{"type":"session.input_transcript.delta","delta":"What's waiting?"}"#.utf8))
        peer.onMessage?(Data(#"{"type":"response.event","event":{"type":"response.output_item.done","item":{"type":"function_call","call_id":"c1","name":"loops_list","arguments":"{}"}}}"#.utf8))
        try await until { !self.studio.tools.isEmpty }
        try await Task.sleep(for: .milliseconds(50))
        await controller.sync()
        XCTAssertTrue(studio.events.flatMap { $0 }.contains { if case .transcript(.user, "What's waiting?", _, _, _) = $0 { return true } else { return false } }, "\(studio.events)")
        controller.stop()
        try await until { !self.studio.ended.isEmpty }
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

/// Barge-in by level (BargeInGate) and the machine's provisional mute.
final class VoiceLiveBargeInGateTests: XCTestCase {
    private let t0: TimeInterval = 1_800_000_000

    /// `level` every 20 ms from `start` for `seconds`.
    private func feed(_ gate: inout BargeInGate, level: Float, playback: Float, playing: Bool = true, from start: TimeInterval, seconds: TimeInterval) -> TimeInterval? {
        var at = start
        while at < start + seconds {
            if gate.feed(level: level, playback: playback, voicePlaying: playing, at: at) { return at }
            at += 0.02
        }
        return nil
    }

    func testSustainedSpeechTriggersAfterTheMinimumDuration() {
        var gate = BargeInGate()
        let fired = feed(&gate, level: 0.15, playback: 0.1, from: t0, seconds: 1)
        XCTAssertNotNil(fired)
        XCTAssertEqual(fired! - t0, 0.25, accuracy: 0.021)
    }

    func testABriefSpikeDoesNot() {
        var gate = BargeInGate()
        XCTAssertNil(feed(&gate, level: 0.3, playback: 0.1, from: t0, seconds: 0.08), "a click or a bump")
        XCTAssertNil(feed(&gate, level: 0, playback: 0.1, from: t0 + 0.08, seconds: 0.1))
        XCTAssertNil(feed(&gate, level: 0.3, playback: 0.1, from: t0 + 0.18, seconds: 0.08), "the count starts again after a dip")
        var before = BargeInGate.before
        XCTAssertNotNil(feed(&before, level: 0.3, playback: 0.1, from: t0 + 1, seconds: 0.2), "the old gate fired on 200 ms")
        gate.reset()
        XCTAssertNil(feed(&gate, level: 0.3, playback: 0.1, from: t0 + 1, seconds: 0.2), "a door, a laugh: 200 ms isn't talking")
    }

    func testTheVoicesOwnEchoDoesNotTriggerIt() {
        var gate = BargeInGate()
        // What's left after echo cancellation: up to half the playback level.
        for playback: Float in [0.05, 0.1, 0.2, 0.4] {
            XCTAssertNil(feed(&gate, level: playback * 0.45, playback: playback, from: t0, seconds: 2), "echo at playback \(playback)")
        }
        // On the speaker, more is left: 65% of the playback. The old bar (half plus 0.02) let it through.
        for playback: Float in [0.25, 0.4] {
            var before = BargeInGate.before
            XCTAssertNotNil(feed(&before, level: playback * 0.65, playback: playback, from: t0, seconds: 2), "old gate, speaker echo at \(playback)")
            XCTAssertNil(feed(&gate, level: playback * 0.65, playback: playback, from: t0, seconds: 2), "speaker echo at \(playback)")
        }
        // The user over the echo does.
        XCTAssertNotNil(feed(&gate, level: 0.4 * 0.45 + 0.15, playback: 0.4, from: t0 + 10, seconds: 1))
    }

    func testTheBarIsHigherWhileTheVoicePlays() {
        let gate = BargeInGate()
        XCTAssertEqual(gate.threshold(playback: 0, voicePlaying: false), 0.02)
        XCTAssertEqual(gate.threshold(playback: 0, voicePlaying: true), 0.06)
        XCTAssertEqual(gate.threshold(playback: 0.2, voicePlaying: true), 0.16, accuracy: 0.0001)
        XCTAssertEqual(BargeInGate.before.threshold(playback: 0, voicePlaying: true), 0.035)
        XCTAssertEqual(BargeInGate.before.threshold(playback: 0.2, voicePlaying: true), 0.12, accuracy: 0.0001)
        var quiet = BargeInGate()
        XCTAssertNotNil(feed(&quiet, level: 0.03, playback: 0, playing: false, from: t0, seconds: 1), "a quiet line takes a softer voice")
        var playing = BargeInGate()
        XCTAssertNil(feed(&playing, level: 0.03, playback: 0, from: t0, seconds: 1))
        XCTAssertNil(feed(&playing, level: 0.05, playback: 0, from: t0 + 2, seconds: 1), "room noise under the new floor")
    }

    // MARK: The machine

    private func speaking() -> LiveSessionMachine {
        var machine = LiveSessionMachine(endsLinesOnPause: true)
        _ = machine.start(now: t0)
        _ = machine.handle(.started, now: t0 + 0.1)
        _ = machine.handle(.agentText("First, reply to Dana about the pricing deck, then renew the domain"), now: t0 + 1)
        XCTAssertEqual(machine.phase, .agentSpeaking)
        return machine
    }

    private func frames(_ level: Float, from start: TimeInterval, count: Int) -> [(level: Float, at: TimeInterval)] {
        (0..<count).map { (level: level, at: start + Double($0) * 0.02) }
    }

    func testTheLevelMutesAtOnceAndWordsConfirmIt() {
        var machine = speaking()
        XCTAssertEqual(machine.micLevels(frames(0.05, from: t0 + 1.5, count: 10), playback: 0.1), [], "below the echo bar")
        XCTAssertEqual(machine.micLevels(frames(0.2, from: t0 + 2, count: 12), playback: 0.1), [], "under 250 ms: not yet")
        let effects = machine.micLevels(frames(0.2, from: t0 + 2.24, count: 2), playback: 0.1)
        XCTAssertEqual(effects, [.muteAgentAudio(true)], "muted, no note yet: words must confirm")
        XCTAssertNotNil(machine.provisionalSince)
        XCTAssertEqual(machine.provisionalSince!, t0 + 2.26, accuracy: 0.001)
        // The voice keeps sending words meanwhile; it stays muted and the turn stays open.
        XCTAssertEqual(machine.handle(.agentText(" before Friday."), now: t0 + 2.3), [])
        XCTAssertEqual(machine.tick(now: t0 + 2.6), [])
        XCTAssertEqual(machine.phase, .agentSpeaking)
        // Words within the window: a barge-in, with the note.
        let confirmed = machine.handle(.userText("Okay, stop"), now: t0 + 2.9)
        XCTAssertTrue(confirmed.contains { if case .send(.note(let text, spoken: false)) = $0 { return text.contains("interrupted") } else { return false } })
        XCTAssertNil(machine.provisionalSince)
        XCTAssertEqual(machine.phase, .userSpeaking)
        XCTAssertEqual(machine.interruptions, 1)
        XCTAssertEqual(machine.falseTriggers, 0)
        XCTAssertTrue(machine.drain().contains { if case .interrupted = $0 { return true } else { return false } })
    }

    func testMutedWhileTheUserKeepsTalkingEvenBeforeWords() {
        var machine = speaking()
        _ = machine.micLevels(frames(0.2, from: t0 + 2, count: 10), playback: 0.1)
        XCTAssertFalse(machine.agentMuted, "200 ms isn't enough")
        // GPT-Live's transcript lags ~2.4 s while the voice talks: the user is still loud at 3.5 s.
        _ = machine.micLevels(frames(0.2, from: t0 + 2.2, count: 70), playback: 0.1)
        XCTAssertEqual(machine.tick(now: t0 + 3.5), [], "still talking: stays muted")
        XCTAssertTrue(machine.agentMuted)
        // Words at 4.4 s confirm it.
        let confirmed = machine.handle(.userText("Okay, stop there"), now: t0 + 4.4)
        XCTAssertTrue(confirmed.contains { if case .send(.note(_, spoken: false)) = $0 { return true } else { return false } })
        XCTAssertEqual(machine.falseTriggers, 0)
    }

    func testNoWordsSoonLetsTheVoiceCarryOnAndIsReported() {
        var machine = speaking()
        _ = machine.micLevels(frames(0.2, from: t0 + 2, count: 15), playback: 0.1)
        // A laugh: loud for 0.3 s, then quiet.
        _ = machine.micLevels(frames(0.01, from: t0 + 2.3, count: 10), playback: 0)
        XCTAssertTrue(machine.agentMuted)
        XCTAssertEqual(machine.tick(now: t0 + 2.6), [], "still inside the window")
        XCTAssertEqual(machine.tick(now: t0 + 2.75), [.muteAgentAudio(false)], "0.4 s of quiet, not 1 s")
        XCTAssertFalse(machine.agentMuted)
        XCTAssertNil(machine.provisionalSince)
        XCTAssertEqual(machine.falseTriggers, 1)
        XCTAssertEqual(machine.interruptions, 0)
        XCTAssertEqual(machine.phase, .agentSpeaking, "the voice carries on")
        let reports = machine.drain()
        XCTAssertFalse(reports.contains { if case .interrupted = $0 { return true } else { return false } })
        XCTAssertEqual(reports, [.falseTrigger(atMs: LiveSessionMachine.ms(t0 + 2.26), mic: 0.2, playback: 0.1, mutedMs: 490)])
        let object = reports[0].object
        XCTAssertEqual(object["type"] as? String, "false_trigger")
        XCTAssertEqual(object["mic"] as? Double, 0.2)
        XCTAssertEqual(object["muted_ms"] as? Int, 490)
    }

    func testStillLoudUsesTheBarThatFired() {
        var machine = speaking()
        _ = machine.micLevels(frames(0.2, from: t0 + 2, count: 14), playback: 0.1)
        XCTAssertTrue(machine.agentMuted)
        // The voice is muted, so playback reads 0; room noise at 0.07 is over the floor but under the bar that fired (0.09).
        _ = machine.micLevels(frames(0.07, from: t0 + 2.3, count: 50), playback: 0)
        XCTAssertEqual(machine.tick(now: t0 + 2.75), [.muteAgentAudio(false)], "noise doesn't hold the voice")
    }

    func testLevelsDoNothingWhenTheVoiceIsQuiet() {
        var machine = LiveSessionMachine(endsLinesOnPause: true)
        _ = machine.start(now: t0)
        _ = machine.handle(.started, now: t0 + 0.1)
        XCTAssertEqual(machine.micLevels(frames(0.5, from: t0 + 1, count: 20), playback: 0), [], "the user just talking isn't a barge-in")
        XCTAssertNil(machine.provisionalSince)
    }

    func testTheTranscriptAloneStillBargesInWithoutLevels() {
        var machine = speaking()
        let effects = machine.handle(.userText("Wait"), now: t0 + 2)
        XCTAssertEqual(effects.first, .muteAgentAudio(true))
        XCTAssertEqual(machine.phase, .userSpeaking)
    }
}
