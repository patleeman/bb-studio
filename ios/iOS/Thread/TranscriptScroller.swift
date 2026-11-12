import SwiftUI

/// The transcript's `ScrollPosition`, kept out of `ThreadView`'s state.
///
/// Held in `ThreadView`'s own `@State`, every scroll request redrew the
/// whole thread: the composer, the shelf and, in the Bot's chat, a diff of
/// every row. The restore after a fold or a pane change asks for the end
/// ten times a second, and SwiftUI also wrote earlier requests back into
/// the binding, which re-applied them: two positions taking turns, a
/// redraw each. With a long chat on the Duo that never settled, and on
/// Oct 26 the main thread spent 10 s in it, once while a question was
/// being answered and once while the window changed (0x8BADF00D).
///
/// Only `TranscriptScrollPosition` reads `position`, so a request redraws
/// that modifier alone; and the binding takes no writes back, so the only
/// positions are the ones asked for.
@MainActor @Observable
final class TranscriptScroller {
    fileprivate var position = ScrollPosition()

    func scrollTo(y: CGFloat) { position.scrollTo(y: y) }

    func scrollTo(id: String, anchor: UnitPoint) { position.scrollTo(id: id, anchor: anchor) }
}

/// Binds the scroll view to its `TranscriptScroller`, one way. Nothing reads
/// the position back: where the transcript is comes from its geometry.
struct TranscriptScrollPosition: ViewModifier {
    let scroller: TranscriptScroller

    func body(content: Content) -> some View {
        #if DEBUG
        let _ = RenderCount.bump("scrollPosition.body")
        #endif
        let position = scroller.position
        content.scrollPosition(Binding(get: { position }, set: { _ in
            #if DEBUG
            RenderCount.bump("scrollPosition.writeBack")
            #endif
        }))
    }
}
