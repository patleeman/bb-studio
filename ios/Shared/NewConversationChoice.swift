import Foundation

/// The model a new conversation starts on, as the desktop's composer picks
/// it: a Bot's conversation starts on the Bot's default model (which may be
/// Auto, the model router), else on the project's defaults; whatever the user
/// picks in the composer wins.
public enum NewConversationChoice {
    /// BB's provider id for Auto, the model router's picker entry (`EXPERIMENTAL_AUTO_PROVIDER_ID`).
    public static let auto = "auto"

    /// What the pickers show as Default: the Bot's model over the project's
    /// defaults (the project still gives the permission mode when the Bot names none).
    public static func defaults(bot: ExecutionChoice?, project: ExecutionChoice?) -> ExecutionChoice? {
        guard var bot, let provider = bot.providerId, !provider.isEmpty else { return project }
        if bot.permissionMode == nil { bot.permissionMode = project?.permissionMode }
        return bot
    }

    /// A Bot's conversation names its model (`bot_conversation_start` needs a
    /// provider): each pick, else the default, else what the picker shows
    /// first (Auto, when the router makes it the default). Auto's one model is Auto.
    public static func resolve(provider: String, model: String, reasoning: String, permission: String,
                               defaults: ExecutionChoice?, shownProvider: String?, shownModel: String?) -> ExecutionChoice {
        let providerId = provider.isEmpty ? (defaults?.providerId ?? shownProvider) : provider
        let followsDefault = provider.isEmpty || provider == defaults?.providerId
        var modelId = model.isEmpty ? ((followsDefault ? defaults?.model : nil) ?? shownModel) : model
        var reasoningLevel = reasoning.isEmpty ? (followsDefault ? defaults?.reasoningLevel : nil) : reasoning
        if providerId == auto {
            modelId = auto
            reasoningLevel = nil
        }
        return ExecutionChoice(providerId: providerId, model: modelId, reasoningLevel: reasoningLevel,
                               permissionMode: permission.isEmpty ? defaults?.permissionMode : permission)
    }
}
