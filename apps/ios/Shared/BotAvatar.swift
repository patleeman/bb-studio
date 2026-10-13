import SwiftUI

// MARK: The Bot's drawn avatar

/// The Bot's drawn avatar, as Studio draws it on the desktop
/// (packages/bb-studio/src/ui/bot/BotAvatar.tsx): a solid shape in a color with
/// two dot eyes on a 40×40 board. A Bot without a shape shows its emoji.
public enum BotShape: String, CaseIterable, Sendable, Identifiable {
    case blob, circle, triangle, hexagon, cloud, droplet, square, star, pill

    public var id: String { rawValue }
    public static let `default` = BotShape.blob

    /// The SVG path on the 40×40 board, exactly as the desktop's.
    var svg: String {
        switch self {
        case .blob: "M20 3c8 0 15 5 16 13s-2 15-8 19-15 3-20-2S2 21 4 14 12 3 20 3Z"
        case .circle: "M20 3a17 17 0 1 1 0 34a17 17 0 1 1 0-34Z"
        case .triangle: "M20 4c1.6 0 2.7.8 3.6 2.3l13 23c1.6 2.8-.3 5.7-3.5 5.7H6.9c-3.2 0-5.1-2.9-3.5-5.7l13-23C17.3 4.8 18.4 4 20 4Z"
        case .hexagon: "M20 2.5l15 8.7v17.6L20 37.5 5 28.8V11.2Z"
        case .cloud: "M12 33a8 8 0 0 1-1.5-15.9A10 10 0 0 1 29.5 13 8.5 8.5 0 0 1 29 33Z"
        case .droplet: "M20 3c5 7 13 14 13 21a13 13 0 0 1-26 0C7 17 15 10 20 3Z"
        case .square: "M11 4h18a7 7 0 0 1 7 7v18a7 7 0 0 1-7 7H11a7 7 0 0 1-7-7V11a7 7 0 0 1 7-7Z"
        case .star: "M20 3l4.9 10 11 1.6-8 7.8 1.9 11L20 28.2 10.2 33.4l1.9-11-8-7.8 11-1.6Z"
        case .pill: "M13 9h14a11 11 0 0 1 0 22H13a11 11 0 0 1 0-22Z"
        }
    }

    /// Where the eyes sit on the board, as the desktop places them.
    public var eyesY: CGFloat {
        switch self {
        case .triangle: 25
        case .droplet, .cloud: 24
        case .star: 21
        default: 20
        }
    }

    public var label: String { rawValue.capitalized }

    /// The shape on the 40×40 board.
    public var path: Path { SVGPath.parse(svg) }
}

/// The desktop's twelve colors, in its order.
public enum BotPalette {
    public static let hexes = ["#5b8def", "#7c66dc", "#c862c6", "#e5484d", "#f2804a", "#f5b83d", "#46a758", "#2ba59a", "#3eb0d5", "#8d8d86", "#d9775c", "#1f9d75"]

    /// A color picked from the name, as the desktop's `colorForName`.
    public static func hex(forName name: String) -> String {
        var hash: UInt32 = 0
        for scalar in name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().unicodeScalars {
            hash = hash &* 31 &+ scalar.value
        }
        return hexes[Int(hash % UInt32(hexes.count))]
    }

    /// `#rrggbb` as a color; the first palette color for anything else.
    public static func color(_ hex: String?) -> Color {
        let rgb = rgb(hex) ?? rgb(hexes[0])!
        return Color(red: rgb.0, green: rgb.1, blue: rgb.2)
    }

    static func rgb(_ hex: String?) -> (Double, Double, Double)? {
        guard let hex, hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        return (Double((value >> 16) & 0xff) / 255, Double((value >> 8) & 0xff) / 255, Double(value & 0xff) / 255)
    }
}

/// What a Bot looks like: its image avatar if it has one, else its shape and
/// color, or its emoji when it has no shape.
public struct BotLook: Hashable, Sendable {
    public var shape: BotShape?
    public var color: String?
    public var emoji: String
    /// Its image avatar's server path (Studio's `/bots/avatar` route); the drawn avatar shows while it loads or if it fails.
    public var image: String?

    public init(shape: String?, color: String?, emoji: String, image: String? = nil) {
        self.shape = shape.flatMap(BotShape.init(rawValue:))
        self.color = color
        self.emoji = emoji
        self.image = image
    }

    /// The image avatar's URL on the selected server.
    var imageURL: URL? { image.flatMap { URL(string: $0, relativeTo: BBClient.storedServerURL) } }
}

/// The avatar. While `working`, the eyes glance and blink now and then (not
/// with Reduce Motion, and not while the app is in the background). Every
/// working avatar follows one shared clock.
public struct BotAvatar: View {
    let look: BotLook
    var size: CGFloat = 28
    var working = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    public init(_ look: BotLook, size: CGFloat = 28, working: Bool = false) {
        self.look = look
        self.size = size
        self.working = working
    }

