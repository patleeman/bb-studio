import SwiftUI

extension BBClient {
    /// The conversation's usage-limit or sign-in notice from the model router, nil when there is none.
    public func routerNotice(threadId: String) async throws -> Studio.RouterNoticeGetOutput? {
        try await rpcIfPresent("studio", Studio.Method.router_notice_get, .object(["threadId": .string(threadId)]))
    }

    public func dismissRouterNotice(threadId: String) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.router_notice_dismiss, .object(["threadId": .string(threadId)]))
    }

    /// Hand off without the app: a new thread on the notice's target, continuing this one. Returns the new thread.
    public func routerHandoff(threadId: String) async throws -> String? {
        let output: Studio.RouterHandoffOutput = try await rpc("studio", Studio.Method.router_handoff, .object(["threadId": .string(threadId)]))
        return output.threadId
    }
}

/// The model router's notice above the composer (desktop's `RouterNoticeBanner`):
/// the provider hit its usage limit (or needs signing in), with Hand off to the
/// router's next model and ✕. Polled while the conversation is open; a Studio
/// without the router answers "unknown method" and the line never shows.
@MainActor @Observable
final class RouterNotices {
    static let shared = RouterNotices()
    var notices: [String: Studio.RouterNoticeGetOutput] = [:]
    private var client: BBClient { AppModel.shared.client }

    /// Polls one conversation's notice while its screen shows (every 2 min, longer while idle); a Studio without the router stops it.
    func poll(_ threadId: String) async {
        while !Task.isCancelled {
            do {
                let next = try await client.routerNotice(threadId: threadId)
                if notices[threadId] != next { notices[threadId] = next }
            } catch where BBClient.isUnknownRPC(error) {
                notices[threadId] = nil
                return
            } catch {}
            await EnergyGate.shared.pollWait(.seconds(120))
        }
    }
}

struct RouterNoticeBanner: View {
    let threadId: String
    var openThread: (String) -> Void
    @EnvironmentObject private var app: AppModel
    @State private var store = RouterNotices.shared
    @State private var working = false
    @Environment(\.look) private var look

    private var notice: Studio.RouterNoticeGetOutput? { store.notices[threadId] }

    var body: some View {
        Group {
            if let notice, let text = notice.text, !text.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: notice.kind == .sign_in ? "person.crop.circle.badge.exclamationmark" : "gauge.with.dots.needle.100percent")
                            .foregroundStyle(look.needsYou)
                        Text(text).font(.footnote).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        Button { dismiss() } label: { Image(systemName: "xmark").font(.caption.weight(.semibold)) }
                            .buttonStyle(.plain)
                            .frame(minWidth: 32, minHeight: 32)
                            .accessibilityLabel("Dismiss")
                            .accessibilityIdentifier("routerNoticeDismiss")
                    }
                    if notice.target != nil {
                        Button(notice.targetName.map { "Hand off to \($0)" } ?? "Hand off") { handOff() }
                            .font(.footnote.weight(.semibold))
                            .buttonStyle(.bordered)
                            .disabled(working)
                            .padding(.leading, 24)
                            .accessibilityIdentifier("routerHandOff")
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(look.stackFill, in: .rect(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(look.needsYou.opacity(0.5), lineWidth: 0.5))
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("routerNotice")
            }
        }
    }

    private func dismiss() {
        let previous = notice
        store.notices[threadId] = nil
        Task {
            do { try await app.client.dismissRouterNotice(threadId: threadId) } catch { store.notices[threadId] = previous }
        }
    }

    private func handOff() {
        working = true
        Task {
            do {
                if let next = try await app.client.routerHandoff(threadId: threadId) {
                    store.notices[threadId] = nil
                    openThread(next)
                }
            } catch {
                app.flash("It didn't hand off: " + BBClient.describe(error, server: app.client.baseURL))
            }
            working = false
        }
    }
}
