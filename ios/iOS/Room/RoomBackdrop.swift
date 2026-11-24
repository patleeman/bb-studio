import SwiftUI

extension Look {
    var roomTint: Color { mode == .light ? Color(white: 0.96) : micTint }
    var micTint: Color { Color(lookHex: tokens.presence.palette.first ?? tokens.accent) }
}

struct RoomLightLayer: View {
    let light: RoomLight
    let seed: String
    var showsOrb = true
    var spot: SceneLight?

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                grade
                if showsOrb, let orb {
                    let size = spot == nil ? orb.size : orb.size * SceneLight.scale
                    Circle().fill(orb.color.opacity(orb.opacity))
                        .frame(width: size, height: size)
                        .shadow(color: orb.color.opacity(0.5), radius: size * 1.4)
                        .position(spot.map { CGPoint(x: $0.x, y: $0.y) } ?? RoomLightLayer.spot(seed: seed, size: proxy.size))
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var grade: some View {
        switch light {
        case .natural:
            Color.clear
        case .dusk:
            ZStack {
                LinearGradient(colors: [Color(red: 0.36, green: 0.28, blue: 0.5), Color(red: 0.8, green: 0.48, blue: 0.4), Color(red: 0.2, green: 0.14, blue: 0.18)],
                               startPoint: .top, endPoint: .bottom).blendMode(.color).opacity(0.55)
                LinearGradient(colors: [Color(red: 0.95, green: 0.62, blue: 0.45).opacity(0.28), .clear], startPoint: .center, endPoint: .top).blendMode(.screen)
            }
        case .night:
            ZStack {
                LinearGradient(colors: [Color(red: 0.12, green: 0.18, blue: 0.34), Color(red: 0.06, green: 0.09, blue: 0.16)], startPoint: .top, endPoint: .bottom)
                    .blendMode(.multiply).opacity(0.75)
                Color(red: 0.2, green: 0.3, blue: 0.5).blendMode(.color).opacity(0.35)
            }
        case .dawn:
            ZStack {
                LinearGradient(colors: [Color(red: 0.55, green: 0.5, blue: 0.75), Color(red: 0.98, green: 0.7, blue: 0.68), Color(red: 0.3, green: 0.26, blue: 0.3)],
                               startPoint: .top, endPoint: .bottom).blendMode(.color).opacity(0.45)
                LinearGradient(colors: [.clear, Color(red: 1, green: 0.78, blue: 0.7).opacity(0.22), .clear], startPoint: .top, endPoint: .bottom).blendMode(.screen)
            }
        case .morning:
            ZStack {
                LinearGradient(colors: [Color(red: 0.55, green: 0.75, blue: 0.85), Color(red: 0.95, green: 0.88, blue: 0.62)], startPoint: .top, endPoint: .bottom)
                    .blendMode(.softLight).opacity(0.7)
                LinearGradient(colors: [Color(red: 1, green: 0.95, blue: 0.8).opacity(0.25), .clear], startPoint: .top, endPoint: .center).blendMode(.screen)
            }
        }
    }

    static func spot(seed: String, size: CGSize) -> CGPoint {
        let hash = RoomLight.hash(seed)
        let side = Double(hash % 18) / 100
        let x = hash % 2 == 0 ? 0.1 + side : 0.72 + side
        return CGPoint(x: size.width * x, y: min(size.height * 0.2, 150) + Double((hash >> 8) % 30))
    }

    private var orb: (color: Color, size: CGFloat, opacity: Double)? {
        switch light {
        case .natural: nil
        case .dusk: (Color(red: 0.98, green: 0.74, blue: 0.55), 26, 0.75)
        case .night: (Color(red: 0.88, green: 0.9, blue: 0.92), 20, 0.55)
        case .dawn: (Color(red: 1, green: 0.8, blue: 0.75), 24, 0.6)
        case .morning: (Color(red: 1, green: 0.96, blue: 0.82), 28, 0.6)
        }
    }
}

struct RoomFrost: View {
    let pages: DuoPages?
    let layout: DuoLayout
    let light: RoomLight
    let seed: String
    var spot: SceneLight?
    var botId: String?
    var view: BotThreadsView?
    @Environment(\.look) private var look

    static let radius: CGFloat = 24

