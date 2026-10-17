import AVFoundation
import Foundation
import os

private let log = Logger(subsystem: "nyc.plee.bbgo", category: "voice")

/// One piece of speech, loaded and ready to play.
@MainActor
protocol SpeechClip: AnyObject {
    var rate: Float { get set }
    /// The sound's level now, 0...1, for a meter.
    var level: Float { get }
    func play() throws
    /// Stops at once; `finished()` returns.
    func stop()
    /// Returns when the piece has played to its end or was stopped; throws when it can't play.
    func finished() async throws
}

/// Where clips come from: the network and AVFoundation in the app, fakes in tests.
@MainActor
protocol SpeechBackend: AnyObject {
    func load(_ url: URL) async throws -> SpeechClip
    /// The app is about to speak, or has stopped.
    func speaking(_ on: Bool)
}

/// The app's one voice player, like the desktop's one player per window: a new
/// reply cuts off the one speaking. Pieces play in order; while one plays, the
/// next one's audio is already downloading. Port of `Speaker` and `voicePlayer`
/// (packages/bb-studio/src/speech/speaker.ts, src/voice/ui/state.ts).
@MainActor
final class VoicePlayer: ObservableObject {
    static let shared = VoicePlayer(backend: AudioSpeechBackend())

    enum Phase: Equatable { case idle, loading, speaking }

    @Published private(set) var phase: Phase = .idle
    /// The thread whose reply is playing or loading.
    @Published private(set) var threadId: String?
    /// The message being read aloud, when it was asked for by message (Read aloud).
    @Published private(set) var rowId: String?
    /// The piece of text playing now, for read-along.
    @Published private(set) var piece: String?
    /// Playback speed; AVAudioPlayer plays 0.5× to 2×.
    @Published private(set) var rate: Double = 1
    /// The last failure, for the screen to show.
    @Published var error: String?

    private let backend: SpeechBackend
    private var run = 0
    private var current: SpeechClip?
    private var upcoming: Task<SpeechClip, Error>?
    private var sources: [Task<URL, Error>] = []
    /// The reply last started, so a second view on the same thread (or a repeated signal) doesn't start it again.
    private var lastPlayed = ""

    init(backend: SpeechBackend) {
        self.backend = backend
    }

    var isActive: Bool { phase != .idle }

    func isPlaying(in threadId: String) -> Bool { isActive && self.threadId == threadId }

    /// The playing reply's level, 0...1.
    var level: Float { phase == .speaking ? current?.level ?? 0 : 0 }

    /// Play a thread's reply from its prepared audio URLs, cutting off whatever was speaking.
    func play(threadId: String, urls: [URL], pieces: [String]) {
        let key = urls.map(\.absoluteString).joined(separator: "|")
        guard !urls.isEmpty, key != lastPlayed else { return }
        lastPlayed = key
        start(threadId: threadId, rowId: nil, sources: urls.map { url in Task { url } }, pieces: pieces)
    }

    /// Read a message aloud on request, even if it was spoken before; asking again while it reads stops it.
    func readAloud(threadId: String, rowId: String, text: String, prepare: @escaping @Sendable (String) async throws -> URL) {
        let key = "read:\(rowId):\(text)"
        if self.threadId == threadId, isActive, lastPlayed == key {
            stop()
            return
        }
        let pieces = SpeechChunks.split(Speakable.text(text))
        guard !pieces.isEmpty else { return }
        lastPlayed = key
        // Prepared together, as on desktop: the server makes each piece when it's fetched.
        start(threadId: threadId, rowId: rowId, sources: pieces.map { piece in Task { try await prepare(piece) } }, pieces: pieces)
    }

    /// Whether this message is the one being read aloud.
    func isReading(_ rowId: String) -> Bool { isActive && self.rowId == rowId }

    func stop() {
        run += 1
        finish(release: true)
    }

