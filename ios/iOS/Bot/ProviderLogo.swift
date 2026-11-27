import SwiftUI

/// An agent provider's logo: BB's own artwork (`/api/v1/system/providers/<id>/logo`),
/// bundled because it is SVG, drawn as a mask in the provider's `iconTint`, or
/// in the text colour when it has none, as desktop's `ProviderIcon` does.
struct ProviderLogo: View {
    private let asset: String
    private let tint: Color?

    /// Nil for a provider the app has no logo for.
    init?(_ providerId: String?) {
        guard let providerId, let tint = Self.known[providerId] else { return nil }
        asset = "ProviderLogos/\(providerId)"
        self.tint = tint
    }

    /// The providers with bundled artwork and their `strings.iconTint`.
    static let known: [String: Color?] = [
        "codex": nil,
        "claude-code": Color(red: 0xD9 / 255, green: 0x77 / 255, blue: 0x57 / 255),
        "pi": Color(red: 0x6D / 255, green: 0x5D / 255, blue: 0xFB / 255),
        "acp-opencode": Color(red: 0x25 / 255, green: 0x63 / 255, blue: 0xEB / 255),
    ]

    var body: some View {
        Image(asset)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .foregroundStyle(tint.map { AnyShapeStyle($0) } ?? AnyShapeStyle(.primary))
    }
}

extension Look {
    var stackFill: Color { canvas.mix(with: ink, by: mode == .light ? 0.035 : 0.08) }
}
