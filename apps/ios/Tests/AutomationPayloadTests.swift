import XCTest
@testable import BBStudio

/// Payloads accepted by stable BB 0.45.0 on the isolated e81d75b baseline.
final class AutomationPayloadTests: XCTestCase {
    private struct Fixture: Decodable {
        let id: String
        let input: JSONValue
        let output: JSONValue
    }

    func testCreateOnceAndRecurringPayloads() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "automation-payloads", withExtension: "json"))
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
        for fixture in fixtures {
            let client = BBClient(baseURL: URL(string: "https://contracts.invalid")!)
            client.transport = { method, path, body in
                XCTAssertEqual(method, "POST")
                XCTAssertEqual(path, "/api/v1/plugins/automations/rpc/automations_create")
                XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(body)), fixture.input)
                return (200, try JSONEncoder().encode(JSONValue.object(["ok": true, "result": fixture.output])))
            }
            let trigger: JSONValue = fixture.id.hasSuffix("once")
                ? Automation.onceTrigger(at: Date(timeIntervalSince1970: 1_893_456_000.1235))
                : ["triggerType": "schedule", "cron": "0 9 * * 1-5", "timezone": "America/New_York"]
            let result = try await client.createAutomation(projectId: "proj_contract", name: "Native automation payload fixture",
                prompt: "Inert payload fixture. Never run.", trigger: trigger,
                execution: ExecutionChoice(providerId: "codex", model: "gpt-6-luna", reasoningLevel: "medium", permissionMode: "auto"), enabled: false)
            XCTAssertEqual(result.id, "auto_contract")
            XCTAssertFalse(result.enabled)
            if fixture.id.hasSuffix("once") { XCTAssertEqual(result.trigger.runAt, 1_893_456_000_123) }
            else { XCTAssertEqual(result.trigger.cron, "0 9 * * 1-5") }
        }
    }
}
