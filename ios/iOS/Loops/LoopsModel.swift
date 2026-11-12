import Foundation
import Observation

/// The loops this server's Studio tracks, shared by the chat's cards and the
/// Loops screen so an action in one shows in the other. Cleared when the
/// server changes.
@MainActor @Observable
final class LoopsModel {
    static let shared = LoopsModel()

    /// Studio's Attention Router setting; nil until it's known.
    private(set) var enabled: Bool?
    private(set) var details: [String: LoopDetail] = [:]
    private(set) var failures: [String: String] = [:]
    private(set) var groups: LoopGroups?
    private(set) var listError: String?
    /// The Bot's name, for "Chief of Staff is on it".
    var botName = BotInfo.defaultName
    /// Leads the Bot started that are still working: Hand off targets after the Chief of Staff.
    var leads: [(id: String, title: String)] = []
    private var server: URL?
    private var enabledCheckedAt: Date?

    private var client: BBClient {
        #if DEBUG
        LoopsDemo.installIfNeeded()
        #endif
        let client = AppModel.shared.client
        if server != client.baseURL {
            server = client.baseURL
            enabled = nil
            details = [:]
            failures = [:]
            groups = nil
            enabledCheckedAt = nil
        }
        return client
    }

    /// Reads the setting, at most once a minute unless forced.
    func checkEnabled(force: Bool = false) async {
        let client = client
        if !force, let enabledCheckedAt, enabledCheckedAt > .now.addingTimeInterval(-60), enabled != nil { return }
        do {
            let on = try await client.loopsEnabled()
            guard client.baseURL == server else { return }
            enabledCheckedAt = .now
            if enabled != on { enabled = on }
        } catch where BBClient.isCancellation(error) {
        } catch {
            // Offline or a Studio without the setting: keep what was known, else off.
            if enabled == nil { enabled = false }
        }
    }

    func detail(_ id: String) -> LoopDetail? { details[id] }
    func failure(_ id: String) -> String? { failures[id] }

    func load(_ id: String) async {
        let client = client
        do {
            let detail = try await client.loop(id)
            guard client.baseURL == server else { return }
            details[id] = detail
            failures[id] = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            if details[id] == nil { failures[id] = (error as? BBError)?.status == 404 ? "This todo is gone." : BBClient.describe(error) }
        }
    }

    /// Runs an action and keeps the answer. Throws what Studio said.
    @discardableResult
    func perform(_ id: String, _ action: LoopAction) async throws -> LoopItem? {
        let client = client
        let loop = try await client.loopAction(id, action)
        if let loop { store(loop, chosen: action) }
        await refreshList()
        return loop
    }

    func changeTrigger(_ id: String, _ trigger: LoopItem.Trigger, push: Bool) async throws {
        store(try await client.changeLoopTrigger(id, trigger, push: push), chosen: nil)
        await refreshList()
    }

    func surfaceNow(_ id: String) async throws {
        store(try await client.surfaceLoopNow(id), chosen: nil)
        await refreshList()
    }

    func add(_ text: String) async throws {
        try await client.addLoop(text)
        await refreshList()
    }

    func refreshList(area: String? = nil, owner: String? = nil) async {
        let client = client
        do {
            let groups = try await client.loops(area: area, owner: owner)
            guard client.baseURL == server else { return }
            if listError != nil { listError = nil }
            // An unchanged list redraws nothing: a redraw closes a card's open menu.
            guard groups != self.groups else { return }
            self.groups = groups
            for loop in groups.all where details[loop.id].map({ $0.loop != loop }) == true {
                details[loop.id]?.loop = loop
            }
        } catch where BBClient.isCancellation(error) {
        } catch {
            listError = BBClient.describe(error)
        }
    }

    private func store(_ loop: LoopItem, chosen action: LoopAction?) {
        var detail = details[loop.id] ?? LoopDetail(loop: loop)
        detail.loop = loop
        if case .choose(let option)? = action { detail.chosen = option }
        if action == .undo { detail.chosen = nil }
        if case .handOff? = action { detail.handedOffAt = .now }
        details[loop.id] = detail
        failures[loop.id] = nil
    }

    /// Who an owner is, in words: "You", the Bot's name, or the lead's title.
    func ownerName(_ owner: String) -> String {
        if owner == "patrick" { return "You" }
        if owner == "cos" { return botName }
        if owner.hasPrefix("thread:") {
            let id = String(owner.dropFirst("thread:".count))
            return leads.first { $0.id == id }?.title ?? ThreadTitles.titles[id] ?? "A lead"
        }
        return owner
    }

    /// The Chief of Staff, then the leads.
    var handOffTargets: [(owner: String, name: String)] {
        [("cos", botName)] + leads.map { ("thread:\($0.id)", $0.title) }
    }

    #if DEBUG
    /// Fixtures set the answer without a server.
    func setEnabledForDemo(_ on: Bool) { enabled = on }
    #endif
}

extension LoopDetail {
    init(loop: LoopItem, chosen: String? = nil, handedOffAt: Date? = nil) {
        self.loop = loop
        self.chosen = chosen
        self.handedOffAt = handedOffAt
    }
}
