import Foundation

extension BBClient {
    public func webURL(forDrawing id: String) -> URL {
        // Drawings are built into Studio.
        URL(string: "/plugins/studio/studio/drawings/\(id)", relativeTo: baseURL)!.absoluteURL
    }
}
