import SwiftUI

/// The Bot's Loops: everything the Chief of Staff tracks for you, in five
/// sections, with Add a loop, area and owner filters, and each row's actions
/// (Change trigger and Surface now as well as the card's). A question the
/// Bot asked in its chat shows under Needs you now, read-only, once.
struct LoopsView: View {
    /// What the Bot's chat waits on (`bot_activity` attention), shown read-only.
    var attention: BotActivity.Attention?
    /// Shows the Bot's chat.
    var openChat: () -> Void
    /// In the unfolded Duo's left pane, with the sidebar's margins.
    var sidebar = false
    @State private var model = LoopsModel.shared
    @State private var adding = ""
    @State private var addError: String?
    @State private var area: String?
    @State private var owner: String?
    @State private var expanded: String?
    @State private var sheet: LoopsSheet?
    @State private var showsDone = false
    @FocusState private var addFocused: Bool
    @EnvironmentObject private var app: AppModel

    /// A pending question or approval in the Bot's chat, not a loop.
    private var pendingQuestion: String? {
        guard let reason = attention?.reason else { return nil }
        return ["Asked you a question", "Waiting for approval", "Waiting for your answer"].contains(reason) ? reason : nil
    }

    private func shown(_ loops: [LoopItem]) -> [LoopItem] {
        loops.filter { loop in
            (area == nil || loop.area?.caseInsensitiveCompare(area!) == .orderedSame) && (owner == nil || loop.owner == owner)
        }
    }

