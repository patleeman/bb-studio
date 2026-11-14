import SwiftUI

@Observable @MainActor final class ClassicBotActivity {
    static let shared = ClassicBotActivity()

    private(set) var away = false
    private(set) var writing = false
    private(set) var reading = false
    private(set) var drafting = false
    private(set) var browsing = false
    @ObservationIgnored private var readingByThread: [String: Bool] = [:]

    var busy: Bool { away || writing || reading || drafting || browsing }

    func setAway(_ value: Bool) { if away != value { away = value } }
    func setWriting(_ value: Bool) { if writing != value { writing = value } }
    func setDrafting(_ value: Bool) { if drafting != value { drafting = value } }
    func setBrowsing(_ value: Bool) { if browsing != value { browsing = value } }

    func setReading(_ value: Bool, threadId: String? = nil) {
        if let threadId { readingByThread[threadId] = value }
        if reading != value { reading = value }
    }

    func reading(threadId: String) -> Bool { readingByThread[threadId] ?? false }

    static let touchHold: TimeInterval = 5

    static func held(now: Date = .now) -> Bool {
        presenting || now.timeIntervalSince(TouchClock.last) < touchHold
    }

    static var presenting: Bool {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
            .contains { $0.isKeyWindow && $0.rootViewController?.presentedViewController != nil }
    }
}

@MainActor
enum TouchClock {
    private(set) static var last = Date.distantPast

    static func forget() { last = .distantPast }

    static func watch() {
        for window in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows)
        where window.gestureRecognizers?.contains(where: { $0 is Recognizer }) != true {
            window.addGestureRecognizer(Recognizer())
        }
    }

    private final class Recognizer: UIGestureRecognizer, UIGestureRecognizerDelegate {
        init() {
            super.init(target: nil, action: nil)
            cancelsTouchesInView = false
            delaysTouchesBegan = false
            delaysTouchesEnded = false
            delegate = self
        }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
            TouchClock.last = .now
            state = .failed
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}

struct SpacesLoadingView: View {
    @ObservedObject private var looks = LookStore.shared
    @State private var bot: BotSpace?
    @State private var dots: Bool

    init(serverURL: URL) {
        let bot = BotSpacesCache.loadSpaces(serverURL: serverURL)?.current
        _bot = State(initialValue: bot)
        _dots = State(initialValue: Self.dots(bot: bot, view: bot.flatMap { BotSpacesCache.loadView($0.id, serverURL: serverURL) }))
    }

    static func dots(bot: BotSpace?, view: BotThreadsView?) -> Bool {
        guard let bot, let view, let main = BotShell.mainThreadId(bot, view: view) else { return true }
        return RoomPager.order(main: main, conversations: view.conversations).count > 1
    }

    var body: some View {
        let theme = RoomTheme.resolve(botThemeId: bot?.appearance?.themeId, phoneThemeId: looks.themeId, catalog: looks.catalog)
        SpacesLoadingScene(bot: bot ?? Self.placeholder, dots: dots)
            .lookRoot(bot: bot, theme: theme)
    }

    static let placeholder = BotSpace(Studio.BotSpacesOutputBotsItem(id: "bot_loading", name: BotInfo.defaultName))!
}

private struct SpacesLoadingScene: View {
    let bot: BotSpace
    let dots: Bool
    @Environment(\.look) private var look

    var body: some View {
        RoomColumn {
            Color.clear.frame(height: 44)
        } presence: { size in
            PresenceView(bot: bot, state: .idle, workers: 0, size: size, room: PresenceSpec.roomHeadroom)
                .roomPresenceSlot(size)
        } below: { _ in
            EmptyView()
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: RoomDock.height(dots: dots)) }
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
