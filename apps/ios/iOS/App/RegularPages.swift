import SwiftUI

/// One regular-width hierarchy for iPad and unfolded phone windows. The detail
/// remains mounted across compact/regular changes, retaining its live models.
struct RegularPages<Sidebar: View, Detail: View>: View {
    @Environment(\.duoLayout) private var layout
    @ViewBuilder var sidebar: Sidebar
    @ViewBuilder var detail: Detail

    var body: some View {
        HStack(spacing: 0) {
            sidebar
                .modifier(SidebarColumn())
                .accessibilityHidden(!layout.showsList)
                .background {
                    if layout.twoPages {
                        RegularSurfaceBackground(name: "sidebar", style: AnyShapeStyle(Color(uiColor: .systemGroupedBackground)))
                    }
                }
            CreaseGutter()
            detail.frame(maxWidth: .infinity)
                .overlay(alignment: .leading) { DuoPaneEdge() }
                .background {
                    if layout.twoPages { RegularSurfaceBackground(name: "detail", rightPage: true) }
                }
        }
    }
}

/// The detail with nothing selected. With the list hidden, it offers it back.
struct DuoEmptyDetail: View {
    @Environment(\.duoLayout) private var layout
    @Environment(DuoPaneState.self) private var pane: DuoPaneState?
    let title: String
    let systemImage: String

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } actions: {
            if !layout.showsList, let pane {
                Button("Show list") { pane.toggle() }
            }
        }
    }
}

struct StudioTab: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.duoLayout) private var layout

    var body: some View {
        RegularPages {
            if layout.twoPages {
                NavigationStack { StudioView(selectsDetail: true) }
            }
        } detail: {
            NavigationStack(path: $app.studioPath) {
                Group {
                    if layout.twoPages {
                        DuoEmptyDetail(title: "Select an item", systemImage: "square.stack")
                    } else { StudioView() }
                }
                    .navigationDestination(for: Route.self) {
                        RouteDestination(route: $0).navigationBarBackButtonHidden(layout.twoPages)
                            // Studio's items keep their own bars: the toggle leads them.
                            .toolbar {
                                if layout.twoPages {
                                    ToolbarItem(placement: .topBarLeading) { DuoPaneToggle() }
                                }
                            }
                    }
            }
        }
    }
}

struct SettingsTab: View {
    @Environment(\.duoLayout) private var layout
    @State private var section = "Server"
    private let sections = ["Server", "Plugins", "Archived threads", "Voice"]

    var body: some View {
        RegularPages {
            if layout.twoPages {
                List(sections, id: \.self) { title in
                    Button { section = title } label: {
                        Text(title).frame(maxWidth: .infinity, alignment: .leading).contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .modifier(SidebarRowContent(enabled: true))
                    .listRowBackground(SidebarSelectionBackground(selected: section == title))
                    .accessibilityAddTraits(section == title ? .isSelected : [])
                }
                .listStyle(.sidebar)
                .modifier(SidebarListMargins(enabled: true))
                .safeAreaInset(edge: .top, spacing: 0) {
                    DuoHeader(sidebar: true) { Text("Settings").font(.title2.bold()) } actions: { EmptyView() }
                        .ignoresSafeArea(.container, edges: .trailing)
                }
            }
        } detail: {
            NavigationStack {
                Group {
                    if !layout.twoPages || section == "Server" { SettingsView() }
                    else if section == "Plugins" { PluginStatusView() }
                    else if section == "Archived threads" { ArchivedView() }
                    else { SpeechSettingsView() }
                }
                .modifier(RegularScrollingSurface())
                // Its grouped background runs under the status column, but the
                // cards, toggles and steppers keep the same 20-point margin
                // from the safe edge that they have on the leading side. The
                // surface already keeps them clear of the Duo's status column.
                .contentMargins(.trailing, layout.twoPages ? layout.sidebarWindowInset - layout.statusColumn + 20 : 0, for: .scrollContent)
                .toolbar(layout.twoPages ? .hidden : .automatic, for: .navigationBar)
                .safeAreaInset(edge: .top, spacing: 0) {
                    if layout.twoPages {
                        DuoHeader { Text(section).font(.headline) } actions: { EmptyView() }
                    }
                }
            }
        }
    }
}
