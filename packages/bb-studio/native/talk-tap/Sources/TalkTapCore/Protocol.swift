// The JSON-lines protocol between bb-talk-tap and Studio's server.
// One JSON object per line on stdout; commands arrive on stdin. stderr is logs only.
import Foundation

public enum Source: String, Codable, Sendable, CaseIterable {
    case them
    case me
}

/// Arguments of `capture --json-args '<json>'`.
public struct CaptureArgs: Codable, Equatable, Sendable {
    public enum Target: Codable, Equatable, Sendable {
        case bundleIds([String])
        case all

        private enum CodingKeys: String, CodingKey { case bundleIds, all }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            if let ids = try c.decodeIfPresent([String].self, forKey: .bundleIds) {
                guard !ids.isEmpty else {
                    throw DecodingError.dataCorruptedError(forKey: .bundleIds, in: c, debugDescription: "target.bundleIds is empty")
                }
                self = .bundleIds(ids)
            } else if try c.decodeIfPresent(Bool.self, forKey: .all) == true {
                self = .all
            } else {
                throw DecodingError.dataCorrupted(.init(codingPath: c.codingPath, debugDescription: "target needs bundleIds or all:true"))
            }
        }

        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            switch self {
            case .bundleIds(let ids): try c.encode(ids, forKey: .bundleIds)
            case .all: try c.encode(true, forKey: .all)
            }
        }
    }

    public enum STT: Codable, Equatable, Sendable {
        case none
        case whisperKit(model: String, modelDir: String, language: String?)
        /// Test-only: a stand-in transcriber that describes each segment instead of recognising speech.
        case test

        private enum CodingKeys: String, CodingKey { case kind, model, modelDir, language }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            switch try c.decode(String.self, forKey: .kind) {
            case "none": self = .none
            case "whisperkit":
                self = .whisperKit(
                    model: try c.decode(String.self, forKey: .model),
                    modelDir: try c.decode(String.self, forKey: .modelDir),
                    language: try c.decodeIfPresent(String.self, forKey: .language)
                )
            case "test": self = .test
            case let kind:
                throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown stt.kind \(kind)")
            }
        }

        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            switch self {
            case .none: try c.encode("none", forKey: .kind)
            case .test: try c.encode("test", forKey: .kind)
            case let .whisperKit(model, modelDir, language):
                try c.encode("whisperkit", forKey: .kind)
                try c.encode(model, forKey: .model)
                try c.encode(modelDir, forKey: .modelDir)
                try c.encodeIfPresent(language, forKey: .language)
            }
        }
    }

    public var target: Target
    public var mic: Bool
    public var segmentDir: String
    public var segmentTargetMs: Int
    public var segmentMaxMs: Int
    public var stt: STT

    public init(target: Target, mic: Bool, segmentDir: String, segmentTargetMs: Int = 8000, segmentMaxMs: Int = 15000, stt: STT = .none) {
        self.target = target
        self.mic = mic
        self.segmentDir = segmentDir
        self.segmentTargetMs = segmentTargetMs
        self.segmentMaxMs = segmentMaxMs
        self.stt = stt
    }

    private enum CodingKeys: String, CodingKey { case target, mic, segmentDir, segmentTargetMs, segmentMaxMs, stt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        target = try c.decode(Target.self, forKey: .target)
        mic = try c.decodeIfPresent(Bool.self, forKey: .mic) ?? false
        segmentDir = try c.decode(String.self, forKey: .segmentDir)
        segmentTargetMs = try c.decodeIfPresent(Int.self, forKey: .segmentTargetMs) ?? 8000
        segmentMaxMs = try c.decodeIfPresent(Int.self, forKey: .segmentMaxMs) ?? 15000
        stt = try c.decodeIfPresent(STT.self, forKey: .stt) ?? .none
    }

    public static func parse(_ json: String) throws -> CaptureArgs {
        let args = try JSONDecoder().decode(CaptureArgs.self, from: Data(json.utf8))
        guard args.segmentDir.hasPrefix("/") else { throw ProtocolError("segmentDir must be an absolute path") }
        guard args.segmentTargetMs >= 1000, args.segmentMaxMs >= args.segmentTargetMs else {
            throw ProtocolError("need segmentTargetMs >= 1000 and segmentMaxMs >= segmentTargetMs")
        }
        if case let .whisperKit(_, modelDir, _) = args.stt, !modelDir.hasPrefix("/") {
            throw ProtocolError("stt.modelDir must be an absolute path")
        }
        return args
    }
}

