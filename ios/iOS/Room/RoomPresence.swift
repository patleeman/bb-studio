import SwiftUI

struct RoomOnIt: Identifiable, Equatable {
    var id: String
    var title: String
    var trailing: String?
    var task: TaskItem?
    var threadId: String?

    static func rows(threadId: String, tasks: [TaskItem], workers: [BotWorker], now: Date = .now) -> [RoomOnIt] {
        let agent = RoomNow.agentTasks(tasks).filter { $0.ownerThreadId != threadId }
        var out = agent.map { task in
            RoomOnIt(id: task.id, title: task.title, trailing: task.step.flatMap { $0.isEmpty ? nil : $0 } ?? RoomNow.elapsed(task.updatedAt, now: now),
                     task: task, threadId: task.workers.first)
        }
        let covered = Set(tasks.flatMap(\.workers) + tasks.compactMap(\.ownerThreadId))
        let titles = Set(tasks.filter { !$0.isClosed }.map { $0.title.lowercased() })
        for worker in workers where worker.status == .running && !covered.contains(worker.threadId) && !titles.contains(worker.title.lowercased()) {
            out.append(RoomOnIt(id: "worker-" + worker.threadId, title: worker.title.isEmpty ? "Worker" : worker.title,
                                trailing: RoomNow.elapsed(worker.updated, now: now), task: nil, threadId: worker.threadId))
        }
        return out
    }
}

struct RoomFit: Equatable {
    var presence: CGFloat
    var onIt: Int
    var yours: Int
    var onItMore: Int
    var yoursMore: Int

    static func presence(_ size: CGSize) -> CGFloat {
        (min(size.width * 0.24, size.height * 0.14)).rounded()
    }

    static func make(height: CGFloat, width: CGFloat, row: CGFloat, fixed: CGFloat, onIt: Int, yours: Int) -> RoomFit {
        let presence = presence(CGSize(width: width, height: height))
        let available = height - fixed - presence * PresenceSpec.roomHeadroom
        let slots = max(1, Int((available / row).rounded(.down)))
        let wantYours = max(1, yours)
        let wantOnIt = onIt
        if wantYours + wantOnIt <= slots {
            return RoomFit(presence: presence, onIt: onIt, yours: yours, onItMore: 0, yoursMore: 0)
        }
        var yoursSlots = min(wantYours, max(1, slots - min(wantOnIt, max(1, slots / 2))))
        var onItSlots = min(wantOnIt, max(0, slots - yoursSlots))
        if onItSlots + yoursSlots < slots { yoursSlots = min(wantYours, slots - onItSlots) }
        if onItSlots + yoursSlots < slots { onItSlots = min(wantOnIt, slots - yoursSlots) }
        let onItShown = onItSlots < wantOnIt ? max(0, onItSlots - 1) : onItSlots
        let yoursShown = yoursSlots < wantYours ? max(0, yoursSlots - 1) : min(yours, yoursSlots)
        return RoomFit(presence: presence, onIt: onItShown, yours: yoursShown,
                       onItMore: onItSlots < wantOnIt ? wantOnIt - onItShown : 0,
                       yoursMore: yoursSlots < wantYours ? yours - yoursShown : 0)
    }
}

extension Look {
    var roomTint: Color { mode == .light ? Color(white: 0.96) : Color(lookHex: tokens.presence.palette.first ?? tokens.accent) }
}

struct RoomPresenceScreen: View {
    let bot: BotSpace
    let view: BotThreadsView?
    let title: String
    let subline: String
    let now: RoomNow
    let onIt: [RoomOnIt]
    let yours: [TaskItem]?
    let names: TaskNames
    var menuButton = true
    var shown = true
    var bottomClear: CGFloat = 0
    var nudge: CGFloat = 0
    var canSwitch = false
    var openMenu: () -> Void = {}
    var openChat: () -> Void = {}
    var openTask: (String) -> Void = { _ in }
    var openThread: (String) -> Void = { _ in }
    var openTasks: () -> Void = {}
    var act: (TaskItem, TaskAction) -> Void = { _, _ in }
    var switchBot: (Int) -> Void = { _ in }
    var reportPresence: (CGFloat) -> Void = { _ in }
    var reportPresenceFrame: (CGRect) -> Void = { _ in }
    @ScaledMetric(relativeTo: .body) private var row: CGFloat = 44
    @ScaledMetric(relativeTo: .title3) private var nowHeight: CGFloat = 92
    @ScaledMetric(relativeTo: .footnote) private var label: CGFloat = 26
    @Environment(\.look) private var look

