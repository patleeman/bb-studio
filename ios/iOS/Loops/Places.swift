import CoreLocation
import Foundation
import Observation
import UIKit

/// A place you saved for loops to wait on: Home, Office, or one of your own.
/// It stays on this iPhone; Studio only ever hears its name.
struct Place: Codable, Identifiable, Hashable, Sendable {
    enum Kind: String, Codable, Sendable { case home, office, saved }

    var id: String = UUID().uuidString
    var name: String
    var kind: Kind
    var latitude: Double
    var longitude: Double
    /// Meters. iOS needs about 100 m to notice arriving reliably.
    var radius: Double = 150
    /// A short label shown under the name, such as the street. Never sent.
    var label: String?

    var symbol: String {
        switch kind {
        case .home: "house"
        case .office: "building.2"
        case .saved: "mappin.and.ellipse"
        }
    }

    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }

    /// The region iOS watches for it.
    var regionId: String { PlaceMonitor.regionPrefix + id }

    static let radii: ClosedRange<Double> = 100...1000
}

/// This iPhone's places, kept in its own settings. Studio gets the names.
@MainActor @Observable
final class PlacesStore {
    static let shared = PlacesStore()

    private(set) var places: [Place] = []
    /// Settings ▸ Places ▸ Place triggers.
    var enabled: Bool {
        didSet {
            defaults.set(enabled, forKey: Self.enabledKey)
            changed()
        }
    }
    private let defaults: UserDefaults
    /// Told after every change: the monitor watches the new set and tells Studio the names.
    private let changed: @MainActor () -> Void
    static let key = "loops.places"
    static let enabledKey = "loops.placeTriggers"
    /// iOS watches at most 20 regions for an app.
    static let limit = 20

    init(defaults: UserDefaults = .standard, changed: @escaping @MainActor () -> Void = { PlaceMonitor.shared.placesChanged() }) {
        self.defaults = defaults
        self.changed = changed
        enabled = defaults.object(forKey: Self.enabledKey) as? Bool ?? true
        if let data = defaults.data(forKey: Self.key), let saved = try? JSONDecoder().decode([Place].self, from: data) {
            places = saved
        }
        #if DEBUG
        if let demo = PlacesDemo.places { places = demo }
        #endif
    }

    var home: Place? { places.first { $0.kind == .home } }
    var office: Place? { places.first { $0.kind == .office } }
    var saved: [Place] { places.filter { $0.kind == .saved } }
    var names: [String] { places.map(\.name) }
    var isFull: Bool { places.count >= Self.limit }

    /// Adds or replaces a place. Home and Office are one each.
    func save(_ place: Place) {
        var place = place
        place.name = place.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !place.name.isEmpty else { return }
        if let index = places.firstIndex(where: { $0.id == place.id }) {
            places[index] = place
        } else {
            if place.kind != .saved { places.removeAll { $0.kind == place.kind } }
            guard !isFull else { return }
            places.append(place)
        }
        persist()
    }

    func remove(_ place: Place) {
        places.removeAll { $0.id == place.id }
        persist()
    }

    private func persist() {
        defaults.set(try? JSONEncoder().encode(places), forKey: Self.key)
        changed()
    }
}

/// What `PlaceMonitor` needs of `CLLocationManager`, so tests can stand in for it.
@MainActor
protocol RegionMonitoring: AnyObject {
    var delegate: (any CLLocationManagerDelegate)? { get set }
    var authorizationStatus: CLAuthorizationStatus { get }
    var monitoredRegions: Set<CLRegion> { get }
    func startMonitoring(for region: CLRegion)
    func stopMonitoring(for region: CLRegion)
    func requestWhenInUseAuthorization()
    func requestAlwaysAuthorization()
    func requestLocation()
}

extension CLLocationManager: RegionMonitoring {}

