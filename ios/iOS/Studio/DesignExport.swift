import UIKit
import WebKit

/// The desktop player's Export PDF and Download HTML, as files for the share
/// sheet. The PDF is Studio's print page (`/designs/print`: one page per
/// step), laid out at the screen's size and paged by WebKit's print formatter.
@MainActor
enum DesignExport {
    static func file(_ client: BBClient, designId: String, screen: DesignScreen, print: Bool) async throws -> URL {
        let name = fileName(designId: designId, screenId: screen.id)
        let folder = FileManager.default.temporaryDirectory.appending(path: "design-export-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = client.designScreenFileURL(designId, screen, print: print)
        if print {
            let file = folder.appending(path: "\(name).pdf")
            try await printed(url, size: CGSize(width: screen.size.width, height: screen.size.height)).write(to: file)
            return file
        }
        let (status, data) = try await client.raw(method: "GET", path: url.path() + "?" + (url.query() ?? ""), body: nil)
        guard (200..<300).contains(status) else { throw BBError(status: status, message: "Studio didn't send the screen (HTTP \(status)).") }
        let file = folder.appending(path: "\(name).html")
        try data.write(to: file)
        return file
    }

    /// A file name from ids an agent chose: only letters, digits, `-` and `_`, never a path.
    static func fileName(designId: String, screenId: String?) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let safe = { (part: String) in
            String(part.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" }).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        }
        let name = [safe(designId), safe(screenId ?? "screen")].filter { !$0.isEmpty }.joined(separator: "-")
        return name.isEmpty ? "design" : String(name.prefix(120))
    }

    /// Studio's print page laid out at the screen's size and paged by WebKit's print formatter.
    /// The load ends exactly once (`UntrustedPageLoad`): a failure, a crashed page or a cancelled
    /// export throws instead of waiting for good.
    static func printed(_ url: URL, size: CGSize) async throws -> Data {
        let view = WKWebView(frame: CGRect(origin: .zero, size: size), configuration: UntrustedWeb.configuration())
        guard await UntrustedPageLoad.run(view, url: url) else {
            try Task.checkCancellation()
            throw BBError(status: 0, message: "The screen didn't load for printing.")
        }
        // Fonts and first frames before printing.
        try await Task.sleep(for: .milliseconds(400))
        let renderer = UIPrintPageRenderer()
        renderer.addPrintFormatter(view.viewPrintFormatter(), startingAtPageAt: 0)
        let page = CGRect(origin: .zero, size: size)
        renderer.setValue(page, forKey: "paperRect")
        renderer.setValue(page, forKey: "printableRect")
        let data = NSMutableData()
        UIGraphicsBeginPDFContextToData(data, page, nil)
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
        for index in 0..<renderer.numberOfPages {
            UIGraphicsBeginPDFPage()
            renderer.drawPage(at: index, in: UIGraphicsGetPDFContextBounds())
        }
        UIGraphicsEndPDFContext()
        return data as Data
    }
}
