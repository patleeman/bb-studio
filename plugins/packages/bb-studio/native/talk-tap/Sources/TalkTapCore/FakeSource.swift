// Fake capture for tests: plays an audio file into a source in real time
// (or faster with --fake-speed), with no tap, no mic and no permission prompt.
import AVFoundation

/// Something that produces one source's audio as 16 kHz mono chunks.
public protocol AudioInput: AnyObject {
    var source: Source { get }
    /// `deliver(samples, startMs)`: startMs is given with the first chunk only, relative to capture start.
    func start(deliver: @escaping ([Float], Int?) -> Void, ended: @escaping () -> Void) throws
    func stop()
}

public final class FakeFileInput: AudioInput, @unchecked Sendable {
    public let source: Source
    private let file: AVAudioFile
    private let speed: Double
    private let chunkMs = 100
    private let lock = NSLock()
    private var stopped = false
    private var thread: Thread?
    private let done = DispatchSemaphore(value: 0)

    public init(source: Source, path: String, speed: Double = 1) throws {
        self.source = source
        do {
            file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
        } catch {
            throw ProtocolError("can't read \(path): \(error.localizedDescription)")
        }
        self.speed = max(speed, 0.01)
    }

    public func start(deliver: @escaping ([Float], Int?) -> Void, ended: @escaping () -> Void) throws {
        let format = file.processingFormat
        let resampler = Resampler(inputRate: format.sampleRate)
        let chunkFrames = AVAudioFrameCount(format.sampleRate * Double(chunkMs) / 1000)
        let thread = Thread { [self] in
            let begin = DispatchTime.now().uptimeNanoseconds
            var sent: Double = 0 // seconds of audio delivered
            var first = true
            while !isStopped {
                guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunkFrames) else { break }
                do { try file.read(into: buffer, frameCount: chunkFrames) } catch { break }
                if buffer.frameLength == 0 { break }
                var mono = resampler.process(Downmix.mono(buffer))
                let atEnd = file.framePosition >= file.length
                if atEnd { mono += resampler.flush() }
                deliver(mono, first ? 0 : nil)
                first = false
                sent += Double(buffer.frameLength) / format.sampleRate
                if atEnd { break }
                // Pace by the clock, not by sleeps, so drift doesn't add up.
                let due = begin + UInt64(sent / speed * 1e9)
                let now = DispatchTime.now().uptimeNanoseconds
                if due > now { Thread.sleep(forTimeInterval: Double(due - now) / 1e9) }
            }
            done.signal()
            ended()
        }
        thread.name = "bb-talk-tap.fake.\(source.rawValue)"
        self.thread = thread
        thread.start()
    }

    private var isStopped: Bool {
        lock.lock()
        defer { lock.unlock() }
        return stopped
    }

    public func stop() {
        lock.lock()
        let wasStopped = stopped
        stopped = true
        lock.unlock()
        // Wait for the reader to put down its last chunk.
        if !wasStopped, thread != nil { _ = done.wait(timeout: .now() + 2) }
    }
}