    /// Playback speed for every reply from now on, and the one playing.
    func setRate(_ rate: Double) {
        self.rate = rate
        current?.rate = Self.clamp(rate)
    }

    /// AVAudioPlayer's range.
    nonisolated static func clamp(_ rate: Double) -> Float { Float(min(2, max(0.5, rate))) }

    private func start(threadId: String, rowId: String?, sources: [Task<URL, Error>], pieces: [String]) {
        // Cut off what's speaking, keeping the audio session for this one.
        run += 1
        finish(release: false)
        let run = run
        self.threadId = threadId
        self.rowId = rowId
        self.sources = sources
        phase = .loading
        error = nil
        backend.speaking(true)
        Task { [weak self] in
            do {
                try await self?.playAll(sources, pieces: pieces, run: run)
            } catch {
                guard let self, run == self.run else { return }
                log.error("voice playback failed: \(error.localizedDescription, privacy: .public)")
                self.error = "Couldn't play the reply: \(error.localizedDescription)"
            }
            guard let self, run == self.run else { return }
            self.finish(release: true)
        }
    }

    private func playAll(_ sources: [Task<URL, Error>], pieces: [String], run: Int) async throws {
        var next: Task<SpeechClip, Error>? = load(sources[0])
        for index in sources.indices {
            guard let loading = next else { return }
            let clip = try await loading.value
            guard run == self.run else {
                clip.stop()
                return
            }
            // Start the next piece's audio while this one plays.
            next = index + 1 < sources.count ? load(sources[index + 1]) : nil
            upcoming = next
            current = clip
            clip.rate = Self.clamp(rate)
            try clip.play()
            phase = .speaking
            piece = pieces.indices.contains(index) ? pieces[index] : nil
            try await clip.finished()
            guard run == self.run else { return }
        }
    }

    private func load(_ source: Task<URL, Error>) -> Task<SpeechClip, Error> {
        Task { [backend] in try await backend.load(try await source.value) }
    }

    private func finish(release: Bool) {
        current?.stop()
        current = nil
        upcoming?.cancel()
        upcoming = nil
        sources.forEach { $0.cancel() }
        sources = []
        let wasActive = phase != .idle
        phase = .idle
        threadId = nil
        rowId = nil
        piece = nil
        if wasActive, release { backend.speaking(false) }
    }
}

/// Downloads each piece over HTTP and plays it with AVAudioPlayer. Studio
/// streams the audio as it's made, without a length or ranges, so the whole
/// piece comes down first; pieces are short (the first under 200 characters).
@MainActor
final class AudioSpeechBackend: SpeechBackend {
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        // Making a long piece can take a while on a slow engine.
        config.timeoutIntervalForRequest = 90
        return URLSession(configuration: config)
    }()

    func load(_ url: URL) async throws -> SpeechClip {
        var request = URLRequest(url: url)
        request.setValue("mobile", forHTTPHeaderField: "x-bb-app-surface")
        let (data, response) = try await session.data(for: request)
        let http = response as? HTTPURLResponse
        guard let http, (200..<300).contains(http.statusCode) else {
            let message = String(data: data.prefix(300), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            throw BBError(status: http?.statusCode ?? 0, message: message?.isEmpty == false ? message! : "The speech audio didn't load.")
        }
        return try AudioClip(data: data, mimeType: http.value(forHTTPHeaderField: "content-type"))
    }

    func speaking(_ on: Bool) {
        VoiceAudioSession.shared.speaking = on
    }
}

@MainActor
final class AudioClip: NSObject, SpeechClip, AVAudioPlayerDelegate {
    private let player: AVAudioPlayer
    private var continuation: CheckedContinuation<Void, Error>?
    private var done: Result<Void, Error>?

    init(data: Data, mimeType: String?) throws {
        player = try AVAudioPlayer(data: data, fileTypeHint: Self.fileType(mimeType))
        super.init()
        player.delegate = self
        player.enableRate = true
        player.isMeteringEnabled = true
        player.prepareToPlay()
    }

