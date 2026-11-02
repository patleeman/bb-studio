import Foundation

public struct ReactionSettings: Sendable {
    public var items: [String]
    public var quoteSelection: Bool
    public var quotePosition: String

    public static let defaults = ReactionSettings(
        items: ["👍 Agree", "👎 Disagree", "✅ Do it", "❓ Clarify"],
        quoteSelection: true, quotePosition: "before")

    public static func parseItems(_ raw: String) -> [String] {
        raw.components(separatedBy: CharacterSet(charactersIn: ",;\n"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .prefix(8).map { $0 }
    }

    public func draft(_ reaction: String, selection: String) -> String {
        let trimmed = selection.trimmingCharacters(in: .whitespacesAndNewlines)
        guard quoteSelection, !trimmed.isEmpty else { return reaction }
        let quoted = trimmed.components(separatedBy: "\n").map { "> " + $0 }.joined(separator: "\n")
        return quotePosition == "after" ? reaction + "\n\n" + quoted : quoted + "\n\n" + reaction
    }
}

extension BBClient {
    /// Studio's own settings (every one but the API keys), from its `settings.get`.
    /// Studio before the settings move kept them in BB's plugin settings, so
    /// an older Studio is read there.
    public func studioSettingValues() async throws -> [String: JSONValue] {
        struct Values: Decodable { var values: [String: JSONValue] }
        if let answer: Values = try? await rpc("studio", Studio.Method.settings_get) { return answer.values }
        let response: Values = try await get("/api/v1/plugins/studio/settings")
        return response.values
    }
}

/// Reactions are built into Studio, so their settings are Studio's.
extension BBClient {
    public func reactionSettings() async throws -> ReactionSettings {
        let values = try await studioSettingValues()
        let quoteSelection: Bool
        if case .bool(let enabled)? = values["quoteSelection"] { quoteSelection = enabled }
        else { quoteSelection = true }
        return ReactionSettings(
            items: values["emojiItems"]?.stringValue.map(ReactionSettings.parseItems) ?? ReactionSettings.defaults.items,
            quoteSelection: quoteSelection,
            quotePosition: values["quotePosition"]?.stringValue == "after" ? "after" : "before")
    }
}
