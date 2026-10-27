#if DEBUG
import Foundation

/// Debug builds: `-qaStudioDemo` fills the Studio tab from local fixtures, for
/// UI tests that run offline: a folder page with a page in it, a second page
/// and a mini app, with their kinds. Requests it doesn't answer fail as if the
/// server were unreachable, as they do offline without it.
enum StudioDemo {
    static var enabled: Bool { ProcessInfo.processInfo.arguments.contains("-qaStudioDemo") }

    /// Answers the app's requests from fixtures, once per launch, before
    /// anything loads.
    @MainActor static func install() {
        guard enabled, BBClient.demoTransport == nil else { return }
        BBClient.demoTransport = { method, path, body in
            if method == "GET", path == "/api/v1/plugins" { return (200, Data(plugins.utf8)) }
            if method == "GET", path == "/api/v1/projects" { return (200, Data("[]".utf8)) }
            let rpc = "/api/v1/plugins/studio/rpc/"
            guard method == "POST", path.hasPrefix(rpc) else { throw URLError(.cannotFindHost) }
            switch String(path.dropFirst(rpc.count)) {
            case Studio.Method.overview: return ok(overview)
            case Studio.Method.pages_markdown:
                let id = body.flatMap { try? JSONDecoder().decode([String: String].self, from: $0) }?["id"] ?? ""
                guard let markdown = pages[id] else { throw URLError(.cannotFindHost) }
                let encoded = (try? JSONEncoder().encode(["markdown": markdown])).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
                return ok(encoded)
            default: throw URLError(.cannotFindHost)
            }
        }
    }

    private static func ok(_ result: String) -> (Int, Data) {
        (200, Data(#"{"ok":true,"result":\#(result)}"#.utf8))
    }

    private static let plugins = #"{"plugins":[{"id":"studio","status":"running"},{"id":"pages","status":"running"}]}"#

    static let pages = [
        "pg_duo_launch": "# Launch plan\n\nThe Duo launch, page by page.",
        "pg_duo_review": "# Review checklist\n\nSearch and list cards share one row layout, so a result reads like the item it opens.\n\n- Rows keep a 20-point inset on both sides\n- The folder list leads the sidebar",
        "pg_duo_regular": "# Duo release review\n\nThe regular layout keeps the list on the left page and the item on the right.",
    ]

    private static var overview: String {
        let now = Date().timeIntervalSince1970 * 1000
        let hour = 3_600_000.0
        func item(_ plugin: String, _ id: String, _ kind: String, _ title: String, parent: String? = nil, age: Double) -> String {
            let parentId = parent.map { #""\#($0)""# } ?? "null"
            return #"{"pluginId":"\#(plugin)","id":"\#(id)","kind":"\#(kind)","title":"\#(title)","parentId":\#(parentId),"createdAt":\#(now - age - hour),"updatedAt":\#(now - age)}"#
        }
        let items = [
            item("pages", "pg_duo_launch", "page", "Launch plan", age: 3 * hour),
            item("pages", "pg_duo_review", "page", "Review checklist", parent: "pg_duo_launch", age: 2 * hour),
            item("pages", "pg_duo_regular", "page", "Duo release review", age: 5 * hour),
            item("minis", "mini_duo_board", "mini", "Release board", age: 26 * hour),
        ]
        return #"""
        {"items":[\#(items.joined(separator: ","))],
         "providers":[{"pluginId":"pages","kinds":[{"id":"page","label":"Page"}]},
                      {"pluginId":"minis","kinds":[{"id":"mini","label":"Mini app"}]}],
         "tags":[]}
        """#
    }
}
#endif