    static func fileType(_ mimeType: String?) -> String? {
        let type = mimeType?.split(separator: ";").first?.trimmingCharacters(in: .whitespaces).lowercased()
        switch type {
        case "audio/mpeg", "audio/mp3": return AVFileType.mp3.rawValue
        case "audio/wav", "audio/wave", "audio/x-wav", "audio/vnd.wave": return AVFileType.wav.rawValue
        case "audio/aac": return "public.aac-audio"
        case "audio/mp4", "audio/m4a", "audio/x-m4a": return AVFileType.m4a.rawValue
        default: return nil
        }
    }

    var rate: Float {
        get { player.rate }
        set { player.rate = newValue }
    }

    var level: Float {
        guard player.isPlaying else { return 0 }
        player.updateMeters()
        let decibels = player.averagePower(forChannel: 0)
        return min(1, max(0, pow(10, decibels / 20) * 3))
    }

    func play() throws {
        guard player.play() else { throw BBError(status: 0, message: "The speech audio couldn't play.") }
    }

    func stop() {
        player.stop()
        resolve(.success(()))
    }

    func finished() async throws {
        if let done { return try done.get() }
        try await withCheckedThrowingContinuation { self.continuation = $0 }
    }

    private func resolve(_ result: Result<Void, Error>) {
        guard done == nil else { return }
        done = result
        continuation?.resume(with: result)
        continuation = nil
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.resolve(flag ? .success(()) : .failure(BBError(status: 0, message: "The speech audio couldn't play.")))
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let message = error?.localizedDescription ?? "The speech audio couldn't be decoded."
        Task { @MainActor in self.resolve(.failure(BBError(status: 0, message: message))) }
    }
}

/// The audio session while voice mode speaks or waits with the screen locked.
/// Speaking ducks other audio; waiting plays silence mixed with others, which
/// is what keeps an app with the audio background mode running while locked.
@MainActor
final class VoiceAudioSession {
    static let shared = VoiceAudioSession()

    var speaking = false { didSet { if speaking != oldValue { apply() } } }
    var keepAlive = false { didSet { if keepAlive != oldValue { apply() } } }

    private var silence: AVAudioPlayer?
    private var active = false

    private func apply() {
        let session = AVAudioSession.sharedInstance()
        do {
            if speaking {
                try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
                try session.setActive(true)
                active = true
            } else if keepAlive {
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
                try session.setActive(true)
                active = true
            } else if active {
                active = false
                try session.setActive(false, options: .notifyOthersOnDeactivation)
            }
        } catch {
            log.error("voice audio session: \(error.localizedDescription, privacy: .public)")
        }
        if keepAlive {
            if silence == nil {
                silence = try? AVAudioPlayer(data: Self.silentWave(), fileTypeHint: AVFileType.wav.rawValue)
                silence?.numberOfLoops = -1
                silence?.volume = 0
            }
            if silence?.isPlaying != true { silence?.play() }
        } else {
            silence?.stop()
            silence = nil
        }
    }

    /// One second of 8 kHz, 16-bit mono silence as a WAV file.
    static func silentWave(seconds: Int = 1, sampleRate: Int = 8000) -> Data {
        let samples = Data(count: seconds * sampleRate * 2)
        var data = Data()
        func append<T: FixedWidthInteger>(_ value: T) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        data.append(contentsOf: Array("RIFF".utf8))
        append(UInt32(36 + samples.count))
        data.append(contentsOf: Array("WAVEfmt ".utf8))
        append(UInt32(16))
        append(UInt16(1))
        append(UInt16(1))
        append(UInt32(sampleRate))
        append(UInt32(sampleRate * 2))
        append(UInt16(2))
        append(UInt16(16))
        data.append(contentsOf: Array("data".utf8))
        append(UInt32(samples.count))
        data.append(samples)
        return data
    }
}