    var body: some View {
        let groups = model.groups ?? .empty
        List {
            Section {
                addField
                LoopFilterChips(area: $area, owner: $owner, areas: groups.areas, owners: model.handOffTargets)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            if model.groups == nil, let error = model.listError {
                Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary) }
            }
            let needs = shown(groups.needsYouNow)
            if pendingQuestion != nil || !needs.isEmpty {
                Section("Needs you now") {
                    if let pendingQuestion { pendingRow(pendingQuestion) }
                    ForEach(needs) { row($0, section: .needsYou) }
                }
            }
            section("Coming up", shown(groups.comingUp), .comingUp)
            section("Agents on it", shown(groups.agentsOnIt), .agents)
            section("Waiting on others", shown(groups.waitingOnOthers), .waiting)
            let done = shown(groups.done)
            if !done.isEmpty {
                Section {
                    if showsDone { ForEach(done) { row($0, section: .done) } }
                } header: {
                    Button { withAnimation { showsDone.toggle() } } label: {
                        HStack {
                            Text("Done · last 7 days")
                            Spacer()
                            Image(systemName: showsDone ? "chevron.down" : "chevron.right")
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            if model.groups != nil, groups.isEmpty, pendingQuestion == nil {
                Section {
                    ContentUnavailableView("No open todos", systemImage: "checkmark.circle",
                                           description: Text("When something needs you, \(model.botName) puts it here and in the chat."))
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .modifier(SidebarListMargins(enabled: sidebar))
        .accessibilityIdentifier("loops-screen")
        .refreshable { await model.refreshList() }
        .task { await model.refreshList() }
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .snooze(let loop): LoopSnoozeSheet(loop: loop) { act(loop, .snooze($0)) }
            case .choose(let loop): LoopChooseSheet(loop: loop) { act(loop, .choose($0)) }
            case .trigger(let loop): ChangeTriggerSheet(loop: loop)
            }
        }
    }

    private var addField: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Image(systemName: "plus").foregroundStyle(.secondary)
                TextField("Add a todo: “call the plumber when I'm home”", text: $adding)
                    .focused($addFocused)
                    .submitLabel(.done)
                    .onSubmit(add)
                    .accessibilityIdentifier("loops-add")
            }
            .padding(.horizontal, 14).frame(minHeight: 48)
            .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 14, style: .continuous))
            if let addError { Text(addError).font(.caption).foregroundStyle(.orange) }
        }
    }

    private func add() {
        let text = adding.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        adding = ""
        addError = nil
        Task {
            do { try await model.add(text) } catch {
                adding = text
                addError = BBClient.describe(error)
            }
        }
    }

    @ViewBuilder
    private func section(_ title: String, _ loops: [LoopItem], _ kind: LoopRowSection) -> some View {
        if !loops.isEmpty {
            Section(title) { ForEach(loops) { row($0, section: kind) } }
        }
    }

    private func pendingRow(_ reason: String) -> some View {
        Button(action: openChat) {
            HStack(spacing: 12) {
                Image(systemName: "questionmark.bubble").foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                    Text(reason)
                    Text("In the chat with \(model.botName)").font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("loops-pending-question")
    }

    private func row(_ loop: LoopItem, section: LoopRowSection) -> some View {
        LoopsRow(loop: loop, section: section, expanded: expanded == loop.id,
                 toggle: { withAnimation(.smooth(duration: 0.2)) { expanded = expanded == loop.id ? nil : loop.id } },
                 act: { act(loop, $0) }, sheet: { sheet = $0 }, discuss: { discuss(loop) })
    }

    /// Discuss: the loop in the Bot chat's draft, not sent, and the chat.
    private func discuss(_ loop: LoopItem) {
        sheet = nil
        app.draftForBot(LoopFormat.discussDraft(loop))
        openChat()
    }

    private func act(_ loop: LoopItem, _ action: LoopAction) {
        sheet = nil
        if action == .nudge {
            app.draftForBot(LoopFormat.nudgeDraft(loop))
            openChat()
            return
        }
        Task {
            do { try await model.perform(loop.id, action) } catch { app.flash("Couldn't update the todo: \(BBClient.describe(error))") }
        }
    }
}

enum LoopsSheet: Identifiable {
    case snooze(LoopItem), choose(LoopItem), trigger(LoopItem)
    var id: String {
        switch self {
        case .snooze(let loop): "snooze-\(loop.id)"
        case .choose(let loop): "choose-\(loop.id)"
        case .trigger(let loop): "trigger-\(loop.id)"
        }
    }
}

enum LoopRowSection { case needsYou, comingUp, agents, waiting, done }

/// All, the areas the loops use, and an owner menu.
private struct LoopFilterChips: View {
    @Binding var area: String?
    @Binding var owner: String?
    let areas: [String]
    let owners: [(owner: String, name: String)]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("All", selected: area == nil) { area = nil }
                ForEach(areas + (area.map { areas.contains($0) ? [] : [$0] } ?? []), id: \.self) { name in
                    chip(name, selected: area == name) { area = area == name ? nil : name }
                }
                Menu {
                    Picker("Owner", selection: $owner) {
                        Text("Anyone").tag(String?.none)
                        Text("You").tag(String?.some("patrick"))
                        ForEach(owners, id: \.owner) { Text($0.name).tag(String?.some($0.owner)) }
                    }
                } label: {
                    Label(owner.map { LoopsModel.shared.ownerName($0) } ?? "Owner", systemImage: "person")
                        .labelStyle(.titleAndIcon)
                        .padding(.horizontal, 14).frame(minHeight: 36)
                        .background(owner == nil ? AnyShapeStyle(.fill.tertiary) : AnyShapeStyle(Color.primary), in: .capsule)
                        .foregroundStyle(owner == nil ? Color.primary : Color(uiColor: .systemBackground))
                }
                .accessibilityLabel("Owner")
            }
        }
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .padding(.horizontal, 14).frame(minHeight: 36)
                .background(selected ? AnyShapeStyle(Color.primary) : AnyShapeStyle(.fill.tertiary), in: .capsule)
                .foregroundStyle(selected ? Color(uiColor: .systemBackground) : .primary)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// One loop: icon, title, what it waits for, when. A tap shows its buttons.
