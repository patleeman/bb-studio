import SwiftUI
import UIKit

/// The folded Duo's outer screen is 466 × 678 points, and iOS gives its
/// navigation bar 82 of them (with the inset above it) for a title, while
/// the bar's buttons already sit in the right column under the clock. So
/// on that screen a chat's navigation bar goes: its title is one 20-point
/// line at the top (`FoldedChatTitle`), and its buttons stay in the column
/// (`FoldedColumn`), at the size and place iOS gave them. 62 points of chat.
enum FoldedChrome {
    /// The folded Duo: an iPhone on its 466 × 678 outer screen.
    @MainActor static var foldedDuo: Bool {
        guard UIDevice.current.userInterfaceIdiom == .phone,
              let screen = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first?.screen.bounds.size
        else { return false }
        return abs(screen.width - 466) < 1 && abs(screen.height - 678) < 1
    }

    /// A chat's header lives in the column.
    @MainActor static var columnHeader: Bool { foldedDuo }

    /// iOS's own column buttons: 48-point glass circles, 13 points apart,
    /// the first 170 points down (under the clock and connection ring),
    /// centred 48 points in from the window's edge.
    static let button: CGFloat = 48
    static let spacing: CGFloat = 13
    static let top: CGFloat = 170
    static let centreFromEdge: CGFloat = 48
}

/// The name and status in one line, for the folded Duo's top band.
struct FoldedChatTitle: View {
    let avatar: AnyView?
    let title: String
    let status: String?

    var body: some View {
        HStack(spacing: 6) {
            if let avatar { avatar }
            Text(title).font(.footnote.weight(.semibold)).lineLimit(1)
            if let status, !status.isEmpty {
                Text("· " + status).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .frame(height: 20)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("foldedChatTitle")
    }
}

/// A chat's header buttons in the folded Duo's right column, where iOS puts
/// a navigation bar's: one under another, each a glass circle as iOS draws
/// them. `FoldedColumnGroup` joins several into one capsule (voice and bell).
struct FoldedColumn<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        GeometryReader { proxy in
            let edge = proxy.size.width + proxy.safeAreaInsets.trailing
            VStack(spacing: FoldedChrome.spacing) { content }
                .buttonStyle(FoldedColumnButtonStyle())
                .menuStyle(.button)
                .labelStyle(.iconOnly)
                .fixedSize()
                .frame(width: FoldedChrome.button)
                .offset(x: edge - FoldedChrome.centreFromEdge - FoldedChrome.button / 2,
                        y: FoldedChrome.top - proxy.frame(in: .global).minY)
        }
    }
}

/// Buttons sharing one capsule, as iOS groups the bar's plain buttons.
struct FoldedColumnGroup<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .buttonStyle(FoldedColumnButtonStyle(grouped: true))
            .glassEffect(.regular.interactive(), in: .capsule)
    }
}

struct FoldedColumnButtonStyle: ButtonStyle {
    var grouped = false

    func makeBody(configuration: Configuration) -> some View {
        let label = configuration.label
            .font(.system(size: 19, weight: .medium))
            .frame(width: FoldedChrome.button, height: FoldedChrome.button)
            .contentShape(.circle)
            .opacity(configuration.isPressed ? 0.6 : 1)
        if grouped {
            AnyView(label)
        } else {
            AnyView(label.glassEffect(.regular.interactive(), in: .circle))
        }
    }
}

/// The bell with its count, as iOS badges a bar button: a red capsule with
/// the number at its top trailing corner, not the symbol's dot.
struct FoldedBell: View {
    let count: Int

    var body: some View {
        Image(systemName: "bell")
            .overlay(alignment: .topTrailing) {
                if count > 0 {
                    Text(count > 99 ? "99+" : "\(count)")
                        .font(.system(size: 12, weight: .semibold)).monospacedDigit()
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(.red, in: .capsule)
                        .fixedSize()
                        .offset(x: 9, y: -9)
                        .accessibilityHidden(true)
                }
            }
    }
}

/// Back out of a thread pushed on any stack (the Threads tab's, or the Bot
/// tab's). Its own view, so reading `dismiss` doesn't redraw the thread:
/// read in `ThreadView` itself, the chat never stopped redrawing.
struct FoldedBackButton: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Button { dismiss() } label: { Label("Back", systemImage: "chevron.backward") }
            .accessibilityIdentifier("folded-back")
    }
}
