#if DEBUG
import Foundation

/// Debug builds: `-qaStudioDemo` fills the Studio tab from local fixtures, for
/// UI tests that run offline: a folder page with a page in it, a second page
/// and a mini app, with their kinds. Requests it doesn't answer fail as if the
/// server were unreachable, as they do offline without it. `-qaStudioStars`
/// adds three starred pages, and Star and Unstar change them for the launch.
enum StudioDemo {
    static var enabled: Bool { ProcessInfo.processInfo.arguments.contains("-qaStudioDemo") }
    static var withStars: Bool { ProcessInfo.processInfo.arguments.contains("-qaStudioStars") }

    /// Item id → when it was starred, newest first in the fixtures.
    nonisolated(unsafe) private static var stars: [String: Double] = {
        let now = Date().timeIntervalSince1970 * 1000
        return ["pg_star_library": now - 60_000, "pg_star_outline": now - 3_600_000, "pg_star_vocab": now - 86_400_000]
    }()

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
            case Studio.Method.starred where withStars: return ok(starred)
            case Studio.Method.starItems where withStars:
                star(body)
                return ok(#"{"ok":true}"#)
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
        "pg_star_library": "# System design library\n\nPatterns worth reaching for, with the trade-offs of each.\n\n- Queues smooth out bursts\n- Caches trade freshness for speed\n- Shards split the load, and the joins",
        "pg_star_outline": "# Round outline\n\nForty-five minutes: ten on the problem, twenty-five on the design, ten on questions.",
        "pg_star_vocab": "# Vocabulary\n\n- **Idempotent**: safe to do twice\n- **Back-pressure**: slowing the sender down",
    ]

    private struct Fixture {
        var plugin = "pages"
        var id: String
        var kind = "page"
        var title: String
        var parent: String?
        var icon: String?
        /// Hours since it changed.
        var age: Double
    }

    private static var fixtures: [Fixture] {
        let duo = [
            Fixture(id: "pg_duo_launch", title: "Launch plan", age: 3),
            Fixture(id: "pg_duo_review", title: "Review checklist", parent: "pg_duo_launch", age: 2),
            Fixture(id: "pg_duo_regular", title: "Duo release review", age: 5),
            Fixture(plugin: "minis", id: "mini_duo_board", kind: "mini", title: "Release board", age: 26),
        ]
        guard withStars else { return duo }
        return duo + [
            Fixture(id: "pg_star_library", title: "System design library", icon: "📚", age: 30),
            Fixture(id: "pg_star_outline", title: "Round outline", age: 60),
            Fixture(id: "pg_star_vocab", title: "Vocabulary", icon: "🔤", age: 90),
        ]
    }

    private static func star(_ body: Data?) {
        struct Input: Decodable {
            struct Ref: Decodable { var id: String }
            var items: [Ref]
            var starred: Bool
        }
        guard let body, let input = try? JSONDecoder().decode(Input.self, from: body) else { return }
        let now = Date().timeIntervalSince1970 * 1000
        for ref in input.items {
            stars[ref.id] = input.starred ? stars[ref.id] ?? now : nil
        }
    }

    private static func json(_ value: String?) -> String { value.map { #""\#($0)""# } ?? "null" }

    private static var starred: String {
        let entries = fixtures.compactMap { item in stars[item.id].map { (item, $0) } }
            .sorted { $0.1 > $1.1 }
            .map { item, at in
                #"{"pluginId":"\#(item.plugin)","id":"\#(item.id)","title":"\#(item.title)","icon":\#(json(item.icon)),"kind":"\#(item.kind)","kindIcon":"file-text","href":null,"projectId":null,"starredAt":\#(at)}"#
            }
        return #"{"items":[\#(entries.joined(separator: ","))]}"#
    }

    private static var overview: String {
        let now = Date().timeIntervalSince1970 * 1000
        let hour = 3_600_000.0
        let items = fixtures.map { item in
            let updated = now - item.age * hour
            let starredAt = withStars ? stars[item.id].map { "\($0)" } ?? "null" : "null"
            return #"{"pluginId":"\#(item.plugin)","id":"\#(item.id)","kind":"\#(item.kind)","title":"\#(item.title)","icon":\#(json(item.icon)),"parentId":\#(json(item.parent)),"createdAt":\#(updated - hour),"updatedAt":\#(updated),"starredAt":\#(starredAt)}"#
        }
        return #"""
        {"items":[\#(items.joined(separator: ","))],
         "providers":[{"pluginId":"pages","kinds":[{"id":"page","label":"Page"}]},
                      {"pluginId":"minis","kinds":[{"id":"mini","label":"Mini app"}]}],
         "tags":[]}
        """#
    }
}
#endif
