import SwiftUI

/// While Studio's Bots load (a first launch, or a new server): the Bot's
/// scene and its presence still, as the conversation will show them, and a
/// spinner. A link or push that came in meanwhile opens once the room shows.
struct SpacesLoadingView: View {
    @ObservedObject private var looks = LookStore.shared
    @State private var bot: BotSpace?

    init(serverURL: URL) {
        _bot = State(initialValue: BotSpacesCache.loadSpaces(serverURL: serverURL)?.current)
    }

    var body: some View {
        let theme = RoomTheme.resolve(botThemeId: bot?.appearance?.themeId, phoneThemeId: looks.themeId, catalog: looks.catalog)
        SpacesLoadingScene(bot: bot ?? Self.placeholder)
            .lookRoot(bot: bot, theme: theme)
    }

    static let placeholder = BotSpace(Studio.BotSpacesOutputBotsItem(id: "bot_loading", name: BotInfo.defaultName))!
}

private struct SpacesLoadingScene: View {
    let bot: BotSpace
    @Environment(\.look) private var look

    var body: some View {
        VStack(spacing: 18) {
            PresenceView(bot: bot, state: .idle, workers: 0, size: 72, stillOnly: true)
            ProgressView().tint(.white)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                SceneBackdrop(theme: look.theme)
                Color.black.opacity(0.45).ignoresSafeArea()
            }
            .allowsHitTesting(false)
        }
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
        .accessibilityIdentifier("spacesLoading")
    }
}
