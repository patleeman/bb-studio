import Foundation

extension BBClient {
    /// The backend dispatches the office Home shape when spaceId is supplied.
    public func officeHome(_ spaceId: String) async throws -> OfficeHome {
        try await rpc("studio", Studio.Method.home, ["spaceId": .string(spaceId)])
    }

    public func officeSpaces() async throws -> [OfficeSpace] {
        struct Result: Decodable { var spaces: [OfficeSpace] }
        let result: Result = try await rpc("studio", Studio.Method.spaces_list, [:])
        return result.spaces
    }

    public func officeCreateSpace(name: String, icon: String? = nil, description: String = "") async throws -> OfficeSpace {
        struct Result: Decodable { var space: OfficeSpace }
        let result: Result = try await rpc("studio", Studio.Method.space_create, .object(omittingNil: [
            "name": .string(name), "icon": icon.map(JSONValue.string), "description": .string(description),
        ]))
        return result.space
    }

    /// nil icon explicitly clears the icon; other fields are supplied in full.
    public func officeUpdateSpace(_ spaceId: String, name: String, icon: String?, description: String) async throws -> OfficeSpace {
        struct Result: Decodable { var space: OfficeSpace }
        let result: Result = try await rpc("studio", Studio.Method.space_update, [
            "spaceId": .string(spaceId), "name": .string(name), "icon": icon.map(JSONValue.string) ?? .null,
            "description": .string(description),
        ])
        return result.space
    }

    public func officeDeleteSpace(_ spaceId: String) async throws {
        let result: OfficeAcknowledgement = try await rpc("studio", Studio.Method.space_delete, ["spaceId": .string(spaceId)])
        try result.requireSuccess()
    }

    public func officeMoveProject(_ projectId: String, to spaceId: String) async throws -> OfficeSpace {
        struct Result: Decodable { var space: OfficeSpace }
        let result: Result = try await rpc("studio", Studio.Method.space_move_project, ["projectId": .string(projectId), "spaceId": .string(spaceId)])
        return result.space
    }

    public func officeSpaceSettings(_ spaceId: String) async throws -> OfficeSpaceSettings {
        struct Result: Decodable { var settings: OfficeSpaceSettings }
        let result: Result = try await rpc("studio", Studio.Method.space_settings_get, ["spaceId": .string(spaceId)])
        return result.settings
    }

    /// Saves a complete settings value, including explicit nulls to clear defaults.
    public func officeSetSpaceSettings(_ spaceId: String, settings: OfficeSpaceSettings) async throws -> OfficeSpaceSettings {
        struct Result: Decodable { var settings: OfficeSpaceSettings }
        let model: JSONValue = settings.defaultBotModel.map { ["providerId": .string($0.providerId), "model": .string($0.model)] } ?? .null
        let result: Result = try await rpc("studio", Studio.Method.space_settings_set, [
            "spaceId": .string(spaceId), "settings": [
                "enabledItemKinds": settings.enabledItemKinds.map { .array($0.map(JSONValue.string)) } ?? .null,
                "defaultTrust": .string(settings.defaultTrust.rawValue), "defaultBotModel": model,
            ],
        ])
        return result.settings
    }

    public func officeCreateFolder(spaceId: String, name: String) async throws -> OfficeFolder {
        struct Result: Decodable { var folder: OfficeFolder }
        let result: Result = try await rpc("studio", Studio.Method.folder_create, ["spaceId": .string(spaceId), "name": .string(name)])
        return result.folder
    }

    public func officeArchiveFolder(_ folderId: String) async throws {
        let result: OfficeAcknowledgement = try await rpc("studio", Studio.Method.folder_archive, ["folderId": .string(folderId)])
        try result.requireSuccess()
    }

    public func officeSpaceTree(_ spaceId: String) async throws -> OfficeSpaceTree {
        try await rpc("studio", Studio.Method.space_tree, ["spaceId": .string(spaceId)])
    }
}

private struct OfficeAcknowledgement: Decodable {
    var ok: Bool
    func requireSuccess() throws {
        guard ok else { throw BBError(status: 0, message: "The office action was not completed.") }
    }
}
