import UIKit

/// `-qaPageDemo` with `bbstudio://page/qa-demo`: one page offline with every
/// block kind, two comment threads and two images, for the UI tests.
enum PageDemo {
    static let id = "qa-demo"

    static func on(_ pageId: String) -> Bool {
        pageId == id && ProcessInfo.processInfo.arguments.contains("-qaPageDemo")
    }

    static let meta = PageMeta(id: id, projectId: nil, parentId: nil, title: "Launch plan", icon: "🚀",
                               position: 0, createdAt: 0, updatedAt: nil, updatedBy: nil, archived: false)

    static let markdown = #"""
    <!-- ^aaaa0001 -->
    Owner: @[Home](thread:thr_demo) · due @[2026-10-01](date:2026-10-01)

    <!-- ^aaaa0002 -->
    > [!WARNING]
    > Callouts take their tone's colour.

    <!-- ^aaaa0003 -->
    ```stats
    [{"label":"ARR","value":"$1.2M","delta":"+8%","trend":"up"},{"label":"Churn","value":"2.1%","delta":"-0.4%","trend":"down"},{"label":"Seats","value":"340"}]
    ```

    <!-- ^aaaa0004 -->
    ## Tasks

    <!-- ^aaaa0005 -->
    - [x] Write the brief
    <!-- ^aaaa0006 -->
    - [ ] Record the demo
    <!-- ^aaaa0007 -->
    - [ ] Ship **v1**

    <!-- ^aaaa0008 -->
    | Stage | Owner | Status |
    |---|---|---|
    | Design | Ana | Done |
    | Build | Sam | In progress |

    <!-- ^aaaa0009 -->
    <details>
    <summary>## Risks</summary>

    <!-- ^aaaa0010 -->
    The launch slips if the demo isn't recorded by Friday.

    </details>

    <!-- ^aaaa0011 -->
    ```chart
    {"type":"bar","title":"Signups","x":"label","series":["Signups"],"data":[{"label":"Mon","Signups":12},{"label":"Tue","Signups":19},{"label":"Wed","Signups":8},{"label":"Thu","Signups":24}]}
    ```

    <!-- ^aaaa0012 -->
    ![First still](qa-image-1)

    <!-- ^aaaa0013 -->
    ![Second still](qa-image-2)

    <!-- ^aaaa0014 -->
    ```html
    <div style="font:15px -apple-system;padding:12px;background:#eef;border-radius:8px">An HTML block</div>
    <script>setTimeout(function () { location.href = "https://elsewhere.invalid/away"; }, 500);</script>
    ```

    <!-- ^aaaa0015 -->
    ```embed
    {"kind":"bookmark","target":"https://example.com","title":"Example link"}
    ```

    <!-- ^aaaa0016 -->
    ```swift
    print("hello")
    ```
    """#

    /// The demo page's comments, kept in memory: posting, replying and resolving work offline.
    @MainActor
    final class Comments: PageCommentBackend {
        static let shared = Comments()

        private var threads: [PageCommentThread] = [
            PageCommentThread(id: "th-1", resolved: false, blockId: "aaaa0001-0000-0000-0000-000000000000", quote: "Owner",
                              comments: [.init(id: "c-1", author: "agent:thr_demo", authorName: "Agent", text: "Who owns the launch?", createdAt: 0)],
                              updatedAt: 0),
            PageCommentThread(id: "th-2", resolved: false, blockId: "aaaa0004", quote: "Tasks",
                              comments: [.init(id: "c-2", author: "user", authorName: "You", text: "Add the press kit.", createdAt: 0)],
                              updatedAt: 0),
        ]

        func threads(_ pageId: String) async throws -> [PageCommentThread] { threads }

        func blocks(_ pageId: String) async throws -> [PageTextBlock] {
            [PageTextBlock(id: "aaaa0001", text: "Owner: Home · due 2026-10-01"), PageTextBlock(id: "aaaa0004", text: "Tasks"),
             PageTextBlock(id: "aaaa0005", text: "Write the brief")]
        }

        func create(_ pageId: String, block: String, quote: String?, text: String) async throws {
            let source = try await blocks(pageId).first { $0.id == block }?.text ?? ""
            threads.append(PageCommentThread(id: "th-\(threads.count + 1)", resolved: false, blockId: block, quote: quote ?? source,
                                             comments: [.init(id: UUID().uuidString, author: "user", authorName: "You", text: text, createdAt: 0)],
                                             updatedAt: 0))
        }

        func reply(_ pageId: String, thread: String, text: String) async throws {
            guard let index = threads.firstIndex(where: { $0.id == thread }) else { return }
            threads[index].comments.append(.init(id: UUID().uuidString, author: "user", authorName: "You", text: text, createdAt: 0))
        }

        func resolve(_ pageId: String, thread: String, resolved: Bool) async throws {
            guard let index = threads.firstIndex(where: { $0.id == thread }) else { return }
            threads[index].resolved = resolved
        }
    }

    #if DEBUG
    /// The demo's images (`qa-image-1`, `qa-image-2`), drawn once into a temporary file each.
    static func imageURL(_ src: String) -> URL? {
        guard ProcessInfo.processInfo.arguments.contains("-qaPageDemo"), src.hasPrefix("qa-image-") else { return nil }
        let url = FileManager.default.temporaryDirectory.appending(path: "\(src).png")
        if !FileManager.default.fileExists(atPath: url.path) {
            let colour: UIColor = src.hasSuffix("1") ? .systemTeal : .systemOrange
            let image = UIGraphicsImageRenderer(size: CGSize(width: 1200, height: 800)).image { context in
                colour.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 1200, height: 800))
                (src as NSString).draw(at: CGPoint(x: 60, y: 60), withAttributes: [.font: UIFont.boldSystemFont(ofSize: 96), .foregroundColor: UIColor.white])
            }
            try? image.pngData()?.write(to: url)
        }
        return url
    }
    #endif
}
