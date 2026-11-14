import SwiftUI

@Observable @MainActor final class ClassicBotActivity {
    static let shared = ClassicBotActivity()

    var away = false
    var writing = false

    var busy: Bool { away || writing }
}

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

    static let dock: CGFloat = 76

    var body: some View {
        GeometryReader { proxy in
            let fit = RoomDayView.fit(CGSize(width: proxy.size.width, height: max(0, proxy.size.height - Self.dock)))
            VStack(spacing: 0) {
                Color.clear.frame(height: 44)
                PresenceView(bot: bot, state: .idle, workers: 0, size: fit.presence, room: PresenceSpec.roomHeadroom)
                    .frame(maxWidth: .infinity)
                    .frame(height: fit.presence * PresenceSpec.roomHeadroom)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 22)
            .padding(.top, 8)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .background {
            ZStack {
                SceneBackdrop(theme: look.theme)
                Rectangle().fill(.black.opacity(0.18)).ignoresSafeArea()
            }
            .allowsHitTesting(false)
        }
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
        .accessibilityIdentifier("spacesLoading")
    }
}
