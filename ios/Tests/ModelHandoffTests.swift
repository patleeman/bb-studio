import XCTest
@testable import BBStudio

final class ModelHandoffTests: XCTestCase {
    private func provider(_ json: String) throws -> ExecutionOptions.Provider {
        try JSONDecoder().decode(ExecutionOptions.Provider.self, from: Data(json.utf8))
    }

    func testOnlyAnotherProviderHandsOff() {
        XCTAssertTrue(ModelHandoffPlan.isHandoff(current: "claude-code", chosen: "codex"))
        XCTAssertFalse(ModelHandoffPlan.isHandoff(current: "claude-code", chosen: "claude-code"))
        XCTAssertFalse(ModelHandoffPlan.isHandoff(current: "claude-code", chosen: ""))
        XCTAssertFalse(ModelHandoffPlan.isHandoff(current: nil, chosen: "codex"))
    }

    func testLabels() {
        XCTAssertEqual(ModelHandoffPlan.progressLabel(providerName: "Codex"), "Handing off to Codex…")
        XCTAssertEqual(ModelHandoffPlan.doneLabel(.inPlace, modelName: "Sonnet"), "Switched to Sonnet")
        XCTAssertNil(ModelHandoffPlan.doneLabel(.unchanged, modelName: "Opus"))
        XCTAssertEqual(ModelHandoffPlan.saveTitle(handoff: true), "Hand off")
        XCTAssertEqual(ModelHandoffPlan.saveTitle(handoff: false), "Save")
    }

    func testPermissionModesAreTheProvidersUpToTheCeiling() throws {
        let codex = try provider(#"{"id":"codex","displayName":"Codex","capabilities":{"permissionModes":["auto","full"]}}"#)
        XCTAssertEqual(ModelHandoffPlan.permissionModes(codex, ceiling: nil), ["auto", "full"])
        XCTAssertEqual(ModelHandoffPlan.permissionModes(codex, ceiling: "auto"), ["auto"])
        XCTAssertEqual(ModelHandoffPlan.permissionModes(try provider(#"{"id":"pi","displayName":"Pi"}"#), ceiling: nil), [])
    }

    func testProvidersKeepTheThreadsOwnEvenIfUnavailable() throws {
        let all = [
            try provider(#"{"id":"claude-code","displayName":"Claude Code","available":false}"#),
            try provider(#"{"id":"codex","displayName":"Codex","available":true}"#),
            try provider(#"{"id":"pi","displayName":"Pi","available":false}"#),
        ]
        XCTAssertEqual(ModelHandoffPlan.providers(all, current: "claude-code").map(\.id), ["claude-code", "codex"])
    }

    func testHandoffSendsTheChoiceAndReadsTheNewThread() async throws {
        let client = BBClient(baseURL: URL(string: "https://handoff.invalid")!)
        let sent = Box()
        client.transport = { _, path, body in
            sent.value = path + " " + String(decoding: body ?? Data(), as: UTF8.self)
            return (200, Data(#"{"ok":true,"result":{"change":"handoff","threadId":"thr_new"}}"#.utf8))
        }
        let result = try await client.handoffToModel("thr_old", providerId: "codex", model: "gpt-5", reasoning: nil)
        XCTAssertEqual(result.change, .handoff)
        XCTAssertEqual(result.threadId, "thr_new")
        XCTAssertTrue(sent.value.contains("thread_handoff_to_model"))
        XCTAssertTrue(sent.value.contains(#""threadId":"thr_old""#))
        XCTAssertTrue(sent.value.contains(#""providerId":"codex""#))
        XCTAssertFalse(sent.value.contains("reasoning"))
    }
}

private final class Box: @unchecked Sendable { var value = "" }
