import SwiftUI

/// A Bot's scene theme: its own, else the phone's, else the default.
enum RoomTheme {
    static let fallback = "aurora-fjord"

    static func resolve(botThemeId: String?, phoneThemeId: String?, catalog: LookCatalog) -> LookTheme {
        for id in [botThemeId, phoneThemeId].compactMap({ $0 }) {
            let canonical = LookTheme.canonical(id)
            if let theme = catalog.themes.first(where: { $0.id == canonical }), theme.kind == .scene { return theme }
        }
        return catalog.themes.first { $0.id == fallback } ?? catalog.theme(fallback)
    }

    /// Saves a Bot's theme, showing it at once and putting the old one back if Studio refuses.
    @MainActor
    static func choose(_ themeId: String, bot: BotSpace, router: Router, store: BotSpacesStore, app: AppModel) {
        let previous = router.themeOverride[bot.id]
        router.themeOverride[bot.id] = themeId
        Task {
            do {
                try await app.client.setBotTheme(botId: bot.id, themeId: themeId, keeping: bot.appearance)
                await store.refresh()
                if router.themeOverride[bot.id] == themeId { router.themeOverride[bot.id] = nil }
            } catch {
                router.themeOverride[bot.id] = previous
                app.flash("The theme didn't change: " + BBClient.describe(error))
            }
        }
    }
}