    private var animates: Bool { working && !reduceMotion && scenePhase == .active }

    public var body: some View {
        if let url = look.imageURL {
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFill().frame(width: size, height: size).clipShape(.circle)
                } else {
                    face
                }
            }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
        } else {
            face
        }
    }

    private var face: some View {
        Group {
            if let shape = look.shape {
                // A still avatar never reads the clock, so its ticks don't redraw it.
                drawn(shape, blink: animates && BotBlinkClock.shared.blink, glance: animates ? BotBlinkClock.shared.glance : 0)
            } else {
                Text(look.emoji)
                    .font(.system(size: size * 0.55))
                    .frame(width: size, height: size)
                    .background(Color.primary.opacity(0.06), in: .circle)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
        .task(id: animates && look.shape != nil) {
            guard animates, look.shape != nil else { return }
            BotBlinkClock.shared.attach()
            while !Task.isCancelled { try? await Task.sleep(for: .seconds(3600)) }
            BotBlinkClock.shared.detach()
        }
    }

    private func drawn(_ shape: BotShape, blink: Bool, glance: CGFloat) -> some View {
        let scale = size / 40
        let y = shape.eyesY
        return ZStack(alignment: .topLeading) {
            shape.path.applying(CGAffineTransform(scaleX: scale, y: scale))
                .fill(BotPalette.color(look.color))
            ForEach([CGFloat(15.5), 24.5], id: \.self) { x in
                ZStack {
                    Circle().fill(.white).frame(width: 4.2 * scale, height: 4.2 * scale)
                    Circle().fill(Color(white: 0.07)).frame(width: 2 * scale, height: 2 * scale)
                        .offset(x: (0.4 + glance * 0.7) * scale, y: 0.3 * scale)
                }
                .scaleEffect(x: 1, y: blink ? 0.12 : 1)
                .position(x: x * scale, y: y * scale)
            }
        }
        .frame(width: size, height: size, alignment: .topLeading)
    }
}

/// One blink-and-glance loop for every working avatar on screen; it runs
/// only while at least one is attached.
@MainActor @Observable
final class BotBlinkClock {
    static let shared = BotBlinkClock()

    private(set) var blink = false
    private(set) var glance: CGFloat = 0
    @ObservationIgnored private var watchers = 0
    @ObservationIgnored private var loop: Task<Void, Never>?

    func attach() {
        watchers += 1
        guard loop == nil else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(Int.random(in: 1400...2600)))
                guard !Task.isCancelled, let self else { return }
                if Bool.random() {
                    withAnimation(.easeInOut(duration: 0.08)) { self.blink = true }
                    try? await Task.sleep(for: .milliseconds(110))
                    withAnimation(.easeInOut(duration: 0.12)) { self.blink = false }
                } else {
                    withAnimation(.smooth(duration: 0.35)) { self.glance = self.glance == 0 ? [-1, 1].randomElement()! : 0 }
                }
            }
        }
    }

    func detach() {
        watchers = max(0, watchers - 1)
        guard watchers == 0 else { return }
        loop?.cancel()
        loop = nil
        blink = false
        glance = 0
    }
}

// MARK: SVG paths

/// Enough of SVG path syntax for the avatar shapes: M L H V C S A Z, absolute and relative.
enum SVGPath {
    static func parse(_ d: String) -> Path {
        var path = Path()
        var scanner = Tokens(d)
        var command: Character = "M"
        var current = CGPoint.zero
        var start = CGPoint.zero
        var lastControl: CGPoint?
        while let next = scanner.next() {
            if case .command(let c) = next {
                command = c
                if c == "Z" || c == "z" {
                    path.closeSubpath()
                    current = start
                    lastControl = nil
                }
                continue
            }
            scanner.pushBack(next)
            let relative = command.isLowercase
            let base = relative ? current : .zero
            func point() -> CGPoint? {
                guard let x = scanner.number(), let y = scanner.number() else { return nil }
                return CGPoint(x: base.x + x, y: base.y + y)
            }
            switch command.uppercased().first! {
            case "M":
                guard let p = point() else { return path }
                path.move(to: p)
                current = p
                start = p
                lastControl = nil
                command = relative ? "l" : "L"
            case "L":
                guard let p = point() else { return path }
                path.addLine(to: p)
                current = p
                lastControl = nil
            case "H":
                guard let x = scanner.number() else { return path }
                current = CGPoint(x: relative ? current.x + x : x, y: current.y)
                path.addLine(to: current)
                lastControl = nil
            case "V":
                guard let y = scanner.number() else { return path }
                current = CGPoint(x: current.x, y: relative ? current.y + y : y)
                path.addLine(to: current)
                lastControl = nil
            case "C":
                guard let c1 = point(), let c2 = point(), let p = point() else { return path }
                path.addCurve(to: p, control1: c1, control2: c2)
                current = p
                lastControl = c2
            case "S":
                let c1 = lastControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                guard let c2 = point(), let p = point() else { return path }
                path.addCurve(to: p, control1: c1, control2: c2)
                current = p
                lastControl = c2
            case "A":
                guard let rx = scanner.number(), let ry = scanner.number(), let rotation = scanner.number(),
                    let large = scanner.number(), let sweep = scanner.number(), let p = point() else { return path }
                arc(&path, from: current, to: p, rx: rx, ry: ry, rotation: rotation, large: large != 0, sweep: sweep != 0)
                current = p
                lastControl = nil
            default:
                return path
            }
        }
        return path
    }

