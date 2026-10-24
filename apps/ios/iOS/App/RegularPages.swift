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
                .ignoresSafeArea(.container, edges: .trailing)
                .frame(width: layout.listWidth)
                .clipped()
                .accessibilityHidden(!layout.twoPages)
                .background {
                    if layout.twoPages {
                        RegularSurfaceBackground(name: "sidebar", style: AnyShapeStyle(Color(uiColor: .systemGroupedBackground)))
                    }
                }
            Rectangle().fill(Color(uiColor: .systemGroupedBackground))
                .frame(width: layout.twoPages ? DuoLayout.gutter : 0)
                .overlay { if layout.twoPages { Color(uiColor: .separator).frame(width: 1) } }
                .accessibilityHidden(true)
            detail.frame(maxWidth: .infinity)
                .background {
                    if layout.twoPages { RegularSurfaceBackground(name: "detail", rightPage: true) }
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
                        ContentUnavailableView("Select an item", systemImage: "square.stack")
                    } else { StudioView() }
                }
                    .navigationDestination(for: Route.self) {
                        RouteDestination(route: $0).navigationBarBackButtonHidden(layout.twoPages)
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
                    DuoHeader { Text("Settings").font(.title2.bold()) } actions: { EmptyView() }
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
