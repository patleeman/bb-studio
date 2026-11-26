import SwiftUI

/// A tab's own line of actions, under the conversation's bar: what the
/// desktop puts in a tab's toolbar. It is part of the content, not a second
/// navigation bar: one line, 44-point targets, a hairline below.
struct WorkbenchTabHeader<Leading: View, Actions: View>: View {
    @ViewBuilder var leading: Leading
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                leading
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .layoutPriority(1)
                Spacer(minLength: 8)
                HStack(spacing: 0) { actions }
                    .labelStyle(.iconOnly)
                    .buttonStyle(WorkbenchHeaderButtonStyle())
                    .fixedSize()
            }
            .padding(.leading, 16)
            .padding(.trailing, 6)
            .frame(minHeight: 44)
            Divider().opacity(0.5)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workbenchTabHeader")
    }
}

/// A 44-point target around an icon.
struct WorkbenchHeaderButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.rect)
            .opacity(configuration.isPressed ? 0.5 : 1)
    }
}
