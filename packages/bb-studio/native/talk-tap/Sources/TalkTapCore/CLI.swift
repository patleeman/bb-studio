// Command line: `bb-talk-tap <command> [--json-args '<json>']`.
//
//   --version                 print the version
//   apps                      {"apps":[{bundleId,name,pid,playing}]}; no permission needed
//   permission                {"audioCapture":"granted"|"denied"|"undetermined"}; never prompts
//   capture --json-args '{..}' [--fake <them.wav> <me.wav>] [--fake-speed <x>]
//                             capture until {"cmd":"stop"} on stdin or stdin closes
import Foundation

public let version = "1.0.0"

public enum CLI {
    public static let usage = """
    usage: bb-talk-tap --version
           bb-talk-tap apps
           bb-talk-tap permission
           bb-talk-tap capture --json-args '<json>' [--fake <them.wav> <me.wav>] [--fake-speed <x>]
    """

    struct CaptureOptions {
        var args: CaptureArgs
        var fake: (them: String, me: String)?
        var fakeSpeed: Double = 1
    }

    static func parseCapture(_ argv: [String]) throws -> CaptureOptions {
        var json: String?
        var fake: (String, String)?
        var speed = 1.0
        var i = 0
        func value(_ name: String) throws -> String {
            i += 1
            guard i < argv.count else { throw ProtocolError("\(name) needs a value") }
            return argv[i]
        }
        while i < argv.count {
            switch argv[i] {
            case "--json-args": json = try value("--json-args")
            case "--fake":
                let them = try value("--fake")
                let me = try value("--fake")
                fake = (them, me)
            case "--fake-speed":
                guard let x = Double(try value("--fake-speed")), x > 0 else { throw ProtocolError("--fake-speed needs a positive number") }
                speed = x
            case let other: throw ProtocolError("unknown option \(other)")
            }
            i += 1
        }
        guard let json else { throw ProtocolError("capture needs --json-args") }
        return CaptureOptions(args: try CaptureArgs.parse(json), fake: fake, fakeSpeed: speed)
    }

    /// Runs a command. Capture never returns: it exits when stopped.
    public static func main(_ argv: [String]) -> Int32 {
        guard let command = argv.first else {
            FileHandle.standardError.write(Data((usage + "\n").utf8))
            return 2
        }
        switch command {
        case "--version", "version":
            print("bb-talk-tap \(version)")
            return 0
        case "apps":
            print(jsonLine(["apps": AudioProcesses.apps().map(\.json)]))
            return 0
        case "permission":
            print(jsonLine(["audioCapture": Permission.audioCapture()]))
            return 0
        case "capture":
            return capture(Array(argv.dropFirst()))
        default:
            FileHandle.standardError.write(Data((usage + "\n").utf8))
            return 2
        }
    }

    static func capture(_ argv: [String]) -> Int32 {
        let sink = StdoutSink()
        let options: CaptureOptions
        do {
            options = try parseCapture(argv)
        } catch {
            sink.emit(.error(code: .internal, message: "\(error)"))
            sink.emit(.stopped)
            return 2
        }
        let args = options.args

        let inputs: [AudioInput]
        do {
            if let fake = options.fake {
                var list: [AudioInput] = [try FakeFileInput(source: .them, path: fake.them, speed: options.fakeSpeed)]
                if args.mic { list.append(try FakeFileInput(source: .me, path: fake.me, speed: options.fakeSpeed)) }
                inputs = list
            } else {
                inputs = try LiveInputs.make(args)
            }
        } catch let error as CaptureError {
            sink.emit(.error(code: error.code, message: error.message))
            sink.emit(.stopped)
            return 1
        } catch {
            sink.emit(.error(code: .internal, message: "\(error)"))
            sink.emit(.stopped)
            return 1
        }

        let loader: (@Sendable (TranscriptionScheduler, EventSink) async -> Void)?
        switch args.stt {
        case .none: loader = nil
        case .test: loader = { scheduler, _ in scheduler.setTranscriber(DescribingTranscriber()) }
        case let .whisperKit(model, modelDir, language):
            loader = { scheduler, sink in
                await WhisperKitLoader.load(model: model, modelDir: modelDir, language: language, into: scheduler, sink: sink)
            }
        }

        let session = CaptureSession(args: args, sink: sink, inputs: inputs, transcribes: loader != nil, modelLoader: loader, onStopped: { exit(0) })
        session.stopWhenInputsEnd = options.fake != nil
        do {
            try session.start()
        } catch {
            if !(error is CaptureError) { sink.emit(.error(code: .internal, message: "\(error)")) }
            session.stop()
            dispatchMain()
        }

        let reader = Thread {
            while let line = readLine(strippingNewline: true) {
                if Command.parse(line) == .stop { break }
            }
            session.stop()
        }
        reader.name = "bb-talk-tap.stdin"
        reader.start()
        dispatchMain()
    }
}
