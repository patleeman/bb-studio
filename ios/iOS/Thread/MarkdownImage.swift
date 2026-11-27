import SwiftUI

/// `![alt](src)` in a reply. Like BB web, a path is a file on the thread's host:
/// absolute paths as they are, relative ones from the workspace root, both read
/// through `host-files/content`. Web URLs load directly. Tap to see it full screen.
struct MarkdownImage: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.threadId) private var threadId
    @Environment(\.pageId) private var pageId
    @Environment(\.pageImages) private var pageImages
    let alt: String
    let src: String
    @State private var url: URL?
    @State private var image: UIImage?
    @State private var loadedSrc: String?
    @State private var failed = false
    @State private var resolved = false
    @State private var viewing = false

    /// Max decoded edge in pixels (420 pt @ 3x = 1260 px) so large screenshots
    /// don't decode at full camera/desktop resolution inside a scrolling transcript.
    private static let maxPixels = 1_260

    var body: some View {
        Group {
            if let image, let url {
                Image(uiImage: image).resizable().scaledToFit()
                    .clipShape(.rect(cornerRadius: 10))
                    .frame(maxHeight: 420, alignment: .leading)
                    .onTapGesture { viewing = true }
                    .accessibilityLabel(alt.isEmpty ? "Image" : alt)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier("markdownImage")
                    .fullScreenCover(isPresented: $viewing) { viewer(url) }
            } else if failed {
                placeholder("photo.badge.exclamationmark")
            } else if resolved && url == nil {
                placeholder("photo")
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task(id: src) {
            if loadedSrc != src {
                image = nil
                url = nil
                resolved = false
            }
            failed = false
            let resolvedURL = await resolve()
            url = resolvedURL
            resolved = true
            guard let resolvedURL else {
                image = nil
                loadedSrc = src
                return
            }
            if let hit = AttachmentImages.shared.cached(resolvedURL, pixels: Self.maxPixels) {
                image = hit
                loadedSrc = src
                return
            }
            if let loaded = await AttachmentImages.shared.image(resolvedURL, pixels: Self.maxPixels) {
                image = loaded
                loadedSrc = src
            } else if !Task.isCancelled {
                image = nil
                loadedSrc = nil
                failed = true
            }
        }
    }

    /// In a page, the lightbox steps through all of the page's images; elsewhere this one image.
    @ViewBuilder private func viewer(_ url: URL) -> some View {
        if let gallery = PageImageGallery.urls(pageImages, tapped: src, client: app.client, pageId: pageId), gallery.urls.count > 1 {
            PageImageGallery(urls: gallery.urls, index: gallery.start)
        } else {
            ImageViewer(url: url)
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
        if let url = app.client.serverImageURL(src: src, pageId: pageId) { return url }
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
    /// An image src the server answers without a thread: a web URL; one of
    /// its own `/api/…` addresses, such as a page's imported image; or, in a
    /// page, a local path an older page names, which Studio resolves through
    /// the page's threads or shows as "Image not available". Nil otherwise.
    func serverImageURL(src: String, pageId: String?) -> URL? {
        let trimmed = src.trimmingCharacters(in: .whitespaces)
        #if DEBUG
        if let demo = PageDemo.imageURL(trimmed) { return demo }
        #endif
        if let url = URL(string: trimmed), ["http", "https"].contains(url.scheme?.lowercased()) { return url }
        if trimmed.hasPrefix("/api/") { return URL(string: trimmed, relativeTo: baseURL)?.absoluteURL }
        guard let pageId, trimmed.lowercased().hasPrefix("file://") || (trimmed.hasPrefix("/") && !trimmed.hasPrefix("//")) else { return nil }
        return URL(string: Self.pageLocalImagePath(pageId: pageId, path: trimmed), relativeTo: baseURL)?.absoluteURL
    }

    /// Studio's route for a local image path in a page (plugins/…/pages/local-images.ts).
    static func pageLocalImagePath(pageId: String, path: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        let encode = { (value: String) in value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value }
        return "/api/v1/plugins/studio/http/pages/local-image?page=\(encode(pageId))&path=\(encode(path))"
    }

    /// Any file on the thread's host, as BB web loads a reply's images.
    func hostFileURL(threadId: String, path: String) -> URL? {
        let name = path.split(separator: "/").last ?? ""
        guard path.hasPrefix("/"), name.contains(".") else { return nil }
        return URL(string: Self.hostFilePath(threadId: threadId, path: path), relativeTo: baseURL)?.absoluteURL
    }
}
