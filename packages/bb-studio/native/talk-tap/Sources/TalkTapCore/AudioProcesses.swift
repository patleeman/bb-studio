// Core Audio's process objects: which apps have audio, and which processes belong to them.
// Reading these needs no permission and creates no tap.
import AppKit
import CoreAudio
import Darwin

public struct AudioProcess: Equatable, Sendable {
    public var object: AudioObjectID
    public var pid: pid_t
    public var bundleId: String?
    public var isRunningOutput: Bool
    /// The app this process belongs to (itself, or the app responsible for a helper process).
    public var ownerPid: pid_t
    public var ownerBundleId: String?
}

public struct AppEntry: Equatable, Sendable {
    public var bundleId: String
    public var name: String
    public var pid: pid_t
    public var playing: Bool

    public var json: [String: Any] { ["bundleId": bundleId, "name": name, "pid": Int(pid), "playing": playing] }
}

enum CoreAudioProperty {
    static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    }

    static func objectList(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> [AudioObjectID] {
        var address = address(selector)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(object, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
        var list = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &list) == noErr else { return [] }
        return Array(list.prefix(Int(size) / MemoryLayout<AudioObjectID>.size))
    }

    static func value<T: BitwiseCopyable>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ initial: T) -> T? {
        var address = address(selector)
        var value = initial
        var size = UInt32(MemoryLayout<T>.size)
        let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0) }
        guard status == noErr else { return nil }
        return value
    }

    static func string(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = address(selector)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr, let value else { return nil }
        return value.takeRetainedValue() as String
    }
}

public enum AudioProcesses {
    private typealias ResponsibleFn = @convention(c) (pid_t) -> pid_t

    /// The pid macOS holds responsible for `pid` (an app for its helper processes). Private API, read only.
    public static func responsiblePid(_ pid: pid_t) -> pid_t {
        guard let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid") else { return pid }
        let owner = unsafeBitCast(sym, to: ResponsibleFn.self)(pid)
        return owner > 0 ? owner : pid
    }

    public static func list() -> [AudioProcess] {
        CoreAudioProperty.objectList(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyProcessObjectList).compactMap { object in
            guard let pid = CoreAudioProperty.value(object, kAudioProcessPropertyPID, pid_t(0)), pid > 0 else { return nil }
            let bundleId = CoreAudioProperty.string(object, kAudioProcessPropertyBundleID).flatMap { $0.isEmpty ? nil : $0 }
            let running = (CoreAudioProperty.value(object, kAudioProcessPropertyIsRunningOutput, UInt32(0)) ?? 0) != 0
            let ownerPid = responsiblePid(pid)
            let ownerBundleId = ownerPid == pid ? bundleId : (NSRunningApplication(processIdentifier: ownerPid)?.bundleIdentifier ?? bundleId)
            return AudioProcess(object: object, pid: pid, bundleId: bundleId, isRunningOutput: running, ownerPid: ownerPid, ownerBundleId: ownerBundleId)
        }
    }

    /// Whether `process` belongs to one of `bundleIds`: the app itself, a helper with a
    /// bundle id under it (com.google.Chrome.helper), or a helper it is responsible for
    /// (Safari's WebKit processes).
    public static func matches(_ process: AudioProcess, bundleIds: Set<String>) -> Bool {
        if let id = process.bundleId {
            if bundleIds.contains(id) { return true }
            if bundleIds.contains(where: { id.hasPrefix($0 + ".") }) { return true }
        }
        if let owner = process.ownerBundleId, bundleIds.contains(owner) { return true }
        return false
    }

    /// Apps with audio clients, grouped by owning app. Playing apps first, then by name.
    public static func apps(from processes: [AudioProcess] = list(), excludingPid own: pid_t = getpid()) -> [AppEntry] {
        var byOwner: [String: AppEntry] = [:]
        for process in processes where process.pid != own && process.ownerPid != own {
            guard let bundleId = process.ownerBundleId else { continue }
            let app = NSRunningApplication(processIdentifier: process.ownerPid)
            // Background daemons that touch audio aren't call apps, unless they're actually playing.
            if app?.activationPolicy != .regular && !process.isRunningOutput { continue }
            let name = app?.localizedName ?? bundleId
            var entry = byOwner[bundleId] ?? AppEntry(bundleId: bundleId, name: name, pid: process.ownerPid, playing: false)
            entry.playing = entry.playing || process.isRunningOutput
            byOwner[bundleId] = entry
        }
        return sortApps(Array(byOwner.values))
    }

    public static func sortApps(_ apps: [AppEntry]) -> [AppEntry] {
        apps.sorted { a, b in
            if a.playing != b.playing { return a.playing }
            return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }
}

public enum Permission {
    private typealias PreflightFn = @convention(c) (CFString, CFDictionary?) -> Int

    /// "System Audio Recording Only" status for the responsible app, read without prompting.
    /// TCCAccessPreflight is private: 0 granted, 1 denied, anything else not yet asked.
    public static func audioCapture() -> String {
        guard let handle = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW),
              let sym = dlsym(handle, "TCCAccessPreflight") else { return "undetermined" }
        switch unsafeBitCast(sym, to: PreflightFn.self)("kTCCServiceAudioCapture" as CFString, nil) {
        case 0: return "granted"
        case 1: return "denied"
        default: return "undetermined"
        }
    }
}
