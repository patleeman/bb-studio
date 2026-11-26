import SwiftUI
import WebKit

/// A browser tab, as on the desktop: the page, with its address, back,
/// forward, reload and Safari on one line above it. Edge swipes go back and
/// forward; pinch zooms.
struct WorkbenchBrowserTab: View {
    let url: URL
    @State private var page = WebPage()

    var body: some View {
        VStack(spacing: 0) {
            BrowserTabHeader(page: page, url: url)
            WebKit.WebView(page)
                .webViewBackForwardNavigationGestures(.enabled)
                .webViewMagnificationGestures(.enabled)
                .accessibilityIdentifier("browserTabPage")
        }
        .task(id: url) {
            guard page.url != url else { return }
            // A failed load shows WebKit's own error page; nothing to add here.
            do { for try await _ in page.load(URLRequest(url: url)) {} } catch {}
        }
    }
}

private struct BrowserTabHeader: View {
    let page: WebPage
    let url: URL
    @Environment(\.openURL) private var openURL

    private var shown: URL { page.url ?? url }

    var body: some View {
        WorkbenchTabHeader {
            HStack(spacing: 6) {
                if page.isLoading { ProgressView().controlSize(.mini) } else { Image(systemName: "globe") }
                Text(shown.host() ?? shown.absoluteString)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(page.title.isEmpty ? (shown.host() ?? "Page") : page.title)
        } actions: {
            Button { go(page.backForwardList.backList.last) } label: { Label("Back", systemImage: "chevron.backward") }
                .disabled(page.backForwardList.backList.isEmpty)
            Button { go(page.backForwardList.forwardList.first) } label: { Label("Forward", systemImage: "chevron.forward") }
                .disabled(page.backForwardList.forwardList.isEmpty)
            Button { reload() } label: { Label("Reload", systemImage: "arrow.clockwise") }
            Menu {
                Button { openURL(shown) } label: { Label("Open in Safari", systemImage: "safari") }
                Button { UIPasteboard.general.url = shown } label: { Label("Copy Link", systemImage: "link") }
                ShareLink(item: shown)
            } label: {
                Label("More", systemImage: "ellipsis")
            }
            .accessibilityIdentifier("browserTabMore")
        }
    }

    private func go(_ item: WebPage.BackForwardList.Item?) {
        guard let item else { return }
        Task { do { for try await _ in page.load(item) {} } catch {} }
    }

    private func reload() {
        if page.isLoading { page.stopLoading(); return }
        Task { do { for try await _ in page.reload() {} } catch {} }
    }
}