private struct LoopsRow: View {
    let loop: LoopItem
    let section: LoopRowSection
    let expanded: Bool
    let toggle: () -> Void
    let act: (LoopAction) -> Void
    let sheet: (LoopsSheet) -> Void
    let discuss: () -> Void
    @State private var model = LoopsModel.shared
    @EnvironmentObject private var app: AppModel

    private var symbol: String {
        section == .comingUp ? LoopFormat.triggerSymbol(loop.trigger) : LoopFormat.kindSymbol(loop.kind)
    }

    private var subtitle: String {
        switch section {
        case .comingUp: LoopFormat.trigger(loop.trigger)
        case .agents: "\(model.ownerName(loop.owner)) is on it"
        case .done: [loop.status == .dropped ? "Dropped" : "Done", loop.closedBy.map { $0 == "patrick" ? "by you" : "by \(model.ownerName($0))" }].compactMap { $0 }.joined(separator: " ")
        default: loop.why
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: toggle) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: symbol).font(.title3).foregroundStyle(.secondary).frame(width: 26)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(loop.title).strikethrough(section == .done).lineLimit(2)
                        if !subtitle.isEmpty { Text(subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
                    }
                    Spacer(minLength: 8)
                    if let due = loop.due, section != .done {
                        Text(LoopFormat.day(due)).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("loop-row")
            if expanded { actions.padding(.leading, 38) }
        }
    }

    @ViewBuilder
    private var actions: some View {
        FlowLayout(spacing: 8) {
            switch section {
            case .needsYou:
                switch loop.kind {
                case .do: pill("Done", primary: true) { act(.done) }
                case .read: pill("Got it", primary: true) { act(.gotIt) }
                case .waiting: pill("Nudge them") { act(.nudge) }
                case .decide:
                    if loop.options.count > LoopCardState.inlineOptions {
                        pill("Choose…", primary: true) { sheet(.choose(loop)) }
                    } else {
                        ForEach(loop.options, id: \.self) { option in pill(LoopOption(option).title) { act(.choose(option)) } }
                    }
                }
                pill("Snooze") { sheet(.snooze(loop)) }
                handOff
            case .comingUp, .waiting:
                pill("Surface now", primary: true) { surfaceNow() }
                pill("Change trigger") { sheet(.trigger(loop)) }
            case .agents:
                if let thread = loop.ownerThreadId { pill("Open thread") { app.openThread(thread) } }
                pill("Take back") { act(.takeBack) }
            case .done:
                if loop.closedBy == "patrick" { pill("Undo") { act(.undo) } }
            }
            if section != .done { more }
        }
    }

    private var handOff: some View {
        Menu {
            Section("Hand off to") {
                ForEach(model.handOffTargets, id: \.owner) { target in
                    Button(target.name) { act(.handOff(owner: target.owner)) }
                }
            }
        } label: { LoopPill(title: "Hand off", style: .secondary) }
    }

    private var more: some View {
        Menu {
            Button(action: discuss) { Label("Discuss", systemImage: "bubble.left.and.text.bubble.right") }
            Button { sheet(.trigger(loop)) } label: { Label("Change trigger", systemImage: "calendar.badge.clock") }
            Button { surfaceNow() } label: { Label("Surface now", systemImage: "arrow.up.to.line") }
            Menu {
                ForEach(model.handOffTargets, id: \.owner) { target in
                    Button(target.name) { act(.handOff(owner: target.owner)) }
                }
            } label: { Label("Hand off…", systemImage: "arrowshape.turn.up.right") }
            Button(role: .destructive) { act(.drop) } label: { Label("Drop", systemImage: "xmark") }
        } label: {
            Image(systemName: "ellipsis").font(.body.weight(.semibold))
                .frame(width: 40, height: 36).background(.fill.tertiary, in: .capsule)
        }
        .accessibilityLabel("More actions")
    }

