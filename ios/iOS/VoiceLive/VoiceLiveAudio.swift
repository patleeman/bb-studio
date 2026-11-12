import AVFAudio
import Foundation
import WebRTC
import os

private let log = Logger(subsystem: "nyc.plee.bbgo", category: "voice-live")

/// WebRTC's view of the audio session (RTCAudioSession in the app, a fake in tests).
protocol RTCAudioControl: AnyObject {
    /// On: WebRTC starts its voice-processing unit only while `isAudioEnabled`.
    var useManualAudio: Bool { get set }
    /// Off stops and uninitializes the voice-processing unit; on starts it.
    var isAudioEnabled: Bool { get set }
    /// Runs `body` holding WebRTC's configuration lock, so it can't configure the session at the same time.
    func withLock(_ body: () throws -> Void) rethrows
    /// We activated the session: WebRTC counts it active and resumes its audio unit
    /// (it treats this as an interruption's end).
    func didActivate()
    /// We (or iOS) deactivated it.
    func didDeactivate()
    /// What WebRTC sets when it configures the session itself (when its audio unit starts).
    func useConfiguration(_ config: VoiceAudioConfig)
}

/// The real one: `RTCAudioSession.sharedInstance()`.
final class WebRTCAudioControl: RTCAudioControl {
    private var rtc: RTCAudioSession { RTCAudioSession.sharedInstance() }

    var useManualAudio: Bool {
        get { rtc.useManualAudio }
        set { rtc.useManualAudio = newValue }
    }

    var isAudioEnabled: Bool {
        get { rtc.isAudioEnabled }
        set { rtc.isAudioEnabled = newValue }
    }

    func withLock(_ body: () throws -> Void) rethrows {
        rtc.lockForConfiguration()
        defer { rtc.unlockForConfiguration() }
        try body()
    }

    func didActivate() { rtc.audioSessionDidActivate(AVAudioSession.sharedInstance()) }
    func didDeactivate() { rtc.audioSessionDidDeactivate(AVAudioSession.sharedInstance()) }

    /// WebRTC's default is voiceChat with Bluetooth and no `.defaultToSpeaker`, which plays on
    /// the earpiece. It applies it whenever its audio unit starts, so ours replaces it.
    func useConfiguration(_ config: VoiceAudioConfig) {
        RTCAudioSessionConfiguration.setWebRTC(Self.configuration(config))
    }

    static func configuration(_ config: VoiceAudioConfig) -> RTCAudioSessionConfiguration {
        let webRTC = RTCAudioSessionConfiguration.webRTC()
        webRTC.category = config.category.rawValue
        webRTC.mode = config.mode.rawValue
        var farField = false
        if #available(iOS 26.2, *) { farField = true }
        webRTC.categoryOptions = config.resolvedOptions(farFieldAvailable: farField)
        return webRTC
    }
}

/// Hands-free voice's audio session, handed between the app and WebRTC (manual audio):
///
/// - Start: our config (also as WebRTC's own), active, then WebRTC is told
///   (`audioSessionDidActivate`) and its audio enabled.
/// - A route change, an interruption's end or a media-services reset: the same again,
///   so WebRTC restarts an audio unit that stopped on the old route.
/// - An interruption: WebRTC's audio off and told the session is gone.
/// - Hang-up: WebRTC's audio off (it releases the voice-processing unit), told, then the
///   session deactivated, retrying while the unit's I/O winds down, so the next
///   recording finds a working mic.
/// - The voice plays on the loudspeaker unless a headset, Bluetooth or the car is there.
@MainActor
final class VoiceLiveAudio {
    let session: AudioSessionControl
    let rtc: RTCAudioControl
    let config: VoiceAudioConfig
    let permission: () async -> Bool
    /// Waits between tries to deactivate at hang-up, in ms.
    var deactivateDelays = [0, 150, 400, 1000]
    /// One line per step, for the evidence log and the console.
    var trace: ((String) -> Void)?

    /// Activated for this session and not yet released.
    private(set) var active = false
    /// WebRTC was told the session is active (its count stays at one).
    private(set) var told = false
    private(set) var speakerOverridden = false
    private var reconfiguring = false