    static func wide(_ size: CGSize) -> Bool { size.width >= 560 && size.width > size.height * 1.25 }

    var body: some View {
        GeometryReader { proxy in
            if Self.wide(proxy.size) {
                wideBody(proxy.size)
            } else {
                tallBody(proxy.size)
            }
        }
    }

    private func tallBody(_ size: CGSize) -> some View {
        let fixed = 52 + nowHeight + label * (onIt.isEmpty ? 1 : 2) + 36 + bottomClear
        let fit = RoomFit.make(height: size.height, width: size.width, row: row, fixed: fixed, onIt: onIt.count, yours: yours?.count ?? 0)
        return VStack(spacing: 0) {
            header
            presence(fit.presence)
                .padding(.top, 4)
            RoomNowLine(now: now, open: openChat)
                .padding(.top, 2)
                .padding(.horizontal, 10)
            lists(fit)
                .padding(.top, 14)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 22)
        .padding(.top, 8)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onChange(of: fit.presence, initial: true) { _, size in reportPresence(size) }
    }

    private func wideBody(_ size: CGSize) -> some View {
        let column = (size.width - 44 - 28) / 2
        let presenceSize = min(column * 0.3, size.height * 0.22).rounded()
        let fixed = 20 + label * (onIt.isEmpty ? 1 : 2) + 20 + bottomClear
        let fit = RoomFit.make(height: size.height, width: column, row: row, fixed: fixed - RoomFit.presence(CGSize(width: column, height: size.height)) * PresenceSpec.roomHeadroom,
                               onIt: onIt.count, yours: yours?.count ?? 0)
        return HStack(alignment: .top, spacing: 28) {
            VStack(spacing: 0) {
                header
                presence(presenceSize)
                    .padding(.top, 4)
                RoomNowLine(now: now, open: openChat)
                    .padding(.top, 2)
                Spacer(minLength: 0)
            }
            .frame(width: column)
            lists(fit)
                .padding(.top, 20)
                .frame(width: column, alignment: .topLeading)
                .frame(maxHeight: .infinity, alignment: .top)
        }
        .padding(.horizontal, 22)
        .padding(.top, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onChange(of: presenceSize, initial: true) { _, size in reportPresence(size) }
    }

    private func lists(_ fit: RoomFit) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if !onIt.isEmpty {
                section("ON IT")
                ForEach(onIt.prefix(fit.onIt)) { item in
                    RoomOnItRow(item: item, names: names, open: { open(item) }, act: { action in if let task = item.task { act(task, action) } })
                }
                if fit.onItMore > 0 { more(fit.onItMore, label: "more on it") }
            }
            if let yours {
                section("YOURS").padding(.top, onIt.isEmpty ? 0 : 10)
                if yours.isEmpty {
                    Text("Nothing waiting on you")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.5))
                        .frame(maxWidth: .infinity, minHeight: row, alignment: .leading)
                        .accessibilityIdentifier("roomYoursEmpty")
                } else {
                    ForEach(yours.prefix(fit.yours)) { task in
                        RoomYoursRow(task: task, names: names, open: { openTask(task.id) }, act: { act(task, $0) })
                    }
                    if fit.yoursMore > 0 { more(fit.yoursMore, label: "more for you") }
                }
            }
        }
        .padding(.horizontal, 6)
        .allowsHitTesting(shown)
        .accessibilityHidden(!shown)
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.94))
                    .lineLimit(1)
                Text(subline)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.58))
                    .lineLimit(1)
            }
            .lookHalo(look)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("roomTitle")
            .id(title)
            .transition(.opacity)
            Spacer(minLength: 8)
            if menuButton && !shown {
                Color.clear.frame(width: 44, height: 44)
            } else if menuButton {
                Button(action: openMenu) {
                    Image(systemName: "line.3.horizontal").font(.body.weight(.medium)).foregroundStyle(.white.opacity(0.75))
                        .frame(width: 44, height: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Everything else")
                .accessibilityIdentifier("roomMenuButton")
            }
        }
        .frame(minHeight: 44, alignment: .top)
        .padding(.top, 6)
    }

    private func presence(_ size: CGFloat) -> some View {
        PresenceView(bot: bot, state: bot.presenceState(live: view),
                     workers: view?.workers.filter { $0.status == .running }.count ?? bot.activity.workers, size: size,
                     room: PresenceSpec.roomHeadroom, paused: !shown)
            .offset(x: nudge)
            .roomPresenceSlot(size)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { reportPresenceFrame($0) }
            .contentShape(.rect)
            .accessibilityElement()
            .accessibilityLabel("\(bot.name), \(BotShell.status(bot, view: view))")
            .accessibilityHint(canSwitch ? "Swipe up or down to switch Bots" : "")
            .accessibilityAdjustableAction { direction in switchBot(direction == .increment ? 1 : -1) }
            .accessibilityIdentifier("roomPresence")
    }

    private func section(_ title: String) -> some View {
        Text(title)
            .font(.caption2.weight(.semibold))
            .kerning(0.9)
            .foregroundStyle(.white.opacity(0.5))
            .frame(minHeight: label - 6, alignment: .bottomLeading)
            .padding(.bottom, 2)
            .accessibilityAddTraits(.isHeader)
            .accessibilityLabel(title.capitalized)
    }

    private func more(_ count: Int, label: String) -> some View {
        Button(action: openTasks) {
            Text("\(count) \(label)")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.55))
                .frame(maxWidth: .infinity, minHeight: row, alignment: .leading)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens Tasks")
        .accessibilityIdentifier("roomMore")
    }

    private func open(_ item: RoomOnIt) {
        if let task = item.task {
            openTask(task.id)
        } else if let threadId = item.threadId {
            openThread(threadId)
        }
    }
}

