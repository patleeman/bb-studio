import MapKit
import SwiftUI

/// Settings ▸ Places: Home, Office and saved places that loops can wait on
/// ("call the plumber when I'm home"), and location access. Places stay on
/// this iPhone; Studio only hears "arrived at Home" or "left Office".
struct PlacesView: View {
    @State private var store = PlacesStore.shared
    @State private var access = PlaceMonitor.shared.access
    @State private var editing: Place?
    @State private var explaining = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        Form {
            Section {
                Toggle(isOn: $store.enabled) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Place triggers")
                        Text("Hold todos until you arrive or leave").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("places-toggle")
            } footer: {
                Text("Places stay on this iPhone. Studio only hears “arrived at Home” or “left Office”.")
            }
            Section("Your places") {
                fixedRow(.home, "Home", symbol: "house", tint: .orange)
                fixedRow(.office, "Office", symbol: "building.2", tint: .indigo)
            }
            Section("Saved places") {
                ForEach(store.saved) { place in
                    placeRow(place, symbol: "mappin.and.ellipse", tint: .pink)
                }
                .onDelete { offsets in offsets.map { store.saved[$0] }.forEach(store.remove) }
                Button {
                    editing = Place(name: "", kind: .saved, latitude: 0, longitude: 0)
                } label: {
                    Label("Add a place", systemImage: "plus")
                }
                .disabled(store.isFull)
                .accessibilityIdentifier("places-add")
            }
            Section {
                Button {
                    if access == .notAsked || access == .whileUsing { explaining = true }
                    else if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                } label: {
                    HStack {
                        Text("Allow location").foregroundStyle(.primary)
                        Spacer()
                        Text(accessLabel).foregroundStyle(.secondary)
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                }
                .accessibilityIdentifier("places-access")
            } header: {
                Text("Location access")
            } footer: {
                Text(accessFooter)
            }
        }
        .navigationTitle("Places")
        .sheet(item: $editing) { place in
            PlaceEditor(place: place) { store.save($0) } remove: { store.remove($0) }
        }
        .fullScreenCover(isPresented: $explaining) {
            LocationExplainer {
                explaining = false
                PlaceMonitor.shared.requestAccess()
            } later: {
                explaining = false
            }
        }
        .onAppear {
            access = PlaceMonitor.shared.access
            PlaceMonitor.shared.accessChanged = { access = $0 }
        }
    }

    private var accessLabel: String {
        switch access {
        case .always: "Always"
        case .whileUsing: "While Using"
        case .denied: "Off"
        case .notAsked: "Not set"
        }
    }

    private var accessFooter: String {
        let count = "\(store.places.count) of \(PlacesStore.limit) places in use. iOS lets an app watch up to \(PlacesStore.limit)."
        switch access {
        case .whileUsing: return "Places only work while Studio is open until you choose Always. " + count
        case .denied: return "Location is off for Studio, so todos can't wait for a place. Turn it on in Settings. " + count
        default: return count
        }
    }

