import Foundation

// Shapes mirror BB's public API (`/api/v1`) and the Bot Teams and Talk plugin
// RPC contracts. Only the fields the app reads are decoded.

public struct ThreadEntry: Codable, Identifiable, Hashable, Sendable {
    public struct Runtime: Codable, Hashable, Sendable {
        public var displayStatus: String?
    }

    public var id: String
    public var projectId: String
    public var providerId: String?
    public var title: String?
    public var titleFallback: String?
    public var status: String
    public var parentThreadId: String?
    public var visibility: String?
    public var archivedAt: Double?
    public var pinnedAt: Double?
    public var lastReadAt: Double?
    public var latestAttentionAt: Double?
    public var createdAt: Double
    public var updatedAt: Double
    public var hasPendingInteraction: Bool?
    public var queuedWork: String?
    public var sectionId: String?
    public var pinSortKey: String?
    public var environmentBranchName: String?
    public var environmentPath: String?
    public var environmentId: String?
    public var queuedMessageCount: Int?
    public var runtime: Runtime?

    public var displayTitle: String {
        if let title, !title.isEmpty { return title }
        if let titleFallback, !titleFallback.isEmpty { return titleFallback }
        return "Thread \(id.prefix(8))"
    }

    public var isUnread: Bool {
        guard let latestAttentionAt else { return false }
        return (lastReadAt ?? 0) < latestAttentionAt
    }

    public var isRunning: Bool {
        // Pending with nothing set up and a message queued: it's waiting on a scheduled first send.
        if status == "pending", environmentId == nil, (queuedMessageCount ?? 0) > 0 { return false }
        return ["pending", "starting", "active", "stopping"].contains(status)
    }
    public var needsAttention: Bool { hasPendingInteraction == true || status == "error" }

    public var projectName: String? {
        environmentPath.map { URL(fileURLWithPath: $0).lastPathComponent }
    }
}

public struct TimelineRow: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var kind: String
    public var role: String?
    public var text: String?
    public var title: String?
    public var detail: String?
    public var systemKind: String?
    public var workKind: String?
    public var command: String?
    public var status: String?
    public var createdAt: Double?
    public var startedAt: Double?
    public var toolName: String?
    public var path: String?
    public var output: String?
    public var attachments: Attachments?
    public var presentation: Presentation?
    public var change: FileChange?
    /// The last event of the turn this row came from.
    public var sourceSeqEnd: Double?

    /// An edited file: `diff` is unified-diff hunks, sometimes with `---`/`+++` headers.
    public struct FileChange: Codable, Hashable, Sendable {
        public struct Stats: Codable, Hashable, Sendable {
            public var added: Int
            public var removed: Int
        }

        public var path: String?
        /// `add`, `update`, `delete` or `move`.
        public var kind: String?
        public var movePath: String?
        public var diff: String?
        public var diffStats: Stats?
    }

    public struct Attachments: Codable, Hashable, Sendable {
        public var imageUrls: [String]?
        public var localImagePaths: [String]?
        public var localFilePaths: [String]?
    }

    public struct Presentation: Codable, Hashable, Sendable {
        public struct Label: Codable, Hashable, Sendable {
            public var pending: String?
            public var completed: String?
        }

        public var label: Label?
        public var title: String?
    }

    public var isConversation: Bool { kind == "conversation" }
    public var hasAttachments: Bool {
        guard let attachments else { return false }
        return !(attachments.imageUrls ?? []).isEmpty || !(attachments.localImagePaths ?? []).isEmpty
            || !(attachments.localFilePaths ?? []).isEmpty
    }
    public var isUser: Bool { role == "user" }
}

public struct TimelineCursor: Codable, Hashable, Sendable {
    public var anchorSeq: Int
    public var anchorId: String
}

public struct TimelinePage: Codable, Sendable {
    public struct PageInfo: Codable, Sendable {
        public var hasOlderRows: Bool?
        public var olderCursor: TimelineCursor?
    }

    /// Only the rows that changed since `afterSequence`, when the server still has that snapshot.
    public struct Delta: Codable, Sendable {
        public var upsertRows: [TimelineRow]
        public var rowOrder: [String]?
    }

