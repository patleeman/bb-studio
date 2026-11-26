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
        let list = page.backForwardList
        return [
            ScreenAction(id: "back", title: "Back", systemImage: "chevron.backward", disabled: list.backList.isEmpty,
                               run: { go(list.backList.last) }),
            ScreenAction(id: "forward", title: "Forward", systemImage: "chevron.forward", disabled: list.forwardList.isEmpty,
                               run: { go(list.forwardList.first) }),
            page.isLoading
                ? ScreenAction(id: "reload", title: "Stop", systemImage: "xmark", run: { page.stopLoading() })
                : ScreenAction(id: "reload", title: "Reload", systemImage: "arrow.clockwise", run: { run(page.reload()) }),
            ScreenAction(id: "safari", title: "Open in Safari", systemImage: "safari", run: { openURL(shown) }),
            ScreenAction(id: "copy", title: "Copy Link", systemImage: "link", run: { UIPasteboard.general.url = shown }),
            ScreenAction(id: "share", title: "Share", systemImage: "square.and.arrow.up", share: shown),
        ]
    }

    private func go(_ item: WebPage.BackForwardList.Item?) {
        guard let item else { return }
        run(page.load(item))
    }

    private func run(_ navigation: some AsyncSequence<WebPage.NavigationEvent, any Error>) {
        Task { do { for try await _ in navigation {} } catch {} }
    }
}