struct RoomNowLine: View {
    let now: RoomNow
    var open: () -> Void
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: open) {
            VStack(spacing: 5) {
                HStack(spacing: 7) {
                    RoomPulse(active: now.active, tint: look.roomTint)
                    Text("NOW").font(.caption2.weight(.semibold)).kerning(0.9)
                }
                .foregroundStyle(look.roomTint.opacity(now.active ? 0.9 : 0.55))
                Text(now.text)
                    .font(.title3.weight(.medium))
                    .foregroundStyle(.white.opacity(now.active ? 0.96 : 0.75))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .contentTransition(.opacity)
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    if let small = now.small(now: context.date) {
                        Text(small)
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.55))
                            .lineLimit(1)
                            .contentTransition(.opacity)
                    }
                }
            }
            .frame(maxWidth: 420)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .lookHalo(look)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: now)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Now: " + now.text + (now.small().map { ", " + $0 } ?? ""))
        .accessibilityHint("Opens the conversation")
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("roomNow")
    }
}

struct RoomPulse: View {
    let active: Bool
    let tint: Color
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @State private var on = false

    var body: some View {
        Circle().fill(tint.opacity(active ? 1 : 0.5))
            .frame(width: 6, height: 6)
            .background(Circle().fill(tint.opacity(active ? (on ? 0.08 : 0.22) : 0)).frame(width: 14, height: 14))
            .onAppear {
                guard active, !(systemReduceMotion || RoomQA.reduceMotion) else { return }
                withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) { on = true }
            }
            .accessibilityHidden(true)
    }
}

struct RoomSpinner: View {
    let tint: Color
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion

    var body: some View {
        let still = systemReduceMotion || RoomQA.reduceMotion
        TimelineView(.animation(paused: still)) { context in
            let turn = still ? 0 : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.1) / 1.1 * 360
            ZStack {
                Circle().stroke(tint.opacity(0.25), lineWidth: 1.5)
                Circle().trim(from: 0, to: 0.25).stroke(tint, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                    .rotationEffect(.degrees(turn))
            }
        }
        .frame(width: 14, height: 14)
        .accessibilityHidden(true)
    }
}

struct RoomOnItRow: View {
    let item: RoomOnIt
    let names: TaskNames
    var open: () -> Void
    var act: (TaskAction) -> Void
    @ScaledMetric(relativeTo: .body) private var row: CGFloat = 44
    @Environment(\.look) private var look