    private func pill(_ title: String, primary: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) { LoopPill(title: title, style: primary ? .primary : .secondary) }
            .buttonStyle(.plain)
    }

    private func surfaceNow() {
        Task {
            do { try await model.surfaceNow(loop.id) } catch { app.flash("Couldn't surface it: \(BBClient.describe(error))") }
        }
    }
}

/// When a loop comes back: a time, a named event, a place, or anytime, and
/// whether it pushes to this iPhone.
struct ChangeTriggerSheet: View {
    let loop: LoopItem
    enum Kind: String, CaseIterable { case time = "Time", event = "Event", place = "Place", anytime = "Anytime" }
    @State private var kind: Kind
    @State private var date: Date
    @State private var event: String
    @State private var place: String
    @State private var arrive: Bool
    @State private var push: Bool
    @State private var saving = false
    @State private var error: String?
    @State private var places = PlacesStore.shared
    @Environment(\.dismiss) private var dismiss

    init(loop: LoopItem) {
        self.loop = loop
        var kind = Kind.anytime, date = Date().addingTimeInterval(3600), event = "", place = "", arrive = true
        switch loop.trigger {
        case .none: break
        case .time(let at): kind = .time; date = max(at, Date())
        case .event(let name): kind = .event; event = name
        case .place(let name, let isArrive): kind = .place; place = name; arrive = isArrive
        }
        _kind = State(initialValue: kind)
        _date = State(initialValue: date)
        _event = State(initialValue: event)
        _place = State(initialValue: place)
        _arrive = State(initialValue: arrive)
        _push = State(initialValue: loop.push)
    }

    private var trigger: LoopItem.Trigger? {
        switch kind {
        case .time: .time(date)
        case .event: event.trimmingCharacters(in: .whitespaces).isEmpty ? nil : .event(event.trimmingCharacters(in: .whitespaces))
        case .place: place.isEmpty ? nil : .place(place, arrive: arrive)
        case .anytime: LoopItem.Trigger.none
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Trigger", selection: $kind) {
                        ForEach(Kind.allCases, id: \.self) { Text($0.rawValue) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                switch kind {
                case .time:
                    Section { DatePicker("When", selection: $date, in: Date()..., displayedComponents: [.date, .hourAndMinute]) }
                case .event:
                    Section {
                        TextField("reply:sam", text: $event)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    } footer: {
                        Text("Agents and automations fire named events, such as reply:sam when Sam replies.")
                    }
                case .place:
                    placeSection
                case .anytime:
                    Section { Text("At the next good moment, within your daily budget.").foregroundStyle(.secondary) }
                }
                Section {
                    Toggle("Send to iPhone", isOn: $push)
                } footer: {
                    if kind == .place {
                        Text("Places live on this iPhone. Studio only hears “arrived at \(place.isEmpty ? "Home" : place)”.")
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.orange) } }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text("Change trigger").font(.headline)
                        Text(loop.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(trigger == nil || saving)
                }
            }
        }
        .presentationDetents([.large])
    }

    @ViewBuilder
    private var placeSection: some View {
        Section {
            if places.places.isEmpty {
                Text("Add Home or another place in Settings ▸ Places.").foregroundStyle(.secondary)
            }
            ForEach(places.places) { saved in
                Button { place = saved.name } label: {
                    HStack {
                        Label(saved.name, systemImage: saved.symbol)
                        Spacer()
                        if place.caseInsensitiveCompare(saved.name) == .orderedSame { Image(systemName: "checkmark.circle").foregroundStyle(Color.accentColor) }
                    }
                }
                .tint(.primary)
            }
        }
        Section {
            Picker("When", selection: $arrive) {
                Text("Arrive").tag(true)
                Text("Leave").tag(false)
            }
            .pickerStyle(.segmented)
        }
    }

    private func save() {
        guard let trigger else { return }
        saving = true
        Task {
            do {
                try await LoopsModel.shared.changeTrigger(loop.id, trigger, push: push)
                dismiss()
            } catch {
                saving = false
                self.error = BBClient.describe(error)
            }
        }
    }
}
