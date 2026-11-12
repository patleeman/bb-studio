// The real inputs: a Core Audio process tap ("them") and the voice-processing mic ("me").
//
// Never run these in tests on a developer Mac: the first tap shows macOS's
// "System Audio Recording Only" prompt, and the mic its own prompt. Tests use fake mode.
import AVFoundation
import AppKit
import CoreAudio

public enum LiveInputs {
    public static func make(_ args: CaptureArgs, sink: EventSink) throws -> [AudioInput] {
        var inputs: [AudioInput] = [ProcessTapInput(target: args.target, sink: sink)]
        if args.mic { inputs.append(MicInput()) }
        return inputs
    }
}

/// Converts host time (mach_absolute_time units) to ms since capture start.
enum HostClock {
    private static let timebase: mach_timebase_info_data_t = {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return info
    }()

    static func nanoseconds(_ hostTime: UInt64) -> UInt64 {
        hostTime * UInt64(timebase.numer) / UInt64(timebase.denom)
    }

    static func msSinceStart(hostTime: UInt64) -> Int {
        let ns = Int64(nanoseconds(hostTime)) - Int64(CaptureClock.startNanoseconds)
        return max(0, Int(ns / 1_000_000))
    }
}

/// When capture started, on the uptime clock (what DispatchTime and AudioTimeStamp.mHostTime use).
public enum CaptureClock {
    private static let lock = NSLock()
    private static var start: UInt64 = DispatchTime.now().uptimeNanoseconds

    public static func reset() {
        lock.lock()
        start = DispatchTime.now().uptimeNanoseconds
        lock.unlock()
    }

    public static var startNanoseconds: UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return start
    }

    public static var elapsedMs: Int {
        Int((DispatchTime.now().uptimeNanoseconds - startNanoseconds) / 1_000_000)
    }
}

// MARK: - Process tap

/// The call's audio: a private, pass-through tap on the target apps' processes (or all
/// system audio), read through a private aggregate device and converted to 16 kHz mono.
public final class ProcessTapInput: AudioInput, @unchecked Sendable {
    public let source = Source.them
    let target: CaptureArgs.Target
    private let sink: EventSink
    private let queue = DispatchQueue(label: "bb-talk-tap.tap")
    private var deliver: (([Float], Int?) -> Void)?
    private var tap = AudioObjectID(kAudioObjectUnknown)
    private var tapDescription: CATapDescription?
    private var tappedProcesses: [AudioObjectID] = []
    private var aggregate = AudioObjectID(kAudioObjectUnknown)
    private var ioProc: AudioDeviceIOProcID?
    private var format = AudioStreamBasicDescription()
    private var resampler: Resampler?
    private var sentFirst = false
    private var stopped = false
    private var goneReported: Set<String> = []
    private var appWatch: DispatchSourceTimer?
    private var listeners: [(AudioObjectPropertyAddress, AudioObjectPropertyListenerBlock)] = []

    public init(target: CaptureArgs.Target, sink: EventSink) {
        self.target = target
        self.sink = sink
    }

    public func start(deliver: @escaping ([Float], Int?) -> Void, ended: @escaping () -> Void) throws {
        if Permission.audioCapture() == "denied" {
            throw CaptureError(.permission, "System audio recording is turned off for BB. Turn it on in System Settings › Privacy & Security › Screen & System Audio Recording.")
        }
        self.deliver = deliver
        try queue.sync {
            try refreshProcesses()
            listen(kAudioHardwarePropertyProcessObjectList) { [weak self] in self?.processListChanged() }
            listen(kAudioHardwarePropertyDefaultOutputDevice) { [weak self] in self?.outputDeviceChanged() }
            if case let .bundleIds(ids) = target { watchApps(ids) }
        }
    }

