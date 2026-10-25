import XCTest
@testable import BBStudio

/// Ports of Studio's voice text tests (instructions.test.ts, chunks.test.ts,
/// read-along.test.ts), plus the phone's own pieces of voice mode.
final class VoiceTextTests: XCTestCase {
    // MARK: speakable

    func testSpeakableReducesMarkdownToWords() {
        XCTAssertEqual(
            Speakable.text("## Done\n\n- **Two** tests fail in `auth`.\n- See [the log](https://x.y/z)."),
            "Done\nTwo tests fail in auth.\nSee the log.")
    }

    func testSpeakableLeavesOutDirectivesAndComments() {
        XCTAssertEqual(
            Speakable.text("Done.\n\n::page{id=\"pg_1\"}\n\n::next{reply=\"👍 Ship it|🧪 Add tests\" btw=\"🐛 I noticed {x}\"}"),
            "Done.")
        XCTAssertEqual(Speakable.text("See the card ::design{id=\"dsn_1\"} above.<!-- note -->"), "See the card above.")
    }

    func testSpeakableLeavesCodeOutAndPlainSpeechAsIs() {
        XCTAssertEqual(Speakable.text("Here it is:\n```ts\nconst a = 1;\n```\nWant more?"), "Here it is:\n (code left out) \nWant more?")
        XCTAssertEqual(
            Speakable.text("It took about six minutes, and nothing needs you."),
            "It took about six minutes, and nothing needs you.")
    }

    func testSpeakableStripsEmphasisListsQuotesAndTables() {
        XCTAssertEqual(Speakable.text("1. _First_ step\n2) ~~old~~ new"), "First step\nold new")
        XCTAssertEqual(Speakable.text("> Quoted line"), "Quoted line")
        XCTAssertEqual(Speakable.text("| a | b |"), "a b")
        XCTAssertEqual(Speakable.text("![chart](x.png) Look"), "Look")
    }

    // MARK: speech chunks

    func testChunksKeepShortTextWhole() {
        XCTAssertEqual(SpeechChunks.split("  Done. Two tests fail.  "), ["Done. Two tests fail."])
        XCTAssertEqual(SpeechChunks.split("   "), [])
    }

    func testChunksCutAtSentenceEndsShortFirstThenLonger() {
        let sentence = "This sentence is about sixty characters long, give or take. "
        let text = String(repeating: sentence, count: 20)
        let chunks = SpeechChunks.split(text)
        XCTAssertLessThanOrEqual(chunks[0].utf16.count, 200)
        XCTAssertTrue(chunks.dropFirst().allSatisfy { $0.utf16.count <= 600 })
        XCTAssertGreaterThan(chunks[1].count, chunks[0].count)
        XCTAssertTrue(chunks.allSatisfy { $0.hasSuffix("take.") })
        XCTAssertEqual(chunks.joined(separator: " "), text.trimmingCharacters(in: .whitespaces))
    }