    @ViewBuilder
    private func fixedRow(_ kind: Place.Kind, _ name: String, symbol: String, tint: Color) -> some View {
        if let place = store.places.first(where: { $0.kind == kind }) {
            placeRow(place, symbol: symbol, tint: tint)
        } else {
            Button {
                editing = Place(name: name, kind: kind, latitude: 0, longitude: 0)
            } label: {
                HStack(spacing: 14) {
                    PlaceIcon(symbol: symbol, tint: tint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name).foregroundStyle(.primary)
                        Text("Not set").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
            .tint(.primary)
        }
    }

    private func placeRow(_ place: Place, symbol: String, tint: Color) -> some View {
        Button { editing = place } label: {
            HStack(spacing: 14) {
                PlaceIcon(symbol: symbol, tint: tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(place.name).foregroundStyle(.primary)
                    Text([place.label, "\(Int(place.radius)) m"].compactMap { $0 }.joined(separator: " · "))
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
        .tint(.primary)
        .accessibilityIdentifier("place-\(place.name)")
    }
}

private struct PlaceIcon: View {
    let symbol: String
    let tint: Color
    var body: some View {
        Image(systemName: symbol)
            .font(.body.weight(.semibold))
            .foregroundStyle(.white)
            .frame(width: 32, height: 32)
            .background(tint, in: .rect(cornerRadius: 8, style: .continuous))
    }
}

/// A place's name, where it is (a pin on the map, or where you are now) and
/// how far around it counts.
struct PlaceEditor: View {
    @State var place: Place
    let save: (Place) -> Void
    let remove: (Place) -> Void
    @State private var camera: MapCameraPosition
    @State private var locating = false
    @State private var message: String?
    @Environment(\.dismiss) private var dismiss

    init(place: Place, save: @escaping (Place) -> Void, remove: @escaping (Place) -> Void) {
        _place = State(initialValue: place)
        self.save = save
        self.remove = remove
        let placed = place.latitude != 0 || place.longitude != 0
        _camera = State(initialValue: placed
            ? .region(MKCoordinateRegion(center: place.coordinate, latitudinalMeters: place.radius * 6, longitudinalMeters: place.radius * 6))
            : .automatic)
    }

    private var placed: Bool { place.latitude != 0 || place.longitude != 0 }

    var body: some View {
        NavigationStack {
            Form {
                if place.kind == .saved {
                    Section("Name") {
                        TextField("Mom's, Gym…", text: $place.name)
                            .accessibilityIdentifier("place-name")
                    }
                }
                Section {
                    MapReader { proxy in
                        Map(position: $camera) {
                            if placed {
                                Marker(place.name.isEmpty ? "Place" : place.name, coordinate: place.coordinate)
                                MapCircle(center: place.coordinate, radius: place.radius)
                                    .foregroundStyle(Color.accentColor.opacity(0.2))
                                    .stroke(Color.accentColor, lineWidth: 1)
                            }
                        }
                        .onTapGesture { point in
                            if let coordinate = proxy.convert(point, from: .local) {
                                place.latitude = coordinate.latitude
                                place.longitude = coordinate.longitude
                            }
                        }
                    }
                    .frame(height: 240)
                    .listRowInsets(EdgeInsets())
                    Button {
                        Task { await useCurrentLocation() }
                    } label: {
                        Label(locating ? "Finding you…" : "Use current location", systemImage: "location")
                    }
                    .disabled(locating)
                    if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }
                } footer: {
                    Text("Tap the map to drop the pin.")
                }
                Section {
                    VStack(alignment: .leading) {
                        Text("Radius: \(Int(place.radius)) m")
                        Slider(value: $place.radius, in: Place.radii, step: 50)
                    }
                    TextField("Label, such as the street (stays on this iPhone)", text: Binding(
                        get: { place.label ?? "" }, set: { place.label = $0.isEmpty ? nil : $0 }))
                }
                if PlacesStore.shared.places.contains(where: { $0.id == place.id }) {
                    Section {
                        Button("Remove place", role: .destructive) {
                            remove(place)
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle(place.kind == .saved ? (place.name.isEmpty ? "New place" : place.name) : place.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save(place)
                        dismiss()
                    }
                    .disabled(!placed || place.name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func useCurrentLocation() async {
        guard [.whileUsing, .always].contains(PlaceMonitor.shared.access) else {
            message = "Allow location in Places first, or drop a pin on the map."
            return
        }
        locating = true
        defer { locating = false }
        guard let location = await PlaceMonitor.shared.currentLocation() else {
            message = "Couldn't find you. Drop a pin on the map instead."
            return
        }
        place.latitude = location.coordinate.latitude
        place.longitude = location.coordinate.longitude
        camera = .region(MKCoordinateRegion(center: location.coordinate, latitudinalMeters: place.radius * 6, longitudinalMeters: place.radius * 6))
    }
}

/// Why Studio wants location Always, before iOS asks. iOS asks in two
/// steps: While Using now, then Always later, when it chooses.
struct LocationExplainer: View {
    let proceed: () -> Void
    let later: () -> Void

    var body: some View {
        VStack(spacing: 28) {
            Spacer(minLength: 20)
            Image(systemName: "location")
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(Color.accentColor)
                .frame(width: 72, height: 72)
                .background(Color.accentColor.opacity(0.15), in: .rect(cornerRadius: 18, style: .continuous))
            Text("Let Studio notice when you get home")
                .font(.title.bold())
                .multilineTextAlignment(.center)
            VStack(alignment: .leading, spacing: 22) {
                point("house", "Todos wait for the right place", "“Call the plumber” comes back when you arrive home, not at 2 PM at the office.")
                point("lock", "Only the place name leaves this iPhone", "Studio hears “arrived at Home” or “left Office”. No coordinates, no history.")
                point("battery.50", "Light on battery", "iOS watches your places for Studio, even when Studio is closed.")
            }
            (Text("iOS asks in two steps. Choose ") + Text("Allow While Using App").bold() + Text(" now, then ")
                + Text("Change to Always Allow").bold() + Text(" when iOS asks later. Without Always, places only work while Studio is open."))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            VStack(spacing: 14) {
                Button(action: proceed) {
                    Text("Continue").font(.headline).frame(maxWidth: .infinity).frame(minHeight: 50)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("location-continue")
                Button("Not now", action: later)
            }
        }
        .padding(24)
        .accessibilityIdentifier("location-explainer")
    }

    private func point(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: symbol)
                .foregroundStyle(Color.accentColor)
                .frame(width: 44, height: 44)
                .background(Color.accentColor.opacity(0.15), in: .rect(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}
