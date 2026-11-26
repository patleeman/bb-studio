import SwiftUI

/// A pushed page's one bar (8a): back, its title inline, at most two
/// actions, and its search in the bar's drawer. On the Duo the bar hides
/// (`PushedChrome`): the search is a field at the page's top and the
/// actions are in the rail (`.screenActions`).
struct PageChrome: ViewModifier {
    let title: String
    var query: Binding<String>?
    var prompt = "Search"
    var actions: [ScreenAction] = []

    func body(content: Content) -> some View {
        Group {
            if let query { content.shellSearchable(text: query, prompt: prompt) } else { content }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) { ScreenActionItems(actions: actions).labelStyle(.iconOnly) }
        }
        .screenTitle(title)
        .screenActions(actions)
    }
}

/// Search in the bar's drawer on the iPhone; on the Duo, whose pushed screens
/// have no bar, a field at the top of the page.
struct ShellSearchable: ViewModifier {
    @Binding var text: String
    let prompt: String
    @Environment(\.shellPosture) private var posture

    func body(content: Content) -> some View {
        if posture.usesRail {
            content.safeAreaInset(edge: .top, spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField(prompt, text: $text)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                    if !text.isEmpty {
                        Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                            .buttonStyle(.borderless)
                            .frame(minWidth: 44, minHeight: 44)
                            .accessibilityLabel("Clear search")
                    }
                }
                .padding(.horizontal, 10)
                .frame(minHeight: 38)
                .background(.fill.tertiary, in: .rect(cornerRadius: 10, style: .continuous))
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
                .accessibilityIdentifier("shellSearch")
            }
        } else {
            content.searchable(text: $text, placement: .navigationBarDrawer(displayMode: .automatic), prompt: prompt)
        }
    }
}

extension View {
    func shellSearchable(text: Binding<String>, prompt: String) -> some View {
        modifier(ShellSearchable(text: text, prompt: prompt))
    }
}