/// Watches your places with region monitoring and tells Studio only
/// "arrived at <name>" or "left <name>" (`loops.place`), never where you are.
/// It also keeps Studio's list of place names current (`loops.setPlaces`).
/// iOS relaunches the app in the background for a region event, so it starts
/// at launch when there's something to watch.
@MainActor
final class PlaceMonitor: NSObject, CLLocationManagerDelegate {
    static let regionPrefix = "bb.place."
    static let shared = PlaceMonitor()

    enum Access: Equatable {
        case notAsked, whileUsing, always, denied
    }

    /// Made on first use, so launching never touches Core Location without places.
    private var manager: (any RegionMonitoring)?
    private let makeManager: () -> any RegionMonitoring
    private let store: () -> PlacesStore
    private let send: (String, Bool) async throws -> Void
    private let sendNames: ([String]) async throws -> Void
    /// The one-shot "Use current location" answer.
    private var locating: CheckedContinuation<CLLocation?, Never>?
    /// Events that didn't reach Studio, retried on the next change or launch.
    private(set) var unsent: [(name: String, arrive: Bool)] = []
    /// Told when access changes, for the Places screen.
    var accessChanged: (Access) -> Void = { _ in }

    init(makeManager: @escaping () -> any RegionMonitoring = { CLLocationManager() },
         store: @escaping () -> PlacesStore = { PlacesStore.shared },
         send: @escaping (String, Bool) async throws -> Void = { try await AppModel.shared.client.loopPlace($0, arrive: $1) },
         sendNames: @escaping ([String]) async throws -> Void = { try await AppModel.shared.client.setLoopPlaces($0) }) {
        self.makeManager = makeManager
        self.store = store
        self.send = send
        self.sendNames = sendNames
    }

    private func ensureManager() -> any RegionMonitoring {
        if let manager { return manager }
        let made = makeManager()
        made.delegate = self
        manager = made
        return made
    }

    static func access(_ status: CLAuthorizationStatus) -> Access {
        switch status {
        case .authorizedAlways: .always
        case .authorizedWhenInUse: .whileUsing
        case .denied, .restricted: .denied
        default: .notAsked
        }
    }

    var access: Access {
        #if DEBUG
        if let demo = PlacesDemo.access { return demo }
        #endif
        return manager.map { Self.access($0.authorizationStatus) } ?? Self.access(CLLocationManager().authorizationStatus)
    }

    /// At launch: watch the places if there are any to watch.
    func start() {
        #if DEBUG
        if PlacesDemo.active { return }
        #endif
        guard store().enabled, !store().places.isEmpty else { return }
        sync()
    }

    /// Places or the switch changed: watch the new set and tell Studio the names.
    func placesChanged() {
        #if DEBUG
        if PlacesDemo.active { return }
        #endif
        sync()
        let names = store().names
        Task { try? await sendNames(names) }
    }

    /// Watches exactly the saved places (at most 20) while place triggers are on.
    func sync() {
        let wanted = store().enabled ? Array(store().places.prefix(PlacesStore.limit)) : []
        guard manager != nil || !wanted.isEmpty else { return }
        let manager = ensureManager()
        let ours = manager.monitoredRegions.filter { $0.identifier.hasPrefix(Self.regionPrefix) }
        let regions = Dictionary(uniqueKeysWithValues: wanted.map { ($0.regionId, Self.region($0)) })
        for region in ours {
            guard let want = regions[region.identifier] as? CLCircularRegion, let have = region as? CLCircularRegion,
                  want.center.latitude == have.center.latitude, want.center.longitude == have.center.longitude,
                  want.radius == have.radius
            else {
                manager.stopMonitoring(for: region)
                continue
            }
        }
        let kept = Set(manager.monitoredRegions.map(\.identifier))
        for (id, region) in regions.sorted(by: { $0.key < $1.key }) where !kept.contains(id) {
            manager.startMonitoring(for: region)
        }
        flush()
    }

    static func region(_ place: Place) -> CLCircularRegion {
        let region = CLCircularRegion(center: place.coordinate, radius: min(max(place.radius, Place.radii.lowerBound), Place.radii.upperBound),
                                      identifier: place.regionId)
        region.notifyOnEntry = true
        region.notifyOnExit = true
        return region
    }

