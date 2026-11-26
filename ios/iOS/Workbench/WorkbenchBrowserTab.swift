import SwiftUI
import WebKit

/// A browser tab, as on the desktop: the page, with Back, Forward, Reload,
/// Safari, Copy Link and Share in the shell's More. Edge swipes go
/// back and forward; pinch zooms; a thin bar shows loading.
struct WorkbenchBrowserTab: View {
    let url: URL
    @State private var page = WebPage()
    @Environment(\.openURL) private var openURL

    private var shown: URL { page.url ?? url }

    var body: some View {
        WebKit.WebView(page)
            .webViewBackForwardNavigationGestures(.enabled)
            .webViewMagnificationGestures(.enabled)
            .overlay(alignment: .top) {
                if page.isLoading {
                    ProgressView(value: page.estimatedProgress).progressViewStyle(.linear).tint(.accentColor)
                }
            }
            .accessibilityIdentifier("browserTabPage")
            .screenActions(actions)
            .task(id: url) {
                guard page.url != url else { return }
                // A failed load shows WebKit's own error page; nothing to add here.
                do { for try await _ in page.load(URLRequest(url: url)) {} } catch {}
            }
    }

    private var actions: [ScreenAction] {
        let page = page, url = url
        return Self.navigation(page) + [
            ScreenAction(id: "safari", title: "Open in Safari", systemImage: "safari", run: { openURL(page.url ?? url) }),
            ScreenAction(id: "copy", title: "Copy Link", systemImage: "link", run: { UIPasteboard.general.url = page.url ?? url }),
            ScreenAction(id: "share", title: "Share", systemImage: "square.and.arrow.up", share: shown),
        ]
    }

    /// Back, Forward and Reload (Stop while loading). The closures read the page when
    /// they run: `ScreenAction` equality ignores closures, so the shell can keep a list
    /// made at an earlier page, and a history copied then would go back past the current one.
    @MainActor static func navigation(_ page: WebPage) -> [ScreenAction] {
        [
            ScreenAction(id: "back", title: "Back", systemImage: "chevron.backward", disabled: page.backForwardList.backList.isEmpty,
                         run: { go(page, to: page.backForwardList.backList.last) }),
            ScreenAction(id: "forward", title: "Forward", systemImage: "chevron.forward", disabled: page.backForwardList.forwardList.isEmpty,
                         run: { go(page, to: page.backForwardList.forwardList.first) }),
            page.isLoading
                ? ScreenAction(id: "reload", title: "Stop", systemImage: "xmark", run: { page.stopLoading() })
                : ScreenAction(id: "reload", title: "Reload", systemImage: "arrow.clockwise", run: { run(page.reload()) }),
        ]
    }

    @MainActor private static func go(_ page: WebPage, to item: WebPage.BackForwardList.Item?) {
        guard let item else { return }
        run(page.load(item))
    }

    @MainActor private static func run(_ navigation: some AsyncSequence<WebPage.NavigationEvent, any Error>) {
        Task { do { for try await _ in navigation {} } catch {} }
    }
}
