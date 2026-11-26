import SwiftUI

/// A pushed page's one bar (8a): back, its title inline, at most two
/// actions, and its search in the bar's drawer when it has one.
struct PageChrome<Actions: View>: ViewModifier {
    let title: String
    var query: Binding<String>?
    var prompt = "Search"
    @ViewBuilder var actions: () -> Actions

    func body(content: Content) -> some View {
        if let query {
            bar(content.searchable(text: query, prompt: prompt))
        } else {
            bar(content)
        }
    }

    private func bar(_ content: some View) -> some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItemGroup(placement: .primaryAction) { actions() } }
    }
}
