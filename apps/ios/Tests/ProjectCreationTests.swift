import XCTest
@testable import BBStudio

/// New threads default to BB's personal project, and New project sends what desktop sends.
final class ProjectCreationTests: XCTestCase {
    private let projects = [Project(id: "proj_a", name: "Alpha"), Project(id: "proj_b", name: "Beta")]

    func testNewThreadDefaultsToPersonalProject() {
        XCTAssertEqual(NewThreadProject.resolve(saved: nil, projects: projects), "proj_personal")
        XCTAssertEqual(NewThreadProject.resolve(saved: "", projects: projects), "proj_personal")
        XCTAssertEqual(NewThreadProject.resolve(saved: "", projects: []), "proj_personal")
        // A removed project falls back to the personal one, not to the first project.
        XCTAssertEqual(NewThreadProject.resolve(saved: "proj_gone", projects: projects), "proj_personal")
        // The remembered choice stays, including "No project".
        XCTAssertEqual(NewThreadProject.resolve(saved: "proj_b", projects: projects), "proj_b")
        XCTAssertEqual(NewThreadProject.resolve(saved: "proj_personal", projects: projects), "proj_personal")
        XCTAssertEqual(NewThreadProject.label("proj_personal", projects: projects), "No project")
        XCTAssertEqual(NewThreadProject.label("proj_a", projects: projects), "Alpha")
    }

    func testPersonalThreadUsesProjectDefaultEnvironment() {
        // BB places a personal thread in a personal workspace on the primary machine.
        XCTAssertEqual(NewThreadWorkspace.projectDefault.request, ["type": "project-default"])
    }

    func testProjectPathRules() {
        XCTAssertEqual(ProjectPath.normalize("  /Users/me/repo// "), "/Users/me/repo")
        XCTAssertEqual(ProjectPath.normalize("c:/Users/me/repo/"), "C:\\Users\\me\\repo")
        XCTAssertNil(ProjectPath.validationMessage("/Users/me/repo"))
        XCTAssertNil(ProjectPath.validationMessage("C:\\Users\\me\\repo"))
        XCTAssertEqual(ProjectPath.validationMessage(""), ProjectPath.invalidMessage)
        XCTAssertEqual(ProjectPath.validationMessage("repo"), ProjectPath.invalidMessage)
        XCTAssertEqual(ProjectPath.validationMessage("~/repo"), ProjectPath.invalidMessage)
        XCTAssertEqual(ProjectPath.validationMessage("/"), ProjectPath.rootMessage)
        XCTAssertEqual(ProjectPath.validationMessage("C:\\"), ProjectPath.rootMessage)
        XCTAssertEqual(ProjectPath.validationMessage("\\\\server\\share"), ProjectPath.networkMessage)
        XCTAssertEqual(ProjectPath.projectName("/Users/me/bb-studio/"), "bb-studio")
        XCTAssertEqual(ProjectPath.projectName("D:\\work\\site"), "site")
        XCTAssertEqual(ProjectPath.projectName("/"), "")
    }

    func testCreateProjectBodyMatchesDesktop() {
        XCTAssertEqual(
            BBClient.createProjectBody(name: "  ", hostId: "host_1", path: "/Users/me/bb-studio/"),
            ["name": "bb-studio", "source": ["type": "local_path", "hostId": "host_1", "path": "/Users/me/bb-studio"]])
        XCTAssertEqual(
            BBClient.createProjectBody(name: " Studio ", hostId: "host_1", path: "/Users/me/bb-studio"),
            ["name": "Studio", "source": ["type": "local_path", "hostId": "host_1", "path": "/Users/me/bb-studio"]])
    }

    func testDefaultMachineIsFirstConnected() throws {
        let hosts: [BBHost] = try JSONDecoder().decode([BBHost].self, from: Data(#"""
            [{"id":"h0","name":"Gone","status":"connected","lifecycle":{"phase":"destroyed"}},
             {"id":"h1","name":"Laptop","status":"disconnected","lifecycle":{"phase":"active"}},
             {"id":"h2","name":"Mini","status":"connected","lifecycle":{"phase":"active"}}]
            """#.utf8))
        XCTAssertEqual(BBHost.defaultHost(hosts)?.id, "h2")
        XCTAssertEqual(BBHost.defaultHost(Array(hosts.prefix(2)))?.id, "h1")
        XCTAssertEqual(hosts.filter(\.isUsable).map(\.id), ["h1", "h2"])
    }

    private actor Requests {
        var all: [(method: String, path: String, body: JSONValue?)] = []
        func append(_ method: String, _ path: String, _ body: JSONValue?) { all.append((method, path, body)) }
    }

    func testCreateProjectAndBrowseRequests() async throws {
        let client = BBClient(baseURL: URL(string: "https://projects.invalid")!)
        let requests = Requests()
        client.transport = { method, path, body in
            await requests.append(method, path, try body.map { try JSONDecoder().decode(JSONValue.self, from: $0) })
            if path.hasPrefix("/api/v1/projects") { return (201, Data(#"{"id":"proj_new","name":"bb-studio"}"#.utf8)) }
            return (200, Data(#"{"directory":"/Users/me/My Code","parent":"/Users/me","entries":[{"kind":"directory","name":"a","path":"/Users/me/My Code/a"},{"kind":"file","name":"b.txt","path":"/Users/me/My Code/b.txt"}]}"#.utf8))
        }
        let project = try await client.createProject(name: "", hostId: "host_1", path: "/Users/me/bb-studio")
        XCTAssertEqual(project, Project(id: "proj_new", name: "bb-studio"))
        let home = try await client.hostDirectory(hostId: "host_1")
        XCTAssertEqual(home.folders.map(\.name), ["a"])
        _ = try await client.hostDirectory(hostId: "host_1", path: "/Users/me/My Code")
        let sent = await requests.all
        XCTAssertEqual(sent.map(\.method), ["POST", "GET", "GET"])
        XCTAssertEqual(sent.map(\.path), [
            "/api/v1/projects", "/api/v1/hosts/host_1/directory", "/api/v1/hosts/host_1/directory?path=/Users/me/My%20Code",
        ])
        XCTAssertEqual(sent[0].body?["source"]?["type"]?.stringValue, "local_path")
    }
}
