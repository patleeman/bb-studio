import SwiftUI

/// Home of the current Space: start work or hand it off, then what needs you,
/// what the team is doing, and what came back.
struct HomeTab: View {
    @EnvironmentObject private var app: AppModel
    @Environment(OfficeContext.self) private var office

    var body: some View {
        NavigationStack(path: $app.homePath) {
            Group {
                if let home = office.home {
                    HomeList(store: home)
                } else {
                    ProgressView()
                }
            }
            .toolbar { ToolbarItem(placement: .principal) { SpaceSwitcher() } }
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
        }
    }
}

private struct HomeList: View {
    @EnvironmentObject private var app: AppModel
    @Environment(OfficeContext.self) private var office
    let store: HomeStore
    @State private var delegating = false

    var body: some View {
        List {
            Section {
                Button { app.newThread() } label: {
                    Label("New Thread", systemImage: "square.and.pencil")
                }
                Button { delegating = true } label: {
                    Label("Hand Off to a Bot", systemImage: "paperplane")
                }
                .disabled(office.team?.bots.isEmpty ?? true)
            }

            if let error = store.error, store.home == nil {
                Section { ConnectionBanner(message: error) { await store.refresh() } }
            }

            Section("Needs You") {
                if store.needsYou.isEmpty {
                    if store.home != nil, store.error == nil {
                        Text("Nothing is waiting on you.").foregroundStyle(.secondary)
                    }
                } else {
                    ForEach(store.needsYou) { event in
                        OfficeEventRow(event: event, bot: office.bot(event.botId)) { await store.refresh() }
                    }
                }
            }

            if !store.working.isEmpty {
                Section("Your Team Is Working On") {
                    ForEach(store.working) { task in OfficeTaskRow(task: task, bot: office.bot(task.botId)) }
                }
            }

            if !store.reports.isEmpty {
                Section("Reports") {
                    ForEach(store.reports.prefix(5)) { event in
                        OfficeEventRow(event: event, bot: office.bot(event.botId)) { await store.refresh() }
                    }
                }
            }

            if !store.recent.isEmpty {
                Section("Recent Work") {
                    ForEach(store.recent.prefix(8)) { item in OfficeItemRow(item: item, author: office.bot(item.authorBotId)) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await office.refreshCurrent() }
        .task(id: store.spaceId) { await store.load() }
        .sheet(isPresented: $delegating) { DelegateSheet(bots: office.team?.bots ?? []) }
    }
}

/// A request, report or comment addressed to you, acted on in place.
struct OfficeEventRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @EnvironmentObject private var app: AppModel
    let event: OfficeInboxEvent
    let bot: OfficeTeamBot?
    var space: OfficeSpace?
    /// When set, actions go through the store: optimistic, rolled back on failure.
    var inbox: InboxStore?
    var onChange: () async -> Void
    @State private var answer = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let bot {
                Face(bot, size: 32)
            } else {
                Image(systemName: event.type == .request ? "questionmark.circle" : "newspaper")
                    .font(.title3).foregroundStyle(.secondary).frame(width: 32, height: 32)
            }
            VStack(alignment: .leading, spacing: 4) {
                let headingLayout = dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading))
                    : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
                headingLayout {
                    Button { open() } label: {
                        Text(event.title)
                            .font(.body.weight(event.type == .request || event.readAt == nil ? .semibold : .regular))
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier("officeRequestOpen")
                    Text(Date(timeIntervalSince1970: event.createdAt / 1000), format: .relative(presentation: .named, unitsStyle: .abbreviated))
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text(bot.map { "\($0.name) · \(event.body)" } ?? event.body)
                    .font(.subheadline).foregroundStyle(.secondary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 3)
                if let space {
                    Label(space.name, systemImage: "building.2").font(.caption).foregroundStyle(.secondary)
                }
                if event.answerable == true {
                    HStack {
                        TextField("Answer", text: $answer).textFieldStyle(.roundedBorder)
                        Button("Send") { act("answer", text: answer) }.disabled(busy || answer.isEmpty)
                    }
                }
                if let actions = event.actions, !actions.isEmpty {
                    let layout = dynamicTypeSize.isAccessibilitySize
                        ? AnyLayout(VStackLayout(alignment: .leading)) : AnyLayout(HStackLayout())
                    layout {
                        ForEach(actions) { action in
                            if action.primary == true {
                                Button { act(action.id) } label: {
                                    Text(action.label).frame(maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : nil, minHeight: 44)
                                }
                                    .buttonStyle(.borderedProminent)
                            } else {
                                Button { act(action.id) } label: {
                                    Text(action.label).frame(maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : nil, minHeight: 44)
                                }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                    .controlSize(.regular)
                    .disabled(busy || event.isPending)
                }
                if let error { Text(error).font(.caption).foregroundStyle(.red) }
            }
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing) {
            Button { done() } label: { Label(event.type == .request ? "Dismiss" : "Done", systemImage: "checkmark") }
                .tint(.indigo)
        }
    }

    private func open() {
        if let threadId = event.threadId, event.href == nil {
            app.push(.thread(id: threadId))
        } else if let href = event.href ?? event.item?.href {
            app.openHref(href)
        }
    }

    private func act(_ actionId: String, text: String? = nil) {
        if let inbox {
            Task { if !(await inbox.act(key: event.key, actionId: actionId, text: text)) { error = inbox.error } else { await onChange() } }
            return
        }
        perform { try await app.client.officeInboxAct(key: event.key, actionId: actionId, text: text) }
    }

    private func done() {
        if let inbox {
            Task { if !(await inbox.done(keys: [event.key])) { error = inbox.error } else { await onChange() } }
            return
        }
        perform { try await app.client.officeInboxDone(keys: [event.key]) }
    }

    private func perform(_ operation: @escaping () async throws -> Void) {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await operation()
                await onChange()
            } catch {
                self.error = BBClient.describe(error)
            }
        }
    }
}

struct OfficeTaskRow: View {
    @EnvironmentObject private var app: AppModel
    let task: OfficeWorkingTask
    let bot: OfficeTeamBot?