    /// Asks for location access, in iOS's two steps: While Using first, then
    /// Always. Only after the explanation, and only from a tap.
    func requestAccess() {
        #if DEBUG
        if PlacesDemo.active { return }
        #endif
        let manager = ensureManager()
        switch Self.access(manager.authorizationStatus) {
        case .notAsked: manager.requestWhenInUseAuthorization()
        case .whileUsing: manager.requestAlwaysAuthorization()
        case .always, .denied: break
        }
    }

    /// Where the phone is now, once, for "Use current location". Needs access.
    func currentLocation() async -> CLLocation? {
        guard [.whileUsing, .always].contains(access) else { return nil }
        let manager = ensureManager()
        locating?.resume(returning: nil)
        return await withCheckedContinuation { continuation in
            locating = continuation
            manager.requestLocation()
        }
    }

    /// A region event: arrived or left the place it stands for.
    func handle(regionId: String, arrive: Bool) {
        guard regionId.hasPrefix(Self.regionPrefix),
              let place = store().places.first(where: { $0.regionId == regionId }) else { return }
        unsent.append((place.name, arrive))
        flush()
    }

    private var flushing = false

    /// Sends what's waiting, in order, while the app may be in the background.
    private func flush() {
        guard !flushing, !unsent.isEmpty else { return }
        flushing = true
        let task = UIApplication.shared.beginBackgroundTask(withName: "loops.place")
        Task {
            while let next = unsent.first {
                do {
                    try await send(next.name, next.arrive)
                    unsent.removeFirst()
                } catch {
                    break
                }
            }
            flushing = false
            UIApplication.shared.endBackgroundTask(task)
        }
    }

    // MARK: CLLocationManagerDelegate (on the main thread, where the manager was made)

    nonisolated func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        let id = region.identifier
        MainActor.assumeIsolated { handle(regionId: id, arrive: true) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        let id = region.identifier
        MainActor.assumeIsolated { handle(regionId: id, arrive: false) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        MainActor.assumeIsolated {
            let access = Self.access(status)
            accessChanged(access)
            if access == .always || access == .whileUsing { sync() }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let location = locations.last
        MainActor.assumeIsolated {
            locating?.resume(returning: location)
            locating = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        MainActor.assumeIsolated {
            locating?.resume(returning: nil)
            locating = nil
        }
    }
}

#if DEBUG
/// Debug builds: `-qaPlacesDemo` fills Places with Home, Office, Mom's and the
/// Gym and pretends location access is Always (`-qaPlacesAccess notAsked`
/// for the explanation), with no Core Location at all: no prompt, no regions.
enum PlacesDemo {
    nonisolated static var active: Bool { ProcessInfo.processInfo.arguments.contains("-qaPlacesDemo") }

    static var places: [Place]? {
        guard active else { return nil }
        if ProcessInfo.processInfo.arguments.contains("-qaPlacesEmpty") { return [] }
        return [
            Place(id: "home", name: "Home", kind: .home, latitude: 40.7411, longitude: -73.9897, radius: 150, label: "Cedar St"),
            Place(id: "office", name: "Office", kind: .office, latitude: 40.7484, longitude: -73.9857, radius: 200, label: "Park Ave S"),
            Place(id: "moms", name: "Mom's", kind: .saved, latitude: 40.7306, longitude: -74.0659, radius: 150, label: "Maplewood"),
            Place(id: "gym", name: "Gym", kind: .saved, latitude: 40.7397, longitude: -73.9904, radius: 100, label: "Equinox Flatiron"),
        ]
    }

    static var access: PlaceMonitor.Access? {
        guard active else { return nil }
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-qaPlacesAccess"), arguments.indices.contains(index + 1) else { return .always }
        return switch arguments[index + 1] {
        case "notAsked": .notAsked
        case "whileUsing": .whileUsing
        case "denied": .denied
        default: .always
        }
    }
}
#endif