    var body: some View {
        ZStack {
            SceneBackdrop(theme: look.theme, botId: botId, view: view, stillOnly: true, light: spot, motion: false)
            RoomLightLayer(light: light, seed: seed, showsOrb: false)
        }
        .blur(radius: Self.radius, opaque: true)
        .mask { mask }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        #if DEBUG
        // UI tests read how far down the frost reaches (`roomFrost`'s frame):
        // a point-wide strip at its leading edge, over no control's centre,
        // so it never makes a button look covered.
        .overlay(alignment: .leading) {
            Color.clear.frame(width: 1).accessibilityElement().accessibilityIdentifier("roomFrost")
        }
        #endif
    }

    @ViewBuilder private var mask: some View {
        switch pages {
        case nil:
            Color.black
        case .sideBySide?:
            LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .clear, location: Self.seam(layout.windowSize.width) - 0.02),
                                   .init(color: .black, location: Self.seam(layout.windowSize.width) + 0.02), .init(color: .black, location: 1)],
                           startPoint: .leading, endPoint: .trailing)
        }
    }

    static func seam(_ length: CGFloat) -> CGFloat {
        guard length > 0 else { return 0.5 }
        return min(0.98, max(0.02, (length / 2 + DuoPages.hinge / 2) / length))
    }
}

#if DEBUG
struct RoomLightMarker: View {
    let spot: SceneLight

    var body: some View {
        GeometryReader { _ in
            Color.clear
                .frame(width: 18, height: 18)
                .accessibilityElement()
                .accessibilityLabel("Scene light")
                .accessibilityIdentifier("roomLightSpot")
                .position(x: spot.x, y: spot.y)
        }
        .ignoresSafeArea()
    }
}
#endif

enum RoomSceneLight {
    static let corner: CGFloat = 48
    static let phoneCorner: CGFloat = 70

    static func spot(_ proxy: GeometryProxy, pages: DuoPages?, rail: Bool) -> SceneLight? {
        let insets = proxy.safeAreaInsets
        let window = CGSize(width: proxy.size.width + insets.leading + insets.trailing, height: proxy.size.height + insets.top + insets.bottom)
        return spot(window: window, safeTop: insets.top, safeLeading: insets.leading, safeTrailing: insets.trailing, pages: pages, rail: rail)
    }

    static func page(window: CGSize, safeLeading: CGFloat, safeTrailing: CGFloat, pages: DuoPages?, rail: Bool) -> CGRect {
        let railWidth = rail || pages != nil ? max(FoldedChrome.column, safeTrailing) : safeTrailing
        switch pages {
        case .sideBySide?:
            return CGRect(x: safeLeading, y: 0, width: window.width / 2 - DuoPages.hinge / 2 - safeLeading, height: window.height)
        case nil:
            return CGRect(x: safeLeading, y: 0, width: window.width - railWidth - safeLeading, height: window.height)
        }
    }

    static func spot(window: CGSize, safeTop: CGFloat, safeLeading: CGFloat = 0, safeTrailing: CGFloat, pages: DuoPages?, rail: Bool) -> SceneLight? {
        guard window.width > 1, window.height > 1 else { return nil }
        let page = page(window: window, safeLeading: safeLeading, safeTrailing: safeTrailing, pages: pages, rail: rail)
        // A wide page (the unfolded Duo on its side): the light sits over the left column.
        if page.width >= 560 && page.width > page.height * 1.25 {
            let column = (page.width - 44 - 28) / 2
            return SceneLight(x: page.minX + 22 + column - corner / 2, y: safeTop + corner)
        }
        if pages == nil && !rail { return SceneLight(x: page.maxX - phoneCorner, y: safeTop + 80) }
        return SceneLight(x: page.maxX - corner, y: safeTop + corner)
    }
}

struct RoomShade: View {
    var standing = false
    @Environment(\.look) private var look

    var body: some View {
        let light = look.mode == .light
        ZStack {
            LinearGradient(stops: [.init(color: .black.opacity(light ? 0.2 : 0.08), location: 0), .init(color: .black.opacity(light ? 0.34 : 0.1), location: 0.28),
                                   .init(color: .black.opacity(light ? 0.62 : 0.5), location: 0.5), .init(color: .black.opacity(light ? 0.74 : 0.66), location: 1)],
                           startPoint: .top, endPoint: .bottom)
            Color.black.opacity(standing ? 0.42 : 0)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
