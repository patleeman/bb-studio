import AVFAudio

/// The audio session for talking: hands-free voice holds one from start to
/// hang-up, and Talk dictation uses the same Bluetooth rules.
///
/// - `.playAndRecord` the whole time, never switched between turns, so the
///   route doesn't flap.
/// - Bluetooth HFP is allowed, so a car or headset mic is used; A2DP too, and
///   iOS prefers HFP on a device that has both. `bluetoothHighQualityRecording`
///   asks for wide-band where the route supports it, and far-field input
///   (iOS 26.2, needs HFP) where the device offers it.
/// - `.voiceChat` cancels the voice's own echo, which barge-in depends on.
struct VoiceAudioConfig: Equatable, Sendable {
    var category: AVAudioSession.Category
    var mode: AVAudioSession.Mode
    var options: AVAudioSession.CategoryOptions
    var prefersEchoCancelledInput: Bool

    /// A hands-free voice session: echo cancelled, speaker by default, other audio ducked.
    static let handsFree = VoiceAudioConfig(
        category: .playAndRecord, mode: .voiceChat,
        options: [.allowBluetoothHFP, .allowBluetoothA2DP, .bluetoothHighQualityRecording, .defaultToSpeaker, .duckOthers],
        prefersEchoCancelledInput: true)

    /// Talk dictation. HFP is allowed now so a headset or car mic records; it's
    /// chosen before the engine starts, and a later route change restarts the
    /// capture engine (SegmentCapture.restart) instead of stalling it.
    static func dictation(echoCancelling: Bool) -> VoiceAudioConfig {
        VoiceAudioConfig(
            category: .playAndRecord, mode: echoCancelling ? .voiceChat : .default,
            options: [.allowBluetoothHFP, .allowBluetoothA2DP, .bluetoothHighQualityRecording, .defaultToSpeaker],
            prefersEchoCancelledInput: echoCancelling)
    }

    /// The options to set on this OS: far-field input where it exists (it requires HFP).
    func resolvedOptions(farFieldAvailable: Bool) -> AVAudioSession.CategoryOptions {
        var resolved = options
        if farFieldAvailable, options.contains(.allowBluetoothHFP) {
            if #available(iOS 26.2, *) { resolved.insert(.farFieldInput) }
        }
        return resolved
    }

    func apply(to session: AVAudioSession) throws {
        var farField = false
        if #available(iOS 26.2, *) { farField = true }
        try session.setCategory(category, mode: mode, options: resolvedOptions(farFieldAvailable: farField))
        if prefersEchoCancelledInput, session.isEchoCancelledInputAvailable {
            try? session.setPrefersEchoCancelledInput(true)
        }
        try? Self.preferBluetoothInput(session)
    }

    /// The car's or headset's mic when one is connected, else the system's choice.
    static func preferBluetoothInput(_ session: AVAudioSession) throws {
        let inputs = session.availableInputs ?? []
        if let preferred = preferredInput(among: inputs.map(\.portType)), let port = inputs.first(where: { $0.portType == preferred }) {
            try session.setPreferredInput(port)
        }
    }

    /// Car audio first, then Bluetooth HFP, then a wired headset; nil leaves the built-in mic.
    static func preferredInput(among ports: [AVAudioSession.Port]) -> AVAudioSession.Port? {
        [.carAudio, .bluetoothHFP, .headsetMic].first { ports.contains($0) }
    }
}

/// What a route change means for a session that's talking.
enum VoiceRouteAction: Equatable, Sendable {
    /// Nothing to do.
    case keep
    /// A device came or went (the car, AirPods): pick the input again and carry on.
    case reroute
    /// Someone else changed the category: set ours again.
    case reapply

    static func forReason(_ reason: AVAudioSession.RouteChangeReason) -> VoiceRouteAction {
        switch reason {
        case .newDeviceAvailable, .oldDeviceUnavailable, .override, .routeConfigurationChange, .wakeFromSleep: .reroute
        case .categoryChange: .reapply
        default: .keep
        }
    }
}
