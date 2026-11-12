import SwiftUI
import PDFKit

/// Parse the document before displaying it. A PDF MIME type or header alone
/// does not establish that the file contains any readable pages.
struct ArtifactPDFPreview: View {
    let url: URL
    let onFailure: (String) -> Void
    @State private var document: PDFDocument?

    var body: some View {
        Group {
            if let document {
                DocumentView(document: document)
            } else {
                ProgressView()
            }
        }
        .task(id: url) {
            document = nil
            do {
                let (data, response) = try await URLSession.shared.data(for:
                    URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
                guard !Task.isCancelled else { return }
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    onFailure("BB couldn't load this file (HTTP \(status)). Try again, or share the file.")
                    return
                }
                guard let parsed = PDFDocument(data: data) else {
                    onFailure("This PDF has no readable pages. Try again, or share the file to open it in another app.")
                    return
                }
                guard !parsed.isLocked else {
                    onFailure("This PDF needs a password. Share the file to open it in an app that can unlock it.")
                    return
                }
                guard parsed.pageCount > 0 else {
                    onFailure("This PDF has no readable pages. Try again, or share the file to open it in another app.")
                    return
                }
                document = parsed
            } catch where BBClient.isCancellation(error) {
            } catch {
                guard !Task.isCancelled else { return }
                onFailure(BBClient.describe(error, server: url))
            }
        }
    }

    private struct DocumentView: UIViewRepresentable {
        let document: PDFDocument

        func makeUIView(context: Context) -> PDFView {
            let view = PDFView()
            view.accessibilityIdentifier = "artifactPDFDocument"
            view.autoScales = true
            view.document = document
            return view
        }

        func updateUIView(_ view: PDFView, context: Context) {
            if view.document !== document { view.document = document }
        }
    }
}
