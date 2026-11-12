import SwiftUI

/// After the Bots load: fetch agent-made presences, and write each Bot's four
/// presence stills to the app group for its widgets and Live Activity.
@MainActor
enum LookExport {
    static func run(store: BotSpacesStore, client: BBClient, looks: LookStore = .shared) async {
        guard let bots = store.spaces?.bots, !bots.isEmpty else { return }
        await PresenceCatalog.shared.refresh(client: client)
        for bot in bots {
            let theme = looks.theme(for: bot)
            let look = Look(theme: theme, scheme: theme.fixedScheme ?? .dark)
            await PresenceStills.shared.exportForWidgets(bot: bot, look: look, custom: PresenceCatalog.shared.entry(bot.presence?.form))
            if Task.isCancelled { return }
        }
    }
}