    public var rows: [TimelineRow]
    public var maxSeq: Int?
    public var timelinePage: PageInfo?
    public var delta: Delta?
    public var activeThinking: Thinking?
    public var pendingTodos: Todos?
    public var goal: Goal?
    public var activePromptMode: PromptMode?
    public var activeBackgroundCommands: [BackgroundWork]?
    public var activeWorkflows: [BackgroundWork]?
    public var modelFallback: ModelFallback?
    public var contextWindowUsage: ContextUsage?
}

// The thread state BB shows in the shelf above the composer. Timeline top-level fields.

public struct Thinking: Codable, Hashable, Sendable {
    public var text: String?
}

public struct Todos: Codable, Hashable, Sendable {
    public struct Item: Codable, Hashable, Identifiable, Sendable {
        public var id: String
        public var text: String
        /// `pending`, `in_progress` or `completed`.
        public var status: String
    }

    public var items: [Item]
}

public struct Goal: Codable, Hashable, Sendable {
    public var objective: String
    /// `active`, `paused`, `budgetLimited` or `complete`.
    public var status: String
    public var tokenBudget: Double?
    public var tokensUsed: Double?
}

public struct PromptMode: Codable, Hashable, Sendable {
    public var mode: String
    public var prompt: String?
}

/// A background command, background agent or workflow still running after its turn.
public struct BackgroundWork: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var taskType: String?
    public var workflowName: String?
    public var description: String?
    public var status: String?
}

public struct ModelFallback: Codable, Hashable, Sendable {
    public var sourceSeq: Double?
    public var originalModel: String
    public var fallbackModel: String
    public var message: String?
}

public struct ContextUsage: Codable, Hashable, Sendable {
    public var usedTokens: Double
    public var modelContextWindow: Double?
    public var estimated: Bool?
}

/// A message waiting behind the running turn (`GET /threads/:id/queued-messages`).
public struct QueuedMessage: Decodable, Identifiable, Hashable, Sendable {
    public struct Input: Decodable, Hashable, Sendable {
        public var type: String
        public var text: String?
    }

    /// What the message is waiting for: `thread-busy`, `time`, `host-offline`, …
    public struct WaitingOn: Decodable, Hashable, Sendable {
        public var kind: String
        public var hostName: String?
        public var pluginId: String?
        /// Why a plugin is holding it, e.g. Smart Queue's follow-up decision.
        public var reason: String?
    }

    /// `inline` for a message the user wrote; `retry` for an automatic retry.
    public struct Payload: Decodable, Hashable, Sendable {
        public var kind: String
        public var attempt: Int?
        public var reason: String?
    }

    public var id: String
    public var threadId: String?
    public var content: [Input]
    public var sendAt: Double?
    public var editable: Bool?
    public var waitingOn: WaitingOn?
    public var payload: Payload?
    public var initiator: String?
    public var createdAt: Double?

    public var isRetry: Bool { payload?.kind == "retry" }
    /// Held by the drafts plugin until you send it yourself.
    public var isDraft: Bool { waitingOn?.kind == "plugin" && waitingOn?.pluginId == "drafts" }

    /// Why it hasn't gone yet, in a few words.
    public var status: String {
        let due = sendAt.map { Date(timeIntervalSince1970: $0 / 1000) }
        let when = due.map { $0 < .now ? "overdue since \(Self.time($0).replacingOccurrences(of: "at ", with: ""))" : Self.time($0) }
        if isRetry {
            let reason = payload?.reason ?? "Retry"
            return when.map { "\(reason) · retries \($0)" } ?? reason
        }
        switch waitingOn?.kind {
        case "time": return when.map { "Sends \($0)" } ?? "Scheduled"
        case "plugin" where isDraft: return "Draft · send it when you're ready"
        case "plugin" where waitingOn?.reason?.isEmpty == false: return waitingOn!.reason!
        case "host-offline": return "Waiting for \(waitingOn?.hostName ?? "the host") to come online"
        case "thread-busy", nil: return "Queued"
        case let kind?: return "Waiting · \(kind.replacingOccurrences(of: "-", with: " "))"
        }
    }