    var body: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                RoomSpinner(tint: look.roomTint)
                Text(item.title).font(.subheadline).foregroundStyle(.white.opacity(0.86)).lineLimit(1)
                Spacer(minLength: 8)
                if let trailing = item.trailing {
                    Text(trailing).font(.caption).foregroundStyle(.white.opacity(0.52)).lineLimit(1)
                        .fixedSize()
                }
            }
            .frame(maxWidth: .infinity, minHeight: row, alignment: .leading)
            .contentShape(.rect)
            .lookHalo(look)
        }
        .buttonStyle(.plain)
        .contextMenu {
            if let task = item.task { TaskMenu(task: task, names: names, open: open, perform: act) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityHint(item.task == nil ? "Opens the worker" : "Opens the task")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(.default, open)
        .accessibilityIdentifier(identifier)
    }

    private var label: String {
        var parts = [item.title]
        if let trailing = item.trailing { parts.append(trailing) }
        if let task = item.task { parts.append(names.label(task.owner) + " is on it") }
        return parts.joined(separator: ", ")
    }

    private var identifier: String {
        if let task = item.task { return "roomCard-" + task.id }
        return "roomOnIt-" + (item.threadId ?? item.id)
    }
}

struct RoomYoursRow: View {
    let task: TaskItem
    let names: TaskNames
    var open: () -> Void
    var act: (TaskAction) -> Void
    @State private var closing: TaskAction?
    @ScaledMetric(relativeTo: .body) private var row: CGFloat = 44
    @Environment(\.look) private var look

    private var deciding: Bool { task.kind == .decide && !task.options.isEmpty }
    private var trailing: String? {
        if task.needsYou { return deciding ? "\(task.options.count) options" : "Needs you" }
        return TaskRules.roomLine(task).flatMap { $0.count > 22 ? nil : $0 }
    }

