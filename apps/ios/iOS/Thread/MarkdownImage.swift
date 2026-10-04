import SwiftUI

/// `![alt](src)` in a reply. Like BB web, a path is a file on the thread's host:
/// absolute paths as they are, relative ones from the workspace root, both read
/// through `host-files/content`. Web URLs load directly. Tap to see it full screen.
struct MarkdownImage: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.threadId) private var threadId
    let alt: String
    let src: String
    @State private var url: URL?
    @State private var resolved = false
    @State private var viewing = false

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFit()
                            .clipShape(.rect(cornerRadius: 10))
                            .frame(maxHeight: 420, alignment: .leading)
                            .onTapGesture { viewing = true }
                            .accessibilityLabel(alt.isEmpty ? "Image" : alt)
                            .accessibilityAddTraits(.isButton)
                            .accessibilityIdentifier("markdownImage")
                    case .failure:
                        placeholder("photo.badge.exclamationmark")
                    default:
                        ProgressView().frame(maxWidth: .infinity, minHeight: 120)
                    }
                }
                .fullScreenCover(isPresented: $viewing) { ImageViewer(url: url) }
            } else if resolved {
                placeholder("photo")
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task(id: src) {
            url = await resolve()
            resolved = true
        }
    }

    private func placeholder(_ symbol: String) -> some View {
        Label(alt.isEmpty ? src : alt, systemImage: symbol)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(2)
            .accessibilityIdentifier("markdownImageAlt")
    }

    private func resolve() async -> URL? {
        let source = src.removingPercentEncoding ?? src
        if let url = URL(string: src), ["http", "https"].contains(url.scheme?.lowercased()) { return url }
        guard let threadId else { return nil }
        if source.hasPrefix("file://") {
            return URL(string: src).flatMap { app.client.hostFileURL(threadId: threadId, path: $0.path) }
        }
        if source.hasPrefix("/") { return app.client.hostFileURL(threadId: threadId, path: source) }
        guard !source.hasPrefix("~"), !source.contains(":"),
            let environmentId = try? await app.client.thread(threadId).environmentId,
            let root = try? await app.client.environmentRoot(environmentId)
        else { return nil }
        let base = URL(fileURLWithPath: root, isDirectory: true)
        let path = URL(fileURLWithPath: source, relativeTo: base).standardizedFileURL.path
        guard path.hasPrefix(base.standardizedFileURL.path + "/") else { return nil }
        return app.client.hostFileURL(threadId: threadId, path: path)
    }
}

extension BBClient {
    /// Any file on the thread's host, as BB web loads a reply's images.
    func hostFileURL(threadId: String, path: String) -> URL? {
        let name = path.split(separator: "/").last ?? ""
        guard path.hasPrefix("/"), name.contains("."),
            var components = URLComponents(
                url: baseURL.appending(path: "api/v1/threads/\(threadId)/host-files/content"), resolvingAgainstBaseURL: true)
        else { return nil }
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        return components.url
    }
}