    func testChunksCutASentenceWithNoEndAtCommasThenSpaces() {
        let long = (0..<60).map { "item \($0)" }.joined(separator: ", ")
        let chunks = SpeechChunks.split(long)
        XCTAssertGreaterThan(chunks.count, 1)
        XCTAssertLessThanOrEqual(chunks[0].utf16.count, 200)
        XCTAssertTrue(chunks[0].hasSuffix(","))
        XCTAssertEqual(chunks.joined(separator: " ").replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression), long)
    }

    func testChunksTreatLineBreaksAsSentenceEnds() {
        XCTAssertEqual(SpeechChunks.split("First line\nSecond line"), ["First line Second line"])
    }

    func testChunksCutAWordlessRunAtTheMaximum() {
        let run = String(repeating: "a", count: 450)
        XCTAssertEqual(SpeechChunks.split(run).map(\.count), [200, 251])
    }

    // MARK: composer and payloads

    func testJoinPutsWhatWasSaidAfterWhatWasTyped() {
        XCTAssertEqual(VoiceText.join(typed: "", heard: "hello"), "hello")
        XCTAssertEqual(VoiceText.join(typed: "  ", heard: "hello"), "hello")
        XCTAssertEqual(VoiceText.join(typed: "Note:", heard: "hello"), "Note: hello")
        XCTAssertEqual(VoiceText.join(typed: "Note: ", heard: "hello"), "Note: hello")
        XCTAssertEqual(VoiceText.join(typed: "Note", heard: ""), "Note")
    }

    func testSpeedStepsAndWrapsAround() {
        XCTAssertEqual(VoiceText.nextSpeed(after: 1), 1.25)
        XCTAssertEqual(VoiceText.nextSpeed(after: 1.6), 1.75)
        XCTAssertEqual(VoiceText.nextSpeed(after: 2), 1)
        XCTAssertEqual(VoiceText.nextSpeed(after: 2.5), 1)
        XCTAssertEqual(VoiceText.speedLabel(1.25), "1.25×")
        XCTAssertEqual(VoiceText.speedLabel(2), "2×")
        XCTAssertEqual(VoicePlayer.clamp(2.5), 2)
        XCTAssertEqual(VoicePlayer.clamp(0.25), 0.5)
    }

    func testSpeechURLsResolveAgainstTheServer() {
        let base = URL(string: "https://mac.tail.ts.net")!
        XCTAssertEqual(
            SpeechURL.resolve("/api/v1/plugins/studio/http/speech/audio?key=abc", against: base)?.absoluteString,
            "https://mac.tail.ts.net/api/v1/plugins/studio/http/speech/audio?key=abc")
        XCTAssertEqual(
            SpeechURL.resolve("http://other:1/a.mp3", against: base)?.absoluteString, "http://other:1/a.mp3")
    }

    func testVoiceSignalDecodes() throws {
        let payload = try JSONDecoder().decode(JSONValue.self, from: Data("""
            {"threadId":"thr_v","text":"Hi there.","urls":["/a?key=1","/a?key=2"],"pieces":["Hi","there."]}
            """.utf8))
        XCTAssertEqual(VoiceSpoken(payload), VoiceSpoken(threadId: "thr_v", text: "Hi there.", urls: ["/a?key=1", "/a?key=2"], pieces: ["Hi", "there."]))
        let problem = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"threadId":"thr_v","text":"x","urls":[],"pieces":[],"problem":"No key"}"#.utf8))
        XCTAssertEqual(VoiceSpoken(problem)?.problem, "No key")
        XCTAssertNil(VoiceSpoken(.object([:])))
    }

    func testSendCarriesTheAgentOnlyNote() {
        let input = BBClient.input("Hello", [], [], agentNote: VoiceText.turnNote)
        XCTAssertEqual(input, [
            ["type": "text", "text": "Hello", "mentions": []],
            ["type": "text", "text": .string(VoiceText.turnNote), "mentions": [], "visibility": "agent-only"],
        ])
        XCTAssertEqual(BBClient.input("Hello", []), [["type": "text", "text": "Hello", "mentions": []]])
    }

    func testVoiceNewAndUpdateBodies() {
        XCTAssertEqual(VoiceRequests.new(projectId: nil), .object([:]))
        XCTAssertEqual(VoiceRequests.new(projectId: "proj_1"), ["projectId": "proj_1"])
        XCTAssertEqual(VoiceRequests.update(speed: 1.5), ["speed": 1.5])
        XCTAssertEqual(VoiceRequests.set("thr_1", on: true), ["threadId": "thr_1", "on": true])
    }

    // MARK: dictation

    func testVoiceSegmentsAreShort() {
        XCTAssertEqual(SegmentPolicy.voice, SegmentPolicy(targetMs: 2500, maxMs: 8000, pauseMs: 300))
        XCTAssertFalse(SegmentPolicy.voice.shouldCut(elapsedMs: 2000, quietMs: 1000))
        XCTAssertTrue(SegmentPolicy.voice.shouldCut(elapsedMs: 2600, quietMs: 300))
        XCTAssertFalse(SegmentPolicy.voice.shouldCut(elapsedMs: 2600, quietMs: 200))
        XCTAssertTrue(SegmentPolicy.voice.shouldCut(elapsedMs: 8000, quietMs: 0))
        // Talk's own recordings keep their long segments.
        XCTAssertFalse(SegmentPolicy.talk.shouldCut(elapsedMs: 8000, quietMs: 1000))
    }

    func testLiveTranscriptJoinsSegmentsSoFar() throws {
        let json = """
            {"recording":{"id":"rec_1","title":"t","titleSource":"user","kind":"dictation","status":"recording","projectId":null,
              "threadId":null,"createdAt":1,"updatedAt":2,"endedAt":null,"durationMs":5000,"segmentCount":3,"pendingCount":1,
              "failedCount":0,"wordCount":4,"preview":"Turn on","archived":false,"audioRemoved":false,"meetingNotes":null},
             "segments":[
              {"id":"s-0","sessionId":"s","status":"done","text":" Turn on "},
              {"id":"s-1","sessionId":"s","status":"done","text":"the lights."},
              {"id":"s-2","sessionId":"s","status":"pending","text":null}]}
            """
        let detail = try JSONDecoder().decode(RecordingDetail.self, from: Data(json.utf8))
        XCTAssertEqual(detail.transcript, "Turn on the lights.")
        XCTAssertEqual(VoiceText.join(typed: "Please", heard: detail.transcript), "Please Turn on the lights.")
    }

    // MARK: read-along

    func testReadAlongFindsAPieceIgnoringMarkdownAndCase() {
        let text = "## Done\n\n**Two** tests fail in `auth`. See the log."
        let letters = ReadAlong.letters(text)
        let span = try? XCTUnwrap(ReadAlong.span(of: "Two tests fail in auth.", in: letters))
        XCTAssertEqual(span, 4..<22)
        XCTAssertNil(ReadAlong.span(of: "Nothing like it", in: letters))
        XCTAssertTrue(ReadAlong.contains(text, piece: "see the LOG"))
    }

    func testReadAlongPrefersTheLastPlaceThePieceStarts() {
        let letters = ReadAlong.letters("Yes. Later: yes.")
        XCTAssertEqual(ReadAlong.span(of: "Yes.", in: letters), 8..<11)
    }

    func testReadAlongMapsLettersBackToCharacters() {
        let text = "Two tests, fail."
        let range = ReadAlong.characterRange(in: text, letters: 3..<12)
        XCTAssertEqual(range.map { String(Array(text)[$0]) }, "tests, fail")
    }

    func testReadAlongSpansParagraphs() {
        let match = ReadAlong.Match(piece: "Done. Two tests fail.", texts: ["Intro.", "Done.", "Two tests fail.", "After."])
        XCTAssertEqual(match?.ranges, [1: 0..<4, 2: 0..<14])
    }
}

