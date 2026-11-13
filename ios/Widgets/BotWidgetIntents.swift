import AppIntents
import SwiftUI
import WidgetKit

/// A Bot to pick in a widget's settings.
struct BotWidgetEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Bot"
    static let defaultQuery = BotWidgetQuery()

    var id: String
    var name: String
    var avatar: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(avatar.isEmpty ? "" : avatar + " ")\(name)")
    }

    init(id: String, name: String, avatar: String) {
        self.id = id
        self.name = name
        self.avatar = avatar
    }

    init(_ bot: BotSpace) {
        self.init(id: bot.id, name: bot.name, avatar: bot.avatar)
    }
}

/// The Bots the app last loaded, else asked for.
struct BotWidgetQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [BotWidgetEntity] {
        let bots = await Self.bots()
        return identifiers.compactMap { id in bots.first { $0.id == id } }
    }

    func suggestedEntities() async throws -> [BotWidgetEntity] { await Self.bots() }

    static func bots() async -> [BotWidgetEntity] {
        let serverURL = ServerScope.selectedURL
        if let spaces = BotSpacesCache.loadSpaces(serverURL: serverURL), !spaces.bots.isEmpty {
            return spaces.bots.map(BotWidgetEntity.init)
        }
        let client = BBClient()
        guard let spaces = try? await client.botSpaces() else { return [] }
        BotSpacesCache.saveSpaces(spaces, serverURL: client.baseURL)
        return spaces.bots.map(BotWidgetEntity.init)
    }
}

/// The Bot widgets' settings: which Bot. None follows the current Bot.
struct BotWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Bot"
    static let description = IntentDescription("Choose the Bot this widget shows.")

    @Parameter(title: "Bot", description: "Leave empty to follow your current Bot.")
    var bot: BotWidgetEntity?

    init() {}
    init(bot: BotWidgetEntity?) { self.bot = bot }
}

/// A Bot's presence still for its state (written by the app), else its drawn avatar.
struct WidgetPresence: View {
    let botId: String?
    let state: BotPresenceState
    let look: BotLook
    var size: CGFloat = 30

    var body: some View {
        if let botId, let data = PresenceStillFiles.data(botId: botId, state: state), let image = UIImage(data: data) {
            Image(uiImage: image).resizable().interpolation(.high).scaledToFit()
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        } else {
            BotAvatar(look, size: size)
        }
    }
}

extension BotPresenceState {
    /// The header's status word.
    var widgetLabel: String {
        switch self {
        case .idle: "Ready"
        case .thinking: "Thinking…"
        case .working: "Working"
        case .needs: "Needs you"
        }
    }
}
