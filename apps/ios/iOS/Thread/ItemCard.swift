import SwiftUI

/// The Studio item a reply card opens: `::page{id="pg_…"}`, `::drawing{…}`,
/// `::table{…}` or `::design{…}` on its own line. Artifacts have `ArtifactCard`.
enum ReplyItem: Hashable {
    case page(String)
    case drawing(String)
    case table(String)
    case design(String)

    init?(_ directive: Directive) {
        guard let id = directive.attributes["id"]?.trimmingCharacters(in: .whitespaces), !id.isEmpty,
              id.wholeMatch(of: /[A-Za-z0-9_-]{1,80}/) != nil else { return nil }
        switch directive.name {
        case "page": self = .page(id)
        case "drawing": self = .drawing(id)
        case "table": self = .table(id)
        case "design" where BBClient.isDesignId(id): self = .design(id)
        default: return nil
        }
    }

    var id: String {
        switch self {
        case .page(let id), .drawing(let id), .table(let id), .design(let id): id
        }
    }

    var route: Route {
        switch self {
        case .page(let id): .page(id: id)
        case .drawing(let id): .drawing(id: id)
        case .table(let id): .table(id: id)
        case .design(let id): .design(id: id)
        }
    }

    var kind: StudioKind {
        switch self {
        case .page: StudioKind.of("page")
        case .drawing: StudioKind.of("drawing")
        case .table: StudioKind.of("table")
        case .design: StudioKind.of("design")
        }
    }
}

/// A reply card for a page, drawing, table or design: its icon, name and
/// size, opening the item. The web opens it beside the chat; the phone pushes it.
struct ReplyItemCard: View {
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    let item: ReplyItem
    @State private var summary: Summary?
    @State private var missing = false

    struct Summary: Hashable {
        var title: String
        var detail: String?
        var emoji: String?
    }

    /// Replies re-render often; each card looks its item up once.
    @MainActor private static var cache: [String: Summary] = [:]

    var body: some View {
        NavigationLink(value: item.route) {
            HStack(spacing: 12) {
                Group {
                    if let emoji = summary?.emoji, !emoji.isEmpty {
                        Text(emoji).font(.title3)
                    } else {
                        Image(systemName: item.kind.symbol).font(.body.weight(.medium)).foregroundStyle(item.kind.tint)
                    }
                }
                .frame(width: 44, height: 44)
                .background(item.kind.tint.opacity(0.12), in: .rect(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(summary?.title ?? (missing ? "Deleted \(item.kind.label.lowercased())" : item.kind.label))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(missing ? .secondary : .primary)
                        .lineLimit(2)
                    Text([item.kind.label, summary?.detail].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(10)
            .frame(maxWidth: 420, alignment: .leading)
            .background(.fill.quaternary, in: .rect(cornerRadius: 14))
            .contentShape(.rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .disabled(missing)
        .accessibilityIdentifier("replyItemCard")
        .task(id: item) {
            let key = ServerScope.key("\(item.kind.id):\(item.id)", serverURL: client.baseURL)
            if let cached = Self.cache[key] { summary = cached }
            do {
                if let found = try await load() {
                    Self.cache[key] = found
                    summary = found
                } else {
                    missing = true
                }
            } catch {
                // Offline or the add-on is off: the card still opens the item.
            }
        }
    }

    private func load() async throws -> Summary? {
        switch item {
        case .page(let id):
            return try await client.page(id).map { Summary(title: $0.displayTitle, emoji: $0.icon) }
        case .drawing(let id):
            return try await client.drawing(id).map { drawing in
                let count = drawing.scene.elements.filter { !$0.isDeleted }.count
                return Summary(title: drawing.name.isEmpty ? "Untitled drawing" : drawing.name, detail: count == 1 ? "1 element" : "\(count) elements")
            }
        case .table(let id):
            return try await client.studioTable(id).map { table in
                let rows = table.rows?.count ?? 0, columns = table.columns?.count ?? 0
                let title = (table.title ?? "").trimmingCharacters(in: .whitespaces)
                return Summary(title: title.isEmpty ? "Untitled table" : title,
                    detail: "\(rows) row\(rows == 1 ? "" : "s") · \(columns) column\(columns == 1 ? "" : "s")")
            }
        case .design(let id):
            return try await client.design(id).map { design in
                let count = design.screens.count
                return Summary(title: design.displayName, detail: count == 1 ? "1 screen" : "\(count) screens")
            }
        }
    }
}