    var body: some View {
        HStack(spacing: 0) {
            leading
            Button(action: open) {
                HStack(spacing: 8) {
                    Text(task.title).font(.subheadline).foregroundStyle(.white.opacity(0.86)).lineLimit(1)
                    Spacer(minLength: 6)
                    if let trailing {
                        Text(trailing).font(.caption)
                            .foregroundStyle(task.needsYou ? look.needsYou.opacity(0.85) : .white.opacity(0.5))
                            .lineLimit(1)
                            .fixedSize()
                    }
                }
                .frame(maxWidth: .infinity, minHeight: row, alignment: .leading)
                .contentShape(.rect)
                .lookHalo(look)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            .accessibilityHint("Opens the task")
            .accessibilityIdentifier("roomCard-\(task.id)")
        }
        .opacity(closing == nil ? 1 : 0.45)
        .contentShape(.contextMenuPreview, .rect(cornerRadius: 10))
        .contextMenu { TaskMenu(task: task, names: names, open: open, perform: run) }
        .task(id: closing) {
            guard closing != nil else { return }
            try? await Task.sleep(for: .seconds(8))
            closing = nil
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("roomTask-\(task.id)")
        .accessibilityValue(TaskRules.status(task).id)
    }

    @ViewBuilder private var leading: some View {
        if deciding {
            Image(systemName: "arrow.triangle.branch").font(.caption).foregroundStyle(task.needsYou ? look.needsYou.opacity(0.8) : .white.opacity(0.45))
                .frame(width: 26, height: row, alignment: .leading)
                .accessibilityHidden(true)
        } else {
            Button {
                run(task.kind == .read ? .gotIt : .done)
            } label: {
                Circle().strokeBorder(task.needsYou ? look.needsYou.opacity(0.8) : .white.opacity(0.42), lineWidth: 1.5)
                    .overlay { if closing != nil { Image(systemName: "checkmark").font(.system(size: 8, weight: .bold)) } }
                    .frame(width: 14, height: 14)
                    .frame(width: 26, height: row, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(task.kind == .read ? "Got it" : "Done"): \(task.title)")
        }
    }

    private var label: String {
        var parts = [task.title]
        if task.needsYou { parts.append("Needs you") }
        if let line = TaskRules.roomLine(task) { parts.append(line) }
        return parts.joined(separator: ", ")
    }

    private func run(_ action: TaskAction) {
        switch action {
        case .done, .gotIt, .choose, .drop: closing = action
        default: break
        }
        act(action)
    }
}

struct RoomLightLayer: View {
    let light: RoomLight
    let seed: String

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                grade
                if let orb {
                    let spot = RoomLightLayer.spot(seed: seed, size: proxy.size)
                    Circle().fill(orb.color.opacity(orb.opacity))
                        .frame(width: orb.size, height: orb.size)
                        .shadow(color: orb.color.opacity(0.5), radius: orb.size * 1.4)
                        .position(spot)
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var grade: some View {
        switch light {
        case .natural:
            Color.clear
        case .dusk:
            ZStack {
                LinearGradient(colors: [Color(red: 0.36, green: 0.28, blue: 0.5), Color(red: 0.8, green: 0.48, blue: 0.4), Color(red: 0.2, green: 0.14, blue: 0.18)],
                               startPoint: .top, endPoint: .bottom).blendMode(.color).opacity(0.55)
                LinearGradient(colors: [Color(red: 0.95, green: 0.62, blue: 0.45).opacity(0.28), .clear], startPoint: .center, endPoint: .top).blendMode(.screen)
            }
        case .night:
            ZStack {
                LinearGradient(colors: [Color(red: 0.12, green: 0.18, blue: 0.34), Color(red: 0.06, green: 0.09, blue: 0.16)], startPoint: .top, endPoint: .bottom)
                    .blendMode(.multiply).opacity(0.75)
                Color(red: 0.2, green: 0.3, blue: 0.5).blendMode(.color).opacity(0.35)
            }
        case .dawn:
            ZStack {
                LinearGradient(colors: [Color(red: 0.55, green: 0.5, blue: 0.75), Color(red: 0.98, green: 0.7, blue: 0.68), Color(red: 0.3, green: 0.26, blue: 0.3)],
                               startPoint: .top, endPoint: .bottom).blendMode(.color).opacity(0.45)
                LinearGradient(colors: [.clear, Color(red: 1, green: 0.78, blue: 0.7).opacity(0.22), .clear], startPoint: .top, endPoint: .bottom).blendMode(.screen)
            }
        case .morning:
            ZStack {
                LinearGradient(colors: [Color(red: 0.55, green: 0.75, blue: 0.85), Color(red: 0.95, green: 0.88, blue: 0.62)], startPoint: .top, endPoint: .bottom)
                    .blendMode(.softLight).opacity(0.7)
                LinearGradient(colors: [Color(red: 1, green: 0.95, blue: 0.8).opacity(0.25), .clear], startPoint: .top, endPoint: .center).blendMode(.screen)
            }
        }
    }

    static func spot(seed: String, size: CGSize) -> CGPoint {
        let hash = RoomLight.hash(seed)
        let side = Double(hash % 18) / 100
        let x = hash % 2 == 0 ? 0.1 + side : 0.72 + side
        return CGPoint(x: size.width * x, y: min(size.height * 0.2, 150) + Double((hash >> 8) % 30))
    }

    private var orb: (color: Color, size: CGFloat, opacity: Double)? {
        switch light {
        case .natural: nil
        case .dusk: (Color(red: 0.98, green: 0.74, blue: 0.55), 26, 0.75)
        case .night: (Color(red: 0.88, green: 0.9, blue: 0.92), 20, 0.55)
        case .dawn: (Color(red: 1, green: 0.8, blue: 0.75), 24, 0.6)
        case .morning: (Color(red: 1, green: 0.96, blue: 0.82), 28, 0.6)
        }
    }
}

struct RoomShade: View {
    var standing = false
    @Environment(\.look) private var look

    var body: some View {
        let light = look.mode == .light
        ZStack {
            LinearGradient(stops: [.init(color: .black.opacity(light ? 0.2 : 0.08), location: 0), .init(color: .black.opacity(light ? 0.34 : 0.1), location: 0.28),
                                   .init(color: .black.opacity(light ? 0.62 : 0.5), location: 0.5), .init(color: .black.opacity(light ? 0.74 : 0.66), location: 1)],
                           startPoint: .top, endPoint: .bottom)
            Color.black.opacity(standing ? 0.42 : 0)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