    private static func time(_ date: Date) -> String {
        Calendar.current.isDateInToday(date)
            ? "at " + date.formatted(date: .omitted, time: .shortened)
            : date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())
    }

    public var text: String {
        content.compactMap { $0.type == "text" ? $0.text : nil }.joined(separator: "\n")
    }

    public var attachmentCount: Int { content.filter { $0.type != "text" }.count }
}

public struct SendResult: Decodable, Sendable {
    public var ok: Bool
    public var delivery: String?
}

public struct ThreadSearchResults: Decodable, Sendable {
    public struct Match: Decodable, Hashable, Sendable {
        public var sourceKind: String
        public var text: String
    }

    public struct Hit: Decodable, Identifiable, Hashable, Sendable {
        public var thread: ThreadEntry
        public var matches: [Match]
        public var id: String { thread.id }

        /// The first message match, for a snippet under the title.
        public var snippet: String? {
            matches.first { $0.sourceKind.hasSuffix("_message") }?.text
        }
    }

    public struct Group: Decodable, Sendable {
        public var total: Int
        public var results: [Hit]
    }

    public var active: Group
    public var archived: Group
}

/// What a new thread runs on. Every field is optional: nil means the project default.
public struct ExecutionChoice: Codable, Hashable, Sendable {
    public var providerId: String?
    public var model: String?
    public var reasoningLevel: String?
    public var permissionMode: String?

    public init(providerId: String? = nil, model: String? = nil, reasoningLevel: String? = nil, permissionMode: String? = nil) {
        self.providerId = providerId
        self.model = model
        self.reasoningLevel = reasoningLevel
        self.permissionMode = permissionMode
    }
}

public struct ExecutionOptions: Decodable, Sendable {
    public struct Provider: Decodable, Identifiable, Hashable, Sendable {
        public struct Capabilities: Decodable, Hashable, Sendable {
            public var permissionModes: [String]?
        }

        public var id: String
        public var displayName: String
        public var available: Bool?
        public var capabilities: Capabilities?
    }

    public struct Model: Decodable, Identifiable, Hashable, Sendable {
        public struct Effort: Decodable, Hashable, Sendable {
            public var reasoningEffort: String
        }

        public var id: String
        public var model: String
        public var displayName: String
        public var supportedReasoningEfforts: [Effort]?
        public var defaultReasoningEffort: String?
        public var isDefault: Bool?
    }

    public var providers: [Provider]
    public var models: [Model]
    /// The most any thread may get, set per machine.
    public var permissionCeiling: String?
}

/// How much an agent may do without asking: accept-edits, auto or full.
public enum PermissionMode {
    public static let all = ["accept-edits", "auto", "full"]

    public static func label(_ mode: String) -> String {
        switch mode {
        case "accept-edits": "Accept edits"
        case "auto": "Auto"
        case "full": "Full access"
        default: mode
        }
    }

    /// The provider's modes, up to the ceiling.
    public static func allowed(_ modes: [String], ceiling: String?) -> [String] {
        guard let ceiling, let top = all.firstIndex(of: ceiling) else { return modes }
        return modes.filter { (all.firstIndex(of: $0) ?? 0) <= top }
    }

    /// A mode picked for a thread on this phone, sent with its next message:
    /// BB takes permissions per message, and the thread keeps the last one.
    public static func pending(_ threadId: String, serverURL: URL = ServerScope.selectedURL) -> String? {
        AppGroup.defaults.string(forKey: ServerScope.key("permissionMode.\(threadId)", serverURL: serverURL))
    }

    public static func setPending(_ mode: String?, for threadId: String, serverURL: URL = ServerScope.selectedURL) {
        AppGroup.defaults.set(mode, forKey: ServerScope.key("permissionMode.\(threadId)", serverURL: serverURL))
    }
}

public struct Project: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
}

/// `GET /api/v1/sidebar-bootstrap`: what the web sidebar lists, grouped by project.
public struct SidebarBootstrap: Codable, Sendable {
    public struct Section: Codable, Hashable, Identifiable, Sendable {
        public var id: String
        public var name: String
    }

    public struct ProjectThreads: Codable, Hashable, Identifiable, Sendable {
        public var id: String
        public var name: String
        public var threads: [ThreadEntry]
    }

    public var sections: [Section]
    public var projects: [ProjectThreads]
    public var personalProject: ProjectThreads
}

