import SwiftUI

/// Settings → Look: On Air, the 8 Classic themes and the 9 scene themes, plus
/// following each Bot's desktop theme and the Live scene switch.
struct LookSettingsView: View {
    @ObservedObject var store: LookStore = .shared
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Form {
            Section {
                Toggle("Follow each Bot's theme", isOn: $store.followBot)
                    .accessibilityIdentifier("LookFollowBot")
            } footer: {
                Text("Uses the theme each Bot wears on the Mac. Off, every Bot uses the theme chosen here.")
            }
            Section("Classic") {
                ForEach(store.catalog.classics) { row($0) }
            }
            Section {
                ForEach(store.catalog.sceneThemes) { row($0) }
            } header: {
                Text("Scenes")
            } footer: {
                Text("A scene shows as a still behind the Bot's list and shifts a little as you tilt the phone. It never sits behind a conversation.")
            }
            Section {
                Toggle("Live scene", isOn: $store.liveScene)
                    .accessibilityIdentifier("LookLiveScene")
            } footer: {
                Text(liveFooter)
            }
        }
        .navigationTitle("Look")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var liveFooter: String {
        var text = "Runs the scene's own animation while the app is open, at up to \(LookStore.liveFPS) frames a second. It stops in Low Power Mode, when the phone runs hot and with Reduce Motion."
        if store.liveScene, !store.motionAllowed { text += " It is stopped now." }
        return text
    }

    private func row(_ theme: LookTheme) -> some View {
        let tokens = theme.variant(theme.fixedScheme ?? scheme).tokens
        return Button { store.themeId = theme.id } label: {
            HStack(spacing: 12) {
                HStack(spacing: 0) {
                    ForEach(Array(theme.palette.prefix(4).enumerated()), id: \.offset) { _, hex in
                        Color(lookHex: hex).frame(width: 9, height: 28)
                    }
                }
                .clipShape(.rect(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color(lookHex: tokens.ink).opacity(0.15)))
                VStack(alignment: .leading, spacing: 1) {
                    Text(theme.name).foregroundStyle(.primary)
                    Text(subtitle(theme)).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer()
                if store.themeId == theme.id { Image(systemName: "checkmark").foregroundStyle(.tint).fontWeight(.semibold) }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("LookTheme-\(theme.id)")
        .accessibilityAddTraits(store.themeId == theme.id ? .isSelected : [])
    }

    private func subtitle(_ theme: LookTheme) -> String {
        if theme.id == LookTheme.onAirId { return "Graphite. The phone's default" }
        switch (theme.modes["light"] != nil, theme.modes["dark"] != nil) {
        case (true, true): return "Light and dark"
        case (true, false): return "Light"
        default: return "Dark"
        }
    }
}
