import SwiftUI

extension EnvironmentValues {
    /// A page's image sources in reading order: a tapped image opens among them.
    @Entry var pageImages: [String] = []
}

/// The page's images full screen, as the desktop's lightbox: swipe to the
/// next or previous image, pinch or double-tap to zoom, drag to pan, the
/// position ("2 of 5") in the title.
struct PageImageGallery: View {
    let urls: [URL]
    @State var index: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TabView(selection: $index) {
                ForEach(Array(urls.enumerated()), id: \.offset) { offset, url in
                    GalleryImage(url: url).tag(offset)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: urls.count > 1 ? .automatic : .never))
            .background(.black)
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle(urls.count > 1 ? "\(index + 1) of \(urls.count)" : "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Done") { dismiss() } }
                if urls.indices.contains(index) {
                    ToolbarItem(placement: .topBarTrailing) { ShareLink(item: urls[index]) }
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
            .accessibilityIdentifier("pageImageGallery")
        }
    }

    /// The gallery's addresses: each source the app can load, in order, and where `tapped` is among them.
    @MainActor static func urls(_ sources: [String], tapped: String, client: BBClient, pageId: String?) -> (urls: [URL], start: Int)? {
        var urls: [URL] = []
        var start: Int?
        for source in sources {
            guard let url = client.serverImageURL(src: source, pageId: pageId) else { continue }
            if source == tapped, start == nil { start = urls.count }
            urls.append(url)
        }
        guard let start else { return nil }
        return (urls, start)
    }
}

private struct GalleryImage: View {
    let url: URL

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                Zoomable(maximum: 8) {
                    image.resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            case .failure:
                Label("Couldn't load the image", systemImage: "photo.badge.exclamationmark").foregroundStyle(.secondary)
            default:
                ProgressView().tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
