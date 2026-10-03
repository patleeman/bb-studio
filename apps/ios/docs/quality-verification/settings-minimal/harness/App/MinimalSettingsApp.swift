import SwiftUI

/// Standalone local state: no BB code, network calls, shared defaults, or hosts.
@main
struct MinimalSettingsApp: App {
    var body: some Scene {
        WindowGroup { ControlsView() }
    }
}

private struct ControlsView: View {
    @State private var keepAwake = false
    @State private var limit = 0
    @State private var url = "http://127.0.0.1:49486"
    private let variant = UserDefaults.standard.string(forKey: "controlCase") ?? "baseline"
    private var plainStepper: Bool { variant == "stepper" || variant == "both" }
    private var plainHost: Bool { variant == "host" || variant == "both" }
    private var limitText: String { limit == 0 ? "Automatic" : String(limit) }
    private var componentOnly: Bool { variant.hasSuffix("-only") || variant == "empty" }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Staged URL (display only)", text: $url, axis: .vertical)
                        .accessibilityLabel("BB server URL")
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    Button("Save and test") {} // Deliberately has no network action.
                } header: {
                    Text("BB server").foregroundStyle(Color.primary.opacity(0.75))
                } footer: {
                    Text("Reached over Tailscale Serve. BB has no client auth, so the tailnet is the boundary.")
                        .foregroundStyle(Color.primary.opacity(0.75))
                }
                Section {
                    if !componentOnly || variant == "toggle-only" {
                        Toggle("Keep Mac awake", isOn: $keepAwake)
                    }
                    if !componentOnly || variant.contains("stepper") {
                      if variant == "standard-stepper-only" {
                        Stepper("Threads at once", value: $limit, in: 0...32)
                      } else if variant == "separate-stepper-only" {
                        Stepper("Threads at once", value: $limit, in: 0...32)
                            .accessibilityValue(limitText)
                        LabeledContent("Configured limit", value: limitText)
                      } else if plainStepper {
                        Stepper(value: $limit, in: 0...32) {
                            HStack {
                                Text("Threads at once")
                                Spacer()
                                Text(limitText).foregroundStyle(Color.primary.opacity(0.75))
                            }
                        }
                        .accessibilityLabel("Threads at once")
                        .accessibilityValue(limitText)
                    } else {
                        Stepper(value: $limit, in: 0...32) {
                            LabeledContent("Threads at once") {
                                Text(limitText).foregroundStyle(Color.primary.opacity(0.75))
                            }
                        }
                    }
                    }
                    if !componentOnly || variant == "host-only" {
                      if plainHost {
                        HStack {
                            Text("Patrick's MegaMac")
                            Spacer()
                            Text("18 at once")
                        }
                        .font(.footnote)
                        .accessibilityElement(children: .combine)
                    } else {
                        LabeledContent("Patrick's MegaMac", value: "18 at once")
                            .font(.footnote)
                            .foregroundStyle(.primary)
                    }
                    }
                } header: {
                    Text("Hosts").foregroundStyle(Color.primary.opacity(0.75))
                } footer: {
                    Text("Keep awake stops the machines idle-sleeping while BB works. Threads at once caps how many run in parallel; Automatic uses each host's core count.")
                        .foregroundStyle(Color.primary.opacity(0.75))
                }
                Section {
                    Label("Plugins", systemImage: "puzzlepiece.extension")
                } header: { Text("Server").foregroundStyle(Color.primary.opacity(0.75)) }
                Section {
                    Label("Archived threads", systemImage: "archivebox")
                } header: { Text("Threads").foregroundStyle(Color.primary.opacity(0.75)) }
            }
            .navigationTitle("Settings")
            .tint(Color(red: 199 / 255, green: 67 / 255, blue: 26 / 255))
            .accessibilityIdentifier("minimal-\(variant)")
        }
    }
}
