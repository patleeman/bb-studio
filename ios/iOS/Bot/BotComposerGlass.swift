import SwiftUI


/// The Bot's composer floats on Liquid Glass. Not `.interactive()`: that
/// glass takes the touches meant for the mic's hold-to-talk gesture, so a tap
/// on the mic focused the field instead.
struct BotComposerGlass: ViewModifier {
    let active: Bool
    @Environment(\.look) private var look

    func body(content: Content) -> some View {
        if active {
            content
                .background(look.stackFill, in: .rect(cornerRadius: 24))
                .glassEffect(.regular, in: .rect(cornerRadius: 24))
        } else {
            content
        }
    }
}
