import SwiftUI

// MARK: A thread's Chief of Staff menu

/// Whether a thread is Studio's Chief of Staff (the lead of BB's personal project), for its menu.
@MainActor
final class ChiefOfStaffModel: ObservableObject {
    /// False until Studio answers, and while it is absent or too old to have the slot.
    @Published private(set) var available = false
    @Published private(set) var chiefThreadId: String?

    func load(client: BBClient) async {
        do {
            let chief = try await client.chiefOfStaff()
            available = chief != nil
            chiefThreadId = chief?.threadId
        } catch {
            // Keep what was loaded.
        }
    }

    /// What the thread menu says for the Chief of Staff.
    static let chiefLabel = "Chief of Staff · personal project"

    func isChief(_ threadId: String) -> Bool { chiefThreadId == threadId }

    func setChief(_ threadId: String?, client: BBClient) async throws {
        let previous = chiefThreadId
        chiefThreadId = threadId
        do {
            try await client.setChiefOfStaff(threadId)
        } catch {
            if chiefThreadId == threadId { chiefThreadId = previous }
            await load(client: client)
            throw error
        }
        await load(client: client)
    }
}

/// Makes a thread the Chief of Staff, or, for the Chief of Staff, edits its heartbeat or removes it.
struct ChiefOfStaffMenu: View {
    @ObservedObject var model: ChiefOfStaffModel
    let threadId: String
    /// Sub-threads can't be the Chief of Staff.
    var isChild = false
    /// Opens the Chief of Staff heartbeat sheet; the menu can't present one itself.
    var editHeartbeat: (() -> Void)?
    var failed: (String) -> Void
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }

    var body: some View {
        if model.isChief(threadId) {
            Menu {
                if let editHeartbeat {
                    Button(action: editHeartbeat) { Label("Heartbeat…", systemImage: "waveform.path.ecg") }
                }
                Button { setChief(nil) } label: {
                    Label("Remove as Chief of Staff", systemImage: "person.crop.circle.badge.xmark")
                }
            } label: {
                Label(ChiefOfStaffModel.chiefLabel, systemImage: "person.crop.circle.badge.checkmark")
            }
        } else if model.available, !isChild {
            Button { setChief(threadId) } label: {
                Label("Make Chief of Staff", systemImage: "person.crop.circle.badge.checkmark")
            }
        }
    }

    private func setChief(_ chief: String?) {
        Task {
            do {
                try await model.setChief(chief, client: client)
            } catch {
                failed(BBClient.describe(error, server: client.baseURL))
            }
        }
    }
}
