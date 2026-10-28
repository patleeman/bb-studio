import XCTest
@testable import TalkTapCore

final class ProtocolTests: XCTestCase {
    func testParsesFullCaptureArgs() throws {
        let args = try CaptureArgs.parse("""
        {"target":{"bundleIds":["us.zoom.xos","com.google.Chrome"]},"mic":true,"segmentDir":"/tmp/seg",
         "segmentTargetMs":8000,"segmentMaxMs":15000,
         "stt":{"kind":"whisperkit","model":"openai_whisper-large-v3-v20240930_626MB","modelDir":"/tmp/models"}}
        """)
        XCTAssertEqual(args.target, .bundleIds(["us.zoom.xos", "com.google.Chrome"]))
        XCTAssertTrue(args.mic)
        XCTAssertEqual(args.segmentDir, "/tmp/seg")
        XCTAssertEqual(args.stt, .whisperKit(model: "openai_whisper-large-v3-v20240930_626MB", modelDir: "/tmp/models", language: nil))
    }

    func testDefaults() throws {
        let args = try CaptureArgs.parse(#"{"target":{"all":true},"segmentDir":"/tmp/s","stt":{"kind":"none"}}"#)
        XCTAssertEqual(args, CaptureArgs(target: .all, mic: false, segmentDir: "/tmp/s", segmentTargetMs: 8000, segmentMaxMs: 15000, stt: .none))
        let noStt = try CaptureArgs.parse(#"{"target":{"all":true},"mic":false,"segmentDir":"/tmp/s"}"#)
        XCTAssertEqual(noStt.stt, .none)
    }

    func testRejectsBadArgs() {
        let bad = [
            #"{"target":{"all":true},"segmentDir":"relative"}"#,
            #"{"target":{},"segmentDir":"/tmp"}"#,
            #"{"target":{"bundleIds":[]},"segmentDir":"/tmp"}"#,
            #"{"target":{"all":false},"segmentDir":"/tmp"}"#,
            #"{"target":{"all":true},"segmentDir":"/tmp","segmentTargetMs":9000,"segmentMaxMs":8000}"#,
            #"{"target":{"all":true},"segmentDir":"/tmp","stt":{"kind":"cloud"}}"#,
            #"{"target":{"all":true},"segmentDir":"/tmp","stt":{"kind":"whisperkit","model":"x","modelDir":"rel"}}"#,
            #"not json"#,
        ]
        for json in bad {
            XCTAssertThrowsError(try CaptureArgs.parse(json), json)
        }
    }

    func testEventLines() {
        XCTAssertEqual(Event.started(sources: [.them, .me]).line, #"{"event":"started","sources":["them","me"]}"#)
        XCTAssertEqual(Event.level(source: .me, rms: 0.123456).line, #"{"event":"level","rms":0.1235,"source":"me"}"#)
        XCTAssertEqual(Event.level(source: .me, rms: 3).line, #"{"event":"level","rms":1,"source":"me"}"#)
        XCTAssertEqual(
            Event.segment(source: .them, index: 3, path: "/a/them-00003.wav", startMs: 100, endMs: 8200).line,
            #"{"endMs":8200,"event":"segment","index":3,"path":"/a/them-00003.wav","source":"them","startMs":100}"#
        )
        XCTAssertEqual(Event.partial(source: .them, index: 1, text: "hel\"lo").line, #"{"event":"partial","index":1,"source":"them","text":"hel\"lo"}"#)
        XCTAssertEqual(
            Event.final(source: .me, index: 0, text: "hi", startMs: 0, endMs: 900).line,
            #"{"endMs":900,"event":"final","index":0,"source":"me","startMs":0,"text":"hi"}"#
        )
        XCTAssertEqual(Event.model(progress: 0.5, stage: "download").line, #"{"event":"model","progress":0.5,"stage":"download"}"#)
        XCTAssertEqual(Event.appGone(bundleId: "us.zoom.xos").line, #"{"bundleId":"us.zoom.xos","event":"appGone"}"#)
        XCTAssertEqual(Event.error(code: .permission, message: "no").line, #"{"code":"permission","event":"error","message":"no"}"#)
        XCTAssertEqual(Event.stopped.line, #"{"event":"stopped"}"#)
    }

    func testEveryLineIsOneJSONObject() throws {
        let line = Event.final(source: .me, index: 0, text: "two\nlines", startMs: 0, endMs: 1).line
        XCTAssertFalse(line.contains("\n"))
        let object = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
        XCTAssertEqual(object?["text"] as? String, "two\nlines")
    }

    func testCommands() {
        XCTAssertEqual(Command.parse(#"{"cmd":"stop"}"#), .stop)
        XCTAssertEqual(Command.parse(#"  {"cmd":"stop"}  "#), .stop)
        XCTAssertEqual(Command.parse(#"{"cmd":"pause"}"#), .unknown)
        XCTAssertEqual(Command.parse("stop"), .unknown)
        XCTAssertNil(Command.parse("   "))
    }

    func testCaptureOptions() throws {
        let options = try CLI.parseCapture(["--json-args", #"{"target":{"all":true},"segmentDir":"/tmp/x"}"#, "--fake", "/a.wav", "/b.wav", "--fake-speed", "4"])
        XCTAssertEqual(options.fake?.them, "/a.wav")
        XCTAssertEqual(options.fake?.me, "/b.wav")
        XCTAssertEqual(options.fakeSpeed, 4)
        XCTAssertThrowsError(try CLI.parseCapture(["--fake", "/a.wav"]))
        XCTAssertThrowsError(try CLI.parseCapture(["--json-args"]))
        XCTAssertThrowsError(try CLI.parseCapture(["--bogus"]))
    }

    func testAppSortingAndMatching() {
        let apps = AudioProcesses.sortApps([
            AppEntry(bundleId: "b", name: "beta", pid: 2, playing: false),
            AppEntry(bundleId: "z", name: "Zoom", pid: 3, playing: true),
            AppEntry(bundleId: "a", name: "Alpha", pid: 1, playing: false),
        ])
        XCTAssertEqual(apps.map(\.bundleId), ["z", "a", "b"])

        let chromeHelper = AudioProcess(object: 1, pid: 10, bundleId: "com.google.Chrome.helper", isRunningOutput: true, ownerPid: 9, ownerBundleId: "com.google.Chrome")
        let webkit = AudioProcess(object: 2, pid: 11, bundleId: "com.apple.WebKit.GPU", isRunningOutput: true, ownerPid: 8, ownerBundleId: "com.apple.Safari")
        let other = AudioProcess(object: 3, pid: 12, bundleId: "com.google.Chromecast", isRunningOutput: true, ownerPid: 12, ownerBundleId: "com.google.Chromecast")
        XCTAssertTrue(AudioProcesses.matches(chromeHelper, bundleIds: ["com.google.Chrome"]))
        XCTAssertTrue(AudioProcesses.matches(webkit, bundleIds: ["com.apple.Safari"]))
        XCTAssertFalse(AudioProcesses.matches(other, bundleIds: ["com.google.Chrome"]))
        XCTAssertFalse(AudioProcesses.matches(webkit, bundleIds: ["us.zoom.xos"]))
    }
}