public struct ProtocolError: Error, CustomStringConvertible {
    public let description: String
    public init(_ description: String) { self.description = description }
}

public enum ErrorCode: String, Sendable {
    case permission, device, model, `internal`
}

/// Everything the helper prints on stdout.
public enum Event: Equatable, Sendable {
    case started(sources: [Source])
    case level(source: Source, rms: Double)
    case segment(source: Source, index: Int, path: String, startMs: Int, endMs: Int)
    case partial(source: Source, index: Int, text: String)
    case final(source: Source, index: Int, text: String, startMs: Int, endMs: Int)
    case model(progress: Double, stage: String)
    case appGone(bundleId: String)
    case error(code: ErrorCode, message: String)
    case stopped

    public var json: [String: Any] {
        switch self {
        case let .started(sources):
            return ["event": "started", "sources": sources.map(\.rawValue)]
        case let .level(source, rms):
            return ["event": "level", "source": source.rawValue, "rms": rounded(rms, places: 4)]
        case let .segment(source, index, path, startMs, endMs):
            return ["event": "segment", "source": source.rawValue, "index": index, "path": path, "startMs": startMs, "endMs": endMs]
        case let .partial(source, index, text):
            return ["event": "partial", "source": source.rawValue, "index": index, "text": text]
        case let .final(source, index, text, startMs, endMs):
            return ["event": "final", "source": source.rawValue, "index": index, "text": text, "startMs": startMs, "endMs": endMs]
        case let .model(progress, stage):
            return ["event": "model", "progress": rounded(progress, places: 3), "stage": stage]
        case let .appGone(bundleId):
            return ["event": "appGone", "bundleId": bundleId]
        case let .error(code, message):
            return ["event": "error", "code": code.rawValue, "message": message]
        case .stopped:
            return ["event": "stopped"]
        }
    }

    public var line: String { jsonLine(json) }
}

/// A 0...1 value with a short decimal form in JSON (0.1189, not 0.11890000000000001).
func rounded(_ value: Double, places: Int) -> NSDecimalNumber {
    NSDecimalNumber(string: String(format: "%.\(places)f", min(max(value, 0), 1)), locale: Locale(identifier: "en_US_POSIX"))
}

public func jsonLine(_ object: [String: Any]) -> String {
    // sortedKeys keeps lines stable for tests; withoutEscapingSlashes keeps paths readable.
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    return String(decoding: data, as: UTF8.self)
}

/// A command read from stdin. Only `stop` exists; anything else is ignored.
public enum Command: Equatable {
    case stop
    case unknown

    public static func parse(_ line: String) -> Command? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard let object = try? JSONSerialization.jsonObject(with: Data(trimmed.utf8)) as? [String: Any] else { return .unknown }
        return object["cmd"] as? String == "stop" ? .stop : .unknown
    }
}

/// Where events go. Thread-safe; each event is one flushed line.
public protocol EventSink: AnyObject, Sendable {
    func emit(_ event: Event)
}

public final class StdoutSink: EventSink, @unchecked Sendable {
    private let lock = NSLock()
    public init() {}
    public func emit(_ event: Event) {
        let data = Data((event.line + "\n").utf8)
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardOutput.write(data)
    }
}

/// Collects events in memory (tests).
public final class MemorySink: EventSink, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [Event] = []
    public init() {}
    public func emit(_ event: Event) {
        lock.lock()
        stored.append(event)
        lock.unlock()
    }
    public var events: [Event] {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }
}

public func log(_ message: String) {
    FileHandle.standardError.write(Data("bb-talk-tap: \(message)\n".utf8))
}
