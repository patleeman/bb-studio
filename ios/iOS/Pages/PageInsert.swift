import PhotosUI
import SwiftUI

/// What the desktop's slash menu adds, as Markdown at the cursor: a callout,
/// a toggle, a table, code, a divider, a photo uploaded to the page, and
/// mentions (`@`): pages, dates and conversations.
enum PageInsert {
    static let callout = "> [!NOTE]\n> "
    static let toggle = "<details>\n<summary>Toggle</summary>\n\n\n\n</details>"
    static let table = "| Column | Column |\n|---|---|\n|  |  |"
    static let code = "```\n\n```"
    static let divider = "---"

    /// `@[Label](kind:target)`, with `]` in the label escaped as Studio writes it.
    static func mention(_ kind: String, _ target: String, label: String) -> String {
        "@[\(label.replacingOccurrences(of: "]", with: "\\]"))](\(kind):\(target)) "
    }

    /// The desktop's date choices: Today, Tomorrow, Next Monday, Next Friday.
    static func dates(from today: Date = .now, calendar: Calendar = .current) -> [(label: String, value: String)] {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = calendar.timeZone
        let start = calendar.startOfDay(for: today)
        func next(_ weekday: Int) -> Date {
            calendar.nextDate(after: start, matching: DateComponents(weekday: weekday), matchingPolicy: .nextTime) ?? start
        }
        let days: [(String, Date)] = [("Today", start), ("Tomorrow", calendar.date(byAdding: .day, value: 1, to: start) ?? start),
                                      ("Next Monday", next(2)), ("Next Friday", next(6))]
        return days.map { ($0.0, formatter.string(from: $0.1)) }
    }
}

/// The editor's Insert menu.
struct PageInsertMenu: View {
    let controller: PageTextController
    @Binding var mentioning: Bool
    @Binding var photo: PhotosPickerItem?
    @State private var picking = false

    var body: some View {
        Menu {
            Button { controller.insertBlock(PageInsert.callout) } label: { Label("Callout", systemImage: "info.circle") }
            Button { controller.insertBlock(PageInsert.toggle) } label: { Label("Toggle", systemImage: "chevron.right.circle") }
            Button { controller.insertBlock(PageInsert.table) } label: { Label("Table", systemImage: "tablecells") }
            Button { controller.insertBlock(PageInsert.code) } label: { Label("Code", systemImage: "chevron.left.forwardslash.chevron.right") }
            Button { controller.insertBlock(PageInsert.divider) } label: { Label("Divider", systemImage: "minus") }
            Divider()
            Button { picking = true } label: { Label("Photo", systemImage: "photo") }
            Button { mentioning = true } label: { Label("Mention", systemImage: "at") }
        } label: {
            Image(systemName: "plus.circle")
        }
        .accessibilityLabel("Insert")
        .accessibilityIdentifier("pageInsert")
        .photosPicker(isPresented: $picking, selection: $photo, matching: .images)
    }
}

/// `@`: a page, a date or a conversation to mention, searched by title.
struct PageMentionPicker: View {
    let insert: (String) -> Void
    @EnvironmentObject private var app: AppModel
    @ObservedObject private var pages = PagesStore.shared
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var threads: [ThreadEntry] = []

    private var matchingPages: [PageMeta] {
        let all = pages.pages.sorted { ($0.updatedAt ?? 0) > ($1.updatedAt ?? 0) }
        return Array((query.isEmpty ? all : all.filter { $0.displayTitle.localizedCaseInsensitiveContains(query) }).prefix(20))
    }

    /// Conversations once the query has two characters, as on the desktop.
    private var matchingThreads: [ThreadEntry] {
        guard query.count >= 2 else { return [] }
        return Array(threads.filter { $0.displayTitle.localizedCaseInsensitiveContains(query) }.prefix(20))
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Pages") {
                    ForEach(matchingPages) { page in
                        row(PageRow(page: page)) { PageInsert.mention("page", page.id, label: page.displayTitle) }
                    }
                }
                Section("Dates") {
                    ForEach(PageInsert.dates(), id: \.value) { date in
                        row(Label(date.label, systemImage: "calendar")) { PageInsert.mention("date", date.value, label: date.value) }
                    }
                }
                if !matchingThreads.isEmpty {
                    Section("Conversations") {
                        ForEach(matchingThreads) { thread in
                            row(Label(thread.displayTitle, systemImage: Symbols.thread)) { PageInsert.mention("thread", thread.id, label: thread.displayTitle) }
                        }
                    }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Pages, dates, conversations")
            .navigationTitle("Mention")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task {
                pages.restore()
                if pages.pages.isEmpty { await pages.load(app.client) }
                threads = (try? await app.client.threads(limit: 200)) ?? []
            }
        }
    }

    private func row(_ label: some View, mention: @escaping () -> String) -> some View {
        Button {
            insert(mention())
            dismiss()
        } label: { label }
        .foregroundStyle(.primary)
    }
}