    init(session: AudioSessionControl = AVAudioSession.sharedInstance(), rtc: RTCAudioControl = WebRTCAudioControl(),
         config: VoiceAudioConfig = .handsFree, permission: @escaping () async -> Bool = { await AVAudioApplication.requestRecordPermission() }) {
        self.session = session
        self.rtc = rtc
        self.config = config
        self.permission = permission
    }

    private func note(_ line: String) {
        log.info("audio: \(line, privacy: .public)")
        trace?(line)
    }

    /// The route now, for the screen and the logs.
    var route: (input: String, output: String) { (session.routeInputName, session.routeOutputName) }

    /// Before the first offer: our config, active, WebRTC told and enabled.
    func activate() async throws {
        guard await permission() else { throw BBError(status: 0, message: "Microphone access is off. Enable it in Settings.") }
        rtc.useConfiguration(config)
        rtc.useManualAudio = true
        try rtc.withLock {
            try config.apply(to: session)
            try session.setActive(true, options: [])
        }
        active = true
        note("activated; output \(session.routeOutputName)")
        handOff()
        routeOutput()
    }

    /// After a route change, an interruption's end or a media-services reset (`reset`: everything was lost).
    func reactivate(reset: Bool = false) {
        // Our own setCategory, preferred input and speaker override are route changes too.
        guard active, !reconfiguring else { return }
        reconfiguring = true
        defer { reconfiguring = false }
        if reset {
            // The audio unit WebRTC had is gone with the media server: let it build a new one.
            rtc.isAudioEnabled = false
            rtc.useConfiguration(config)
        }
        rtc.withLock {
            if reset || !config.isApplied(to: session) {
                note("config set again (was \(session.mode.rawValue), options \(session.categoryOptions.rawValue))")
                try? config.apply(to: session)
            } else {
                try? VoiceAudioConfig.preferBluetoothInput(session)
            }
            do { try session.setActive(true, options: []) } catch { note("activate failed: \(error.localizedDescription)") }
        }
        handOff()
        routeOutput()
    }

    /// A call or Siri took the audio: iOS has deactivated the session.
    func interrupted() {
        guard active else { return }
        rtc.isAudioEnabled = false
        if told {
            rtc.didDeactivate()
            told = false
        }
        note("interrupted: WebRTC audio off")
    }

    /// Hang-up. `close` drops the connection between WebRTC's audio going off and the session going.
    func release(close: () -> Void) async {
        guard active else { return close() }
        active = false
        rtc.isAudioEnabled = false
        close()
        if told {
            rtc.didDeactivate()
            told = false
        }
        if speakerOverridden {
            rtc.withLock { try? session.overrideOutputAudioPort(.none) }
            speakerOverridden = false
        }
        for (attempt, delay) in deactivateDelays.enumerated() {
            if delay > 0 { try? await Task.sleep(for: .milliseconds(delay)) }
            do {
                try rtc.withLock { try session.setActive(false, options: .notifyOthersOnDeactivation) }
                note("deactivated (try \(attempt + 1))")
                return
            } catch {
                // "I/O is running": WebRTC's unit hasn't stopped yet.
                note("deactivate failed (try \(attempt + 1)): \(error.localizedDescription)")
            }
        }
    }

    private func handOff() {
        // WebRTC counts activations; keep ours at one, so its own deactivation stays balanced.
        if told { rtc.didDeactivate() }
        rtc.didActivate()
        told = true
        rtc.isAudioEnabled = true
    }

    /// The loudspeaker unless a headset, Bluetooth or the car is there; our override cleared when one is.
    func routeOutput() {
        guard let change = VoiceSpeakerRoute.change(outputs: session.routeOutputs, inputs: session.availableInputPorts, overridden: speakerOverridden) else { return }
        do {
            try rtc.withLock { try session.overrideOutputAudioPort(change) }
            speakerOverridden = change == .speaker
            note("output override \(change == .speaker ? "speaker" : "none"); output \(session.routeOutputName)")
        } catch {
            note("output override failed: \(error.localizedDescription)")
        }
    }
}