    public func stop() {
        queue.sync {
            guard !stopped else { return }
            stopped = true
            appWatch?.cancel()
            for (address, block) in listeners {
                var address = address
                AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, queue, block)
            }
            listeners.removeAll()
            teardownDevice()
            if tap != kAudioObjectUnknown {
                AudioHardwareDestroyProcessTap(tap)
                tap = AudioObjectID(kAudioObjectUnknown)
            }
            if let tail = resampler?.flush(), !tail.isEmpty, sentFirst { deliver?(tail, nil) }
        }
    }

    // MARK: Tap setup (on `queue`)

    /// The process objects to tap now. Empty for `.all` (the tap is global).
    private func targetProcesses() -> [AudioObjectID] {
        guard case let .bundleIds(ids) = target else { return [] }
        let wanted = Set(ids)
        return AudioProcesses.list().filter { AudioProcesses.matches($0, bundleIds: wanted) }.map(\.object).sorted()
    }

    /// Creates the tap once there is something to tap, and keeps its process list current
    /// (apps start helper processes for audio at any time, for example when a call starts).
    private func refreshProcesses() throws {
        guard !stopped else { return }
        let processes = targetProcesses()
        if tap == kAudioObjectUnknown {
            if case .bundleIds = target, processes.isEmpty {
                // The app hasn't opened audio yet. The tap is made when it does.
                log("no audio processes for the target yet; waiting")
                return
            }
            try createTap(processes: processes)
            try createDevice()
            return
        }
        guard case .bundleIds = target, processes != tappedProcesses, !processes.isEmpty, let description = tapDescription else { return }
        description.processes = processes
        var address = CoreAudioProperty.address(kAudioTapPropertyDescription)
        // The property's value is the description object itself (a CF-style reference).
        var reference = Unmanaged.passUnretained(description)
        let status = withUnsafeMutablePointer(to: &reference) {
            AudioObjectSetPropertyData(tap, &address, 0, nil, UInt32(MemoryLayout<Unmanaged<CATapDescription>>.size), $0)
        }
        if status == noErr {
            tappedProcesses = processes
        } else {
            log("updating the tap's processes failed: \(status)")
        }
    }

    private func createTap(processes: [AudioObjectID]) throws {
        let description: CATapDescription
        switch target {
        case .all:
            // Everything except this helper (which plays nothing anyway).
            let own = AudioProcesses.list().filter { $0.pid == getpid() }.map(\.object)
            description = CATapDescription(stereoGlobalTapButExcludeProcesses: own)
        case .bundleIds:
            description = CATapDescription(stereoMixdownOfProcesses: processes)
        }
        description.uuid = UUID()
        description.name = "bb-talk-tap"
        description.isPrivate = true
        description.muteBehavior = .unmuted // pass-through: the call plays as normal
        var tap = AudioObjectID(kAudioObjectUnknown)
        let status = AudioHardwareCreateProcessTap(description, &tap)
        guard status == noErr, tap != kAudioObjectUnknown else {
            throw CaptureError(.device, "creating the process tap failed (\(status))")
        }
        self.tap = tap
        tapDescription = description
        tappedProcesses = processes
        guard let format = CoreAudioProperty.value(tap, kAudioTapPropertyFormat, AudioStreamBasicDescription()), format.mSampleRate > 0 else {
            throw CaptureError(.device, "reading the tap's format failed")
        }
        // The callback reads 32-bit floats.
        guard format.mFormatID == kAudioFormatLinearPCM, format.mFormatFlags & kAudioFormatFlagIsFloat != 0, format.mBitsPerChannel == 32 else {
            throw CaptureError(.device, "the tap's format isn't 32-bit float PCM")
        }
        self.format = format
        resampler = Resampler(inputRate: format.mSampleRate)
    }

    /// A private aggregate device clocked by the current output device, with the tap as its input.
    private func createDevice() throws {
        guard let tapUID = CoreAudioProperty.string(tap, kAudioTapPropertyUID) else {
            throw CaptureError(.device, "reading the tap's UID failed")
        }
        var description: [String: Any] = [
            kAudioAggregateDeviceNameKey: "bb-talk-tap",
            kAudioAggregateDeviceUIDKey: "dev.bbstudio.talk-tap.\(UUID().uuidString)",
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: tapUID]],
        ]
        if let output = CoreAudioProperty.value(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice, AudioObjectID(0)),
           let outputUID = CoreAudioProperty.string(output, kAudioDevicePropertyDeviceUID) {
            description[kAudioAggregateDeviceMainSubDeviceKey] = outputUID
            description[kAudioAggregateDeviceSubDeviceListKey] = [[kAudioSubDeviceUIDKey: outputUID]]
        } else {
            description[kAudioAggregateDeviceSubDeviceListKey] = [] as [Any]
        }
        var device = AudioObjectID(kAudioObjectUnknown)
        var status = AudioHardwareCreateAggregateDevice(description as CFDictionary, &device)
        guard status == noErr else { throw CaptureError(.device, "creating the aggregate device failed (\(status))") }
        aggregate = device

        let format = self.format
        let interleaved = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
        let channels = Int(max(format.mChannelsPerFrame, 1))
        var procID: AudioDeviceIOProcID?
        status = AudioDeviceCreateIOProcIDWithBlock(&procID, device, nil) { [weak self] _, input, inputTime, _, _ in
            // Real-time thread: copy out and hand over; no locks, no allocation beyond the copy.
            let bytes = Int(input.pointee.mBuffers.mDataByteSize)
            let frames = interleaved ? bytes / (4 * channels) : bytes / 4
            guard frames > 0 else { return }
            let mono = Downmix.mono(input, frames: frames, interleaved: interleaved)
            let hostTime = inputTime.pointee.mHostTime
            self?.queue.async { self?.receive(mono, hostTime: hostTime) }
        }
        guard status == noErr, let procID else {
            teardownDevice()
            throw CaptureError(.device, "creating the audio callback failed (\(status))")
        }
        ioProc = procID
        status = AudioDeviceStart(device, procID)
        guard status == noErr else {
            teardownDevice()
            throw CaptureError(.device, "starting the aggregate device failed (\(status))")
        }
    }

    private func teardownDevice() {
        if aggregate != kAudioObjectUnknown {
            if let ioProc {
                AudioDeviceStop(aggregate, ioProc)
                AudioDeviceDestroyIOProcID(aggregate, ioProc)
            }
            AudioHardwareDestroyAggregateDevice(aggregate)
        }
        ioProc = nil
        aggregate = AudioObjectID(kAudioObjectUnknown)
    }

    private func receive(_ mono: [Float], hostTime: UInt64) {
        guard !stopped, let resampler, let deliver else { return }
        let samples = resampler.process(mono)
        guard !samples.isEmpty else { return }
        if sentFirst {
            deliver(samples, nil)
        } else {
            sentFirst = true
            deliver(samples, hostTime > 0 ? HostClock.msSinceStart(hostTime: hostTime) : CaptureClock.elapsedMs)
        }
    }

    // MARK: Changes (on `queue`)

    private func listen(_ selector: AudioObjectPropertySelector, _ handler: @escaping () -> Void) {
        var address = CoreAudioProperty.address(selector)
        let block: AudioObjectPropertyListenerBlock = { _, _ in handler() }
        if AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, queue, block) == noErr {
            listeners.append((address, block))
        }
    }

    private func processListChanged() {
        do {
            try refreshProcesses()
        } catch let error as CaptureError {
            sink.emit(.error(code: error.code, message: error.message))
        } catch {
            sink.emit(.error(code: .device, message: "\(error)"))
        }
    }

    /// Headphones plugged in, a new default output: rebuild the device around the new clock.
    private func outputDeviceChanged() {
        guard !stopped, tap != kAudioObjectUnknown else { return }
        teardownDevice()
        do {
            try createDevice()
        } catch let error as CaptureError {
            sink.emit(.error(code: error.code, message: error.message))
        } catch {
            sink.emit(.error(code: .device, message: "\(error)"))
        }
    }

    private func watchApps(_ ids: [String]) {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in
            guard let self, !self.stopped else { return }
            for id in ids where !self.goneReported.contains(id) {
                if NSRunningApplication.runningApplications(withBundleIdentifier: id).isEmpty {
                    self.goneReported.insert(id)
                    self.sink.emit(.appGone(bundleId: id))
                }
            }
        }
        timer.resume()
        appWatch = timer
    }
}