    var body: some View {
        Button { app.openHref(task.href) } label: {
            HStack(spacing: 12) {
                if let bot { Face(bot, size: 32) }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(task.title).lineLimit(1)
                        if let recurring = task.recurring {
                            Label(recurring, systemImage: "repeat").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Text([bot?.name, task.note].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Text(status.label).font(.caption).foregroundStyle(status.color)
            }
        }
        .foregroundStyle(.primary)
    }

    private var status: (label: String, color: Color) {
        switch task.status {
        case .working: ("Working", .green)
        case .waiting: ("Needs you", .orange)
        case .review: ("Review", .primary)
        case .done: ("Done", .secondary)
        }
    }
}

struct OfficeItemRow: View {
    @EnvironmentObject private var app: AppModel
    let item: OfficeItem
    let author: OfficeTeamBot?

    var body: some View {
        Button {
            if let route = item.route { app.push(route) } else { app.openHref(item.href) }
        } label: {
            HStack(spacing: 10) {
                if let icon = item.icon, !icon.isEmpty {
                    Text(icon).frame(width: 22)
                } else {
                    Image(systemName: item.symbol).foregroundStyle(.secondary).frame(width: 22)
                }
                Text(item.title.isEmpty ? "Untitled" : item.title).lineLimit(1)
                Spacer()
                if let author { Face(author, size: 20).accessibilityLabel("Made by \(author.name)") }
            }
        }
        .foregroundStyle(.primary)
    }
}

/// Hand work to a bot: who, what, when. It reports back to the Inbox.
struct DelegateSheet: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let bots: [OfficeTeamBot]
    var initialBotId: String?
    var context: (ref: String, title: String, folderId: String?)?
    @State private var botId: String?
    @State private var brief = ""
    @State private var schedule = "once"
    @State private var error: String?
    @State private var sending = false

    private let schedules = [("once", "Now, once"), ("hourly", "Every hour"), ("daily", "Every day"), ("weekdays", "Weekdays"), ("weekly", "Every week")]

    var body: some View {
        NavigationStack {
            Form {
                Section("Who") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 14) {
                            ForEach(bots) { bot in
                                Button { botId = bot.id } label: {
                                    VStack(spacing: 4) {
                                        Face(bot, size: 44)
                                            .overlay(Circle().stroke(botId == bot.id ? Color.accentColor : .clear, lineWidth: 2).padding(-4))
                                        Text(bot.name).font(.caption).lineLimit(1).frame(maxWidth: 72)
                                    }
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(botId == bot.id ? .isSelected : [])
                            }
                        }
                        .padding(.vertical, 6)
                    }
                }
                Section("What") {
                    TextField("Describe the outcome you want", text: $brief, axis: .vertical).lineLimit(3...8)
                }
                Section("When") {
                    Picker("Schedule", selection: $schedule) {
                        ForEach(schedules, id: \.0) { Text($0.1).tag($0.0) }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Hand Off Work")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Delegate") { submit() }
                        .disabled(sending || botId == nil || brief.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear {
                botId = initialBotId ?? bots.first?.id
                if let context, brief.isEmpty { brief = "Finish this: \(context.title)" }
            }
        }
    }

    private func submit() {
        guard let botId else { return }
        sending = true
        let text = brief.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            defer { sending = false }
            do {
                _ = try await app.client.officeDelegate(
                    botId: botId, brief: text, schedule: OfficeSchedule(rawValue: schedule),
                    context: context.map { [$0.ref] }, folderId: context?.folderId)
                dismiss()
            } catch {
                self.error = BBClient.describe(error)
            }
        }
    }
}
