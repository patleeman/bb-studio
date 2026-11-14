import SwiftUI

extension BBClient {
    func setBotTheme(botId: String, themeId: String, keeping current: Studio.BotSpacesOutputBotsItemAppearance?) async throws {
        var appearance: [String: JSONValue?] = [:]
        if let current, case .object(let fields)? = try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(current)) {
            for (key, value) in fields { appearance[key] = value }
        }
        appearance["themeId"] = .string(themeId)
        let _: Studio.BotSetAppearanceOutput = try await rpc("studio", Studio.Method.bot_set_appearance,
                                                             .object(["botId": .string(botId), "appearance": .object(omittingNil: appearance)]))
    }
}

struct RoomThemePicker: View {
    let bot: BotSpace
    let current: String
    var choose: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var looks = LookStore.shared

    var body: some View {
        List {
            Section {
                ForEach(looks.catalog.sceneThemes) { theme in
                    Button {
                        choose(theme.id)
                        dismiss()
                    } label: {
                        HStack(spacing: 12) {
                            HStack(spacing: 0) {
                                ForEach(Array(theme.palette.prefix(4).enumerated()), id: \.offset) { _, hex in
                                    Color(lookHex: hex).frame(width: 9, height: 28)
                                }
                            }
                            .clipShape(.rect(cornerRadius: 6))
                            Text(theme.name).foregroundStyle(.primary)
                            Spacer()
                            if theme.id == current { Image(systemName: "checkmark").foregroundStyle(.tint).fontWeight(.semibold) }
                        }
                        .frame(minHeight: 44)
                        .contentShape(.rect)
                    }
                    .accessibilityAddTraits(theme.id == current ? .isSelected : [])
                    .accessibilityIdentifier("roomTheme-\(theme.id)")
                }
            } footer: {
                Text("Changes \(bot.name)'s scene here and on the Mac.")
            }
        }
        .navigationTitle("\(bot.name)'s theme")
        .navigationBarTitleDisplayMode(.inline)
    }
}