/// The web sidebar's layout choices (thread-list plugin `listPreferences`).
public struct SidebarPreferences: Codable, Hashable, Sendable {
    /// `chronological`, `project` or `machine`.
    public var organizationMode: String?
    /// `pinned`, `project:<id>` and `threads`, in the user's order.
    public var sectionOrder: [String]?
    public var collapsedProjects: [String]?

    public init(organizationMode: String? = nil, sectionOrder: [String]? = nil, collapsedProjects: [String]? = nil) {
        self.organizationMode = organizationMode
        self.sectionOrder = sectionOrder
        self.collapsedProjects = collapsedProjects
    }
}

// MARK: Bot Teams

public struct Bot: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var avatar: String?
    public var description: String?
    public var retired: Bool?
    public var handle: String?
    /// The bot's own selection, applied to a new thread that takes its profile.
    public var providerId: String?
    public var model: String?
    public var reasoningLevel: String?
    public var permissionMode: String?
}

/// A thread that works as a bot: an ordinary thread with the bot's profile
/// attached. Listed on the bot's page.
public struct ProfileThread: Codable, Identifiable, Hashable, Sendable {
    public var threadId: String
    public var title: String
    public var archived: Bool
    public var updatedAt: Double

    public var id: String { threadId }
}

/// A bot's latest thread with its profile, which the Watch messages.
public struct DirectThread: Codable, Hashable, Sendable {
    public var threadId: String
    public var indicator: String?
    public var status: String?
}

/// A bot's MISSION.md or MEMORY.md. `version` is a hash of the text.
public struct BotDocument: Codable, Sendable, Hashable {
    public var text: String
    public var version: String

    public static let files = ["MISSION.md", "MEMORY.md"]
}

public struct BotTeamsList: Codable, Sendable {
    public var bots: [Bot]
    public var views: [SavedThreadView]
    /// Each bot's latest thread with its profile.
    public var directThreads: [String: DirectThread]
}

// MARK: Talk

public struct Recording: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var kind: String
    public var status: String
    public var threadId: String?
    public var createdAt: Double
    public var durationMs: Double
    public var segmentCount: Int
    public var pendingCount: Int
    public var failedCount: Int
    public var preview: String
    public var projectId: String?
    public var updatedAt: Double?
    public var wordCount: Int?
    /// A dictation whose audio expired; only the transcript is left.
    public var audioRemoved: Bool?
}

public struct Segment: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var sessionId: String
    public var status: String
    public var text: String?
    /// Where the segment starts in recorded time: every earlier segment's duration added up.
    public var offsetMs: Double?
    public var durationMs: Double?
    public var mimeType: String?
    public var error: String?
}

public struct RecordingDetail: Decodable, Sendable {
    public var recording: Recording
    public var segments: [Segment]

    /// Same joining rule as Talk's `joinTranscript`: sessions become paragraphs.
    public var transcript: String {
        var out = ""
        var session: String?
        for segment in segments {
            guard let text = segment.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { continue }
            if out.isEmpty { out = text } else { out += (segment.sessionId == session ? " " : "\n\n") + text }
            session = segment.sessionId
        }
        return out
    }
}

public struct SavedViewMember: Codable, Hashable, Sendable {
    public var kind: String
    public var id: String
    public init(kind: String, id: String) { self.kind = kind; self.id = id }
}

public struct SavedThreadView: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var members: [SavedViewMember]
    public var archived: Bool
    public var createdAt: Double
    public var updatedAt: Double
}

public struct SavedViewThread: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var botId: String?
    public var parentThreadId: String?
    public var status: String
    public var updatedAt: Double
    public var error: String?
}

public struct SavedViewEntry: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var threadId: String
    public var role: String
    public var text: String
    public var createdAt: Double
    public var groupId: String?
}

public struct SavedViewPage: Decodable, Sendable {
    public var view: SavedThreadView
    public var threads: [SavedViewThread]
    public var entries: [SavedViewEntry]
    public var hasOlder: Bool
}

public struct SavedViewSend: Decodable, Sendable {
    public struct Delivery: Decodable, Sendable {
        public var threadId: String
        public var status: String
        public var error: String?
    }
    public var requestId: String
    public var deliveries: [Delivery]
}