// MARK: - Mic

/// The user's side: the default input through Apple's voice processing (echo
/// cancellation, noise suppression), so the call playing on speakers is mostly removed.
public final class MicInput: AudioInput, @unchecked Sendable {
    public let source = Source.me
    /// Made on start, so building the input touches no audio hardware.
    private lazy var engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "bb-talk-tap.mic")
    private var resampler: Resampler?
    private var sentFirst = false
    private var running = false

    public init() {}

    public func start(deliver: @escaping ([Float], Int?) -> Void, ended: @escaping () -> Void) throws {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .denied, .restricted:
            throw CaptureError(.permission, "The microphone is turned off for BB. Turn it on in System Settings › Privacy & Security › Microphone.")
        default:
            break // granted, or not asked yet: starting the engine asks
        }
        let input = engine.inputNode
        do {
            try input.setVoiceProcessingEnabled(true)
        } catch {
            throw CaptureError(.device, "turning on voice processing for the mic failed: \(error.localizedDescription)")
        }
        // Voice processing ducks other audio by default, which would turn the call down.
        input.voiceProcessingOtherAudioDuckingConfiguration = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
        _ = engine.outputNode // voice processing runs input and output as one unit

        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw CaptureError(.device, "the mic has no usable format")
        }
        let resampler = Resampler(inputRate: format.sampleRate)
        self.resampler = resampler
        input.installTap(onBus: 0, bufferSize: AVAudioFrameCount(format.sampleRate / 10), format: format) { [weak self] buffer, time in
            // Channel 0 is the processed voice.
            guard let data = buffer.floatChannelData, buffer.frameLength > 0 else { return }
            let mono = Array(UnsafeBufferPointer(start: data[0], count: Int(buffer.frameLength)))
            let hostTime = time.isHostTimeValid ? time.hostTime : 0
            self?.queue.async {
                guard let self, self.running else { return }
                let samples = resampler.process(mono)
                guard !samples.isEmpty else { return }
                if self.sentFirst {
                    deliver(samples, nil)
                } else {
                    self.sentFirst = true
                    deliver(samples, hostTime > 0 ? HostClock.msSinceStart(hostTime: hostTime) : CaptureClock.elapsedMs)
                }
            }
        }
        queue.sync { running = true }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            queue.sync { running = false }
            throw CaptureError(.device, "starting the mic failed: \(error.localizedDescription)")
        }
    }

    public func stop() {
        guard queue.sync(execute: { running }) else { return }
        // Only reached after start, so this doesn't create the engine.
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        queue.sync { running = false }
    }
}