// MARK: The player

@MainActor
private final class FakeClip: SpeechClip {
    let url: URL
    var rate: Float = 1
    var level: Float = 0.5
    private(set) var played = false
    private(set) var stopped = false
    private var ended = false
    private var waiting: CheckedContinuation<Void, Never>?

    init(_ url: URL) { self.url = url }

    func play() throws { played = true }

    func stop() {
        stopped = true
        end()
    }

    /// The piece played to its end.
    func end() {
        ended = true
        waiting?.resume()
        waiting = nil
    }

    func finished() async throws {
        if ended { return }
        await withCheckedContinuation { waiting = $0 }
    }
}

@MainActor
private final class FakeBackend: SpeechBackend {
    var clips: [FakeClip] = []
    var failing: Set<URL> = []
    var speakingChanges: [Bool] = []

    func load(_ url: URL) async throws -> SpeechClip {
        if failing.contains(url) { throw BBError(status: 502, message: "engine down") }
        let clip = FakeClip(url)
        clips.append(clip)
        return clip
    }

    func speaking(_ on: Bool) { speakingChanges.append(on) }

    func clip(_ url: URL) -> FakeClip? { clips.first { $0.url == url } }
}

@MainActor
final class VoicePlayerTests: XCTestCase {
    private let a = URL(string: "https://bb.test/audio?key=a")!
    private let b = URL(string: "https://bb.test/audio?key=b")!
    private let c = URL(string: "https://bb.test/audio?key=c")!