    /// An SVG endpoint arc as cubic curves (rotation is 0 in every avatar shape).
    private static func arc(_ path: inout Path, from p0: CGPoint, to p1: CGPoint, rx: CGFloat, ry: CGFloat, rotation: CGFloat, large: Bool, sweep: Bool) {
        var rx = abs(rx), ry = abs(ry)
        guard rx > 0, ry > 0, p0 != p1 else { path.addLine(to: p1); return }
        let phi = rotation * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1 = cosPhi * dx + sinPhi * dy, y1 = -sinPhi * dx + cosPhi * dy
        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lambda > 1 { rx *= sqrt(lambda); ry *= sqrt(lambda) }
        let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
        let den = rx * rx * y1 * y1 + ry * ry * x1 * x1
        var coef = sqrt(max(0, num / den))
        if large == sweep { coef = -coef }
        let cx1 = coef * rx * y1 / ry, cy1 = -coef * ry * x1 / rx
        let cx = cosPhi * cx1 - sinPhi * cy1 + (p0.x + p1.x) / 2
        let cy = sinPhi * cx1 + cosPhi * cy1 + (p0.y + p1.y) / 2
        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
            return a
        }
        let theta1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
        var delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
        if !sweep, delta > 0 { delta -= 2 * .pi } else if sweep, delta < 0 { delta += 2 * .pi }
        let segments = max(1, Int(ceil(abs(delta) / (.pi / 2))))
        let step = delta / CGFloat(segments)
        let k = 4 / 3 * tan(step / 4)
        func at(_ t: CGFloat) -> (CGPoint, CGPoint) {
            let x = rx * cos(t), y = ry * sin(t)
            let point = CGPoint(x: cx + cosPhi * x - sinPhi * y, y: cy + sinPhi * x + cosPhi * y)
            let ddx = -rx * sin(t), ddy = ry * cos(t)
            let tangent = CGPoint(x: cosPhi * ddx - sinPhi * ddy, y: sinPhi * ddx + cosPhi * ddy)
            return (point, tangent)
        }
        var t = theta1
        for _ in 0..<segments {
            let (a, ta) = at(t)
            let (b, tb) = at(t + step)
            path.addCurve(to: b, control1: CGPoint(x: a.x + k * ta.x, y: a.y + k * ta.y),
                          control2: CGPoint(x: b.x - k * tb.x, y: b.y - k * tb.y))
            t += step
        }
    }

    private enum Token { case command(Character), number(CGFloat) }

    private struct Tokens {
        private let chars: [Character]
        private var index = 0
        private var pushed: Token?

        init(_ text: String) { chars = Array(text) }

        mutating func pushBack(_ token: Token) { pushed = token }

        mutating func number() -> CGFloat? {
            guard let token = next() else { return nil }
            if case .number(let value) = token { return value }
            pushBack(token)
            return nil
        }

        mutating func next() -> Token? {
            if let token = pushed { pushed = nil; return token }
            while index < chars.count, chars[index] == " " || chars[index] == "," || chars[index].isNewline { index += 1 }
            guard index < chars.count else { return nil }
            let c = chars[index]
            if c.isLetter, c != "e", c != "E" {
                index += 1
                return .command(c)
            }
            var text = ""
            if c == "-" || c == "+" { text.append(c); index += 1 }
            var seenDot = false
            var seenExp = false
            while index < chars.count {
                let ch = chars[index]
                if ch.isNumber {
                    text.append(ch)
                } else if ch == ".", !seenDot, !seenExp {
                    seenDot = true
                    text.append(ch)
                } else if ch == "e" || ch == "E", !seenExp {
                    seenExp = true
                    text.append(ch)
                    if index + 1 < chars.count, chars[index + 1] == "-" || chars[index + 1] == "+" { index += 1; text.append(chars[index]) }
                } else {
                    break
                }
                index += 1
            }
            guard let value = Double(text) else { index += 1; return next() }
            return .number(CGFloat(value))
        }
    }
}