    private func eventually(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<200 {
            if condition() { return }
            try? await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("timed out", file: file, line: line)
    }

    func testPlaysPiecesInOrderAndLightsEachUp() async {
        let backend = FakeBackend()
        let player = VoicePlayer(backend: backend)
        player.setRate(1.5)
        player.play(threadId: "thr_1", urls: [a, b], pieces: ["First.", "Second."])
        XCTAssertEqual(player.phase, .loading)
        XCTAssertEqual(player.threadId, "thr_1")
        await eventually { player.phase == .speaking }
        XCTAssertEqual(player.piece, "First.")
        XCTAssertEqual(backend.clip(a)?.rate, 1.5)
        // The next piece loads while this one plays.
        await eventually { backend.clip(b) != nil }
        XCTAssertEqual(backend.clip(b)?.played, false)
        backend.clip(a)?.end()
        await eventually { player.piece == "Second." }
        XCTAssertEqual(backend.clip(b)?.played, true)
        backend.clip(b)?.end()
        await eventually { player.phase == .idle }
        XCTAssertNil(player.threadId)
        XCTAssertNil(player.piece)
        XCTAssertEqual(backend.speakingChanges, [true, false])
    }

    func testANewReplyCutsOffTheOld() async {
        let backend = FakeBackend()
        let player = VoicePlayer(backend: backend)
        player.play(threadId: "thr_1", urls: [a, b], pieces: ["Old.", "Old two."])
        await eventually { backend.clip(a)?.played == true }
        player.play(threadId: "thr_2", urls: [c], pieces: ["New."])
        XCTAssertEqual(backend.clip(a)?.stopped, true)
        await eventually { backend.clip(c)?.played == true }
        XCTAssertEqual(player.threadId, "thr_2")
        XCTAssertEqual(player.piece, "New.")
        // The old reply's next piece never plays.
        try? await Task.sleep(for: .milliseconds(30))
        XCTAssertNotEqual(backend.clip(b)?.played, true)
        // Speaking stays on across the switch: the session isn't dropped between replies.
        XCTAssertFalse(backend.speakingChanges.contains(false))
    }

    func testTheSameReplyIsntPlayedTwice() async {
        let backend = FakeBackend()
        let player = VoicePlayer(backend: backend)
        player.play(threadId: "thr_1", urls: [a], pieces: ["Hi."])
        await eventually { backend.clip(a) != nil }
        player.play(threadId: "thr_1", urls: [a], pieces: ["Hi."])
        try? await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(backend.clips.count, 1)
        XCTAssertEqual(backend.clip(a)?.stopped, false)
    }

    func testStopEndsEverything() async {
        let backend = FakeBackend()
        let player = VoicePlayer(backend: backend)
        player.play(threadId: "thr_1", urls: [a, b], pieces: ["One.", "Two."])
        await eventually { player.phase == .speaking }
        player.stop()
        XCTAssertEqual(player.phase, .idle)
        XCTAssertEqual(backend.clip(a)?.stopped, true)
        XCTAssertEqual(backend.speakingChanges, [true, false])
        try? await Task.sleep(for: .milliseconds(30))
        XCTAssertNotEqual(backend.clip(b)?.played, true)
        XCTAssertNil(player.error)
    }

    func testAFailedPieceStopsWithAnError() async {
        let backend = FakeBackend()
        backend.failing = [a]
        let player = VoicePlayer(backend: backend)
        player.play(threadId: "thr_1", urls: [a], pieces: ["One."])
        await eventually { player.phase == .idle }
        XCTAssertEqual(player.error, "Couldn't play the reply: engine down")
    }

    func testReadAloudPreparesPiecesAndAgainStops() async {
        let backend = FakeBackend()
        let player = VoicePlayer(backend: backend)
        let text = "**Short** answer. " + String(repeating: "More words here. ", count: 20)
        let expected = SpeechChunks.split(Speakable.text(text))
        XCTAssertGreaterThan(expected.count, 1)
        player.readAloud(threadId: "thr_1", rowId: "row_1", text: text) { piece in
            URL(string: "https://bb.test/audio?text=\(piece.count)-\(expected.firstIndex(of: piece) ?? -1)")!
        }
        await eventually { player.phase == .speaking }
        XCTAssertEqual(player.piece, expected[0])
        XCTAssertTrue(player.piece?.hasPrefix("Short answer.") == true)
        XCTAssertTrue(player.isReading("row_1"))
        XCTAssertEqual(player.rowId, "row_1")
        // Read aloud again while it reads: stop.
        let other = a
        player.readAloud(threadId: "thr_1", rowId: "row_1", text: text) { _ in other }
        XCTAssertEqual(player.phase, .idle)
        XCTAssertFalse(player.isReading("row_1"))
    }

    func testRateChangesTheClipPlaying() async {
        let backend = FakeBackend()
        let player = VoicePlayer(backend: backend)
        player.play(threadId: "thr_1", urls: [a], pieces: ["One."])
        await eventually { player.phase == .speaking }
        player.setRate(2)
        XCTAssertEqual(backend.clip(a)?.rate, 2)
    }

    func testSilentWaveIsAValidHeader() {
        let wave = VoiceAudioSession.silentWave()
        XCTAssertEqual(wave.count, 44 + 16_000)
        XCTAssertEqual(String(data: wave.prefix(4), encoding: .ascii), "RIFF")
        XCTAssertEqual(String(data: wave[8..<16], encoding: .ascii), "WAVEfmt ")
    }

    func testAudioTypesFromContentType() {
        XCTAssertEqual(AudioClip.fileType("audio/mpeg"), "public.mp3")
        XCTAssertEqual(AudioClip.fileType("audio/wav; codecs=1"), "com.microsoft.waveform-audio")
        XCTAssertNil(AudioClip.fileType(nil))
    }
}

@MainActor
final class ThreadVoiceTests: XCTestCase {
    func testSignalsPlayOnlyForThisThreadWithVoiceOnAndNotOverTheUser() async throws {
        ThreadVoice.startedOn.insert("thr_v")
        defer { ThreadVoice.startedOn.remove("thr_v") }
        let backend = FakeBackendPlayer()
        let voice = ThreadVoice(threadId: "thr_v", player: backend.player)
        XCTAssertTrue(voice.on, "a thread opened by a voice link is on before voice.state answers")
        voice.attach(client: BBClient(baseURL: URL(string: "https://bb.invalid")!), realtime: BBRealtime(client: BBClient(baseURL: URL(string: "https://bb.invalid")!)))
        defer { voice.detach() }

        voice.handle(VoiceSpoken(threadId: "thr_other", urls: ["/a?key=1"]))
        XCTAssertEqual(backend.player.phase, .idle)

        var listening = true
        voice.isListening = { listening }
        voice.handle(VoiceSpoken(threadId: "thr_v", urls: ["/a?key=2"]))
        XCTAssertEqual(backend.player.phase, .idle, "not over the user talking")

        listening = false
        var flashed: [String] = []
        voice.flash = { flashed.append($0) }
        voice.handle(VoiceSpoken(threadId: "thr_v", urls: [], problem: "No key."))
        XCTAssertEqual(flashed, ["Couldn't speak the reply: No key."])

        voice.handle(VoiceSpoken(threadId: "thr_v", urls: ["/api/v1/plugins/studio/http/speech/audio?key=3"], pieces: ["Hi."]))
        XCTAssertEqual(backend.player.threadId, "thr_v")
        for _ in 0..<100 where backend.backend.clips.isEmpty { try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertEqual(backend.backend.clips.first?.url.absoluteString, "https://bb.invalid/api/v1/plugins/studio/http/speech/audio?key=3")
        backend.player.stop()
    }

    func testWithoutStudioTheConversationalNoteFollowsTheSwitch() async {
        // Not attached to a server (or an older Studio): the local switch decides.
        let voice = ThreadVoice(threadId: "thr_n", player: FakeBackendPlayer().player)
        let note = await voice.agentNote()
        XCTAssertEqual(note, VoiceText.turnNote)
    }

    func testOpenVoiceThreadsKeepTheAppGoing() {
        let background = VoiceBackground()
        XCTAssertFalse(background.enteredBackground {})
        background.open("thr_v", running: true)
        XCTAssertTrue(background.hasOpenThread)
        background.close("thr_v")
        XCTAssertFalse(background.hasOpenThread)
    }
}

@MainActor
private final class FakeBackendPlayer {
    let backend = FakeBackend()
    lazy var player = VoicePlayer(backend: backend)
}
