import SwiftUI

/// Excalidraw drawings on the server, newest first.
struct DrawingsView: View {
    @EnvironmentObject private var app: AppModel
    @State private var drawings: [DrawingSummary] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var deleting: DrawingSummary?
    @State private var creating = false

    var body: some View {
        List {
            if let error {
                Section { ConnectionBanner(message: error) { await load() } }
            }
            ForEach(drawings) { drawing in
                NavigationLink(value: Route.drawing(id: drawing.id)) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(drawing.name).lineLimit(2)
                        HStack(spacing: 4) {
                            if let count = drawing.elementCount {
                                Text(count == 1 ? "1 shape" : "\(count) shapes")
                                Text("·")
                            }
                            Text(Date(timeIntervalSince1970: drawing.updatedAt / 1000), format: .relative(presentation: .named))
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }
                .swipeActions(edge: .trailing) {
                    Button { deleting = drawing } label: { Label("Delete", systemImage: "trash") }
                        .tint(.red)
                }
            }
        }
        .overlay {
            if !loaded {
                ProgressView()
            } else if drawings.isEmpty, error == nil {
                ContentUnavailableView("No drawings", systemImage: "scribble.variable",
                    description: Text("Ask an agent to sketch something, or draw in BB web."))
            }
        }
        .navigationTitle("Drawings")
        .toolbar {
            Button { Task { await create() } } label: { Image(systemName: "plus") }
                .accessibilityLabel("New drawing")
                .disabled(creating)
        }
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog(
            "Delete \u{201C}\(deleting?.name ?? "")\u{201D}?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                guard let drawing = deleting else { return }
                Task { await delete(drawing) }
            }
        } message: {
            Text("This can't be undone.")
        }
    }

    private func load() async {
        do {
            drawings = try await app.client.drawings()
            error = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
        loaded = true
    }

    private func delete(_ drawing: DrawingSummary) async {
        do {
            try await app.client.deleteDrawing(drawing.id)
            drawings.removeAll { $0.id == drawing.id }
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func create() async {
        creating = true
        defer { creating = false }
        do {
            let drawing = try await app.client.createDrawing()
            app.push(.drawing(id: drawing.id))
            await load()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

/// One drawing, rendered natively. Pinch to zoom, drag to pan, double-tap to
/// fit. Follows along while an agent draws.
struct DrawingView: View {
    @EnvironmentObject private var app: AppModel
    let id: String
    @State private var name = ""
    @State private var scene: DrawingScene?
    @State private var updatedAt: Double = 0
    @State private var error: String?
    @State private var zoom: CGFloat = 1
    @State private var pan: CGSize = .zero
    @GestureState private var pinch: CGFloat = 1
    @GestureState private var drag: CGSize = .zero
    @State private var snapshot: Image?
    @State private var renaming = false
    @State private var newName = ""
    @State private var chatting = false
    @State private var editing = false
    @State private var openedEmptyEditor = false

    var body: some View {
        Group {
            if let scene {
                if scene.elements.isEmpty {
                    ContentUnavailableView("Empty drawing", systemImage: "scribble.variable")
                } else {
                    ExcalidrawCanvas(scene: scene)
                        .scaleEffect(zoom * pinch)
                        .offset(x: pan.width + drag.width, y: pan.height + drag.height)
                        .contentShape(.rect)
                        .gesture(
                            MagnifyGesture()
                                .updating($pinch) { value, state, _ in state = value.magnification }
                                .onEnded { zoom = min(max(zoom * $0.magnification, 0.5), 12) }
                                .simultaneously(with: DragGesture()
                                    .updating($drag) { value, state, _ in state = value.translation }
                                    .onEnded { pan.width += $0.translation.width; pan.height += $0.translation.height })
                        )
                        .onTapGesture(count: 2) {
                            withAnimation(.snappy) {
                                zoom = 1
                                pan = .zero
                            }
                        }
                        .clipped()
                }
            } else if let error {
                ContentUnavailableView("Couldn't open the drawing", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .background(Color(white: 0.98).ignoresSafeArea())
        .environment(\.colorScheme, .light)
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button { editing = true } label: { Image(systemName: "pencil.tip.crop.circle") }
                .accessibilityLabel("Edit drawing")
                .disabled(scene == nil)
            if let snapshot {
                ShareLink(item: snapshot, preview: SharePreview(name, image: snapshot))
            }
            Button {
                newName = name
                renaming = true
            } label: { Image(systemName: "pencil") }
            .accessibilityLabel("Rename")
            .disabled(scene == nil)
            if StudioStore.shared.plugins.contains("studio-chat") {
                Button { chatting = true } label: { Image(systemName: "bubble.left.and.text.bubble.right") }
                    .accessibilityLabel("Chat About This")
                    .disabled(scene == nil)
            }
        }
        .studioChat(isPresented: $chatting, pluginId: "excalidraw", itemId: id, title: name, projectId: nil)
        .sheet(isPresented: $editing, onDismiss: { Task { await refresh() } }) {
            NavigationStack {
                WebView(url: app.client.webURL(forDrawing: id))
                    .ignoresSafeArea(edges: .bottom)
                    .navigationTitle("Edit drawing")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { Button("Done") { editing = false } }
            }
        }
        .alert("Rename drawing", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                let newName = newName.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !newName.isEmpty else { return }
                Task {
                    do {
                        try await app.client.renameDrawing(id, name: newName)
                        name = newName
                    } catch {
                        self.error = BBClient.describe(error, server: app.client.baseURL)
                    }
                }
            }
        }
        .task {
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }

    private func refresh() async {
        do {
            if scene != nil, try await app.client.drawingUpdatedAt(id) == updatedAt { return }
            guard let drawing = try await app.client.drawing(id) else {
                error = "It was deleted."
                scene = nil
                return
            }
            name = drawing.name
            updatedAt = drawing.updatedAt
            scene = drawing.scene
            if drawing.scene.elements.isEmpty && !openedEmptyEditor {
                openedEmptyEditor = true
                editing = true
            }
            error = nil
            snapshot = render(drawing.scene)
        } catch where BBClient.isCancellation(error) {
        } catch {
            if scene == nil { self.error = BBClient.describe(error, server: app.client.baseURL) }
        }
    }

    private func render(_ scene: DrawingScene) -> Image? {
        guard let bounds = scene.bounds else { return nil }
        let width = min(max(bounds.maxX - bounds.minX + 80, 200), 2400)
        let height = min(max(bounds.maxY - bounds.minY + 80, 200), 2400)
        let renderer = ImageRenderer(content: ExcalidrawCanvas(scene: scene)
            .frame(width: width, height: height)
            .background(.white)
            .environment(\.colorScheme, .light))
        renderer.scale = 2
        return renderer.uiImage.map { Image(uiImage: $0) }
    }
}

/// Draws an Excalidraw scene fitted to the available space. Covers shapes,
/// lines, arrows, freehand, text and images; hand-drawn roughness is left out.
struct ExcalidrawCanvas: View {
    let scene: DrawingScene

    var body: some View {
        let images = scene.files.compactMapValues { $0.data.flatMap(UIImage.init(data:)) }
        Canvas { context, size in
            guard let bounds = scene.bounds else { return }
            let margin: CGFloat = 24
            let sceneWidth = max(bounds.maxX - bounds.minX, 1), sceneHeight = max(bounds.maxY - bounds.minY, 1)
            let scale = min((size.width - margin * 2) / sceneWidth, (size.height - margin * 2) / sceneHeight, 3)
            context.translateBy(
                x: (size.width - sceneWidth * scale) / 2 - bounds.minX * scale,
                y: (size.height - sceneHeight * scale) / 2 - bounds.minY * scale)
            context.scaleBy(x: scale, y: scale)
            for element in scene.elements {
                draw(element, in: context, images: images)
            }
        }
    }

    private func draw(_ element: DrawingScene.Element, in parent: GraphicsContext, images: [String: UIImage]) {
        var context = parent
        context.opacity = element.opacity / 100
        let rect = CGRect(x: element.x, y: element.y, width: element.width, height: element.height)
        if element.angle != 0 {
            context.translateBy(x: rect.midX, y: rect.midY)
            context.rotate(by: .radians(element.angle))
            context.translateBy(x: -rect.midX, y: -rect.midY)
        }
        let stroke = Self.color(element.strokeColor)
        let style = StrokeStyle(
            lineWidth: element.strokeWidth, lineCap: .round, lineJoin: .round,
            dash: element.strokeStyle == "dashed" ? [8, 8] : element.strokeStyle == "dotted" ? [1.5, 6] : [])

        switch element.type {
        case "rectangle", "ellipse", "diamond", "frame", "magicframe", "embeddable", "iframe":
            let path: Path = switch element.type {
            case "ellipse": Path(ellipseIn: rect)
            case "diamond": Path { path in
                path.move(to: CGPoint(x: rect.midX, y: rect.minY))
                path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
                path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
                path.addLine(to: CGPoint(x: rect.minX, y: rect.midY))
                path.closeSubpath()
            }
            default: element.rounded
                ? Path(roundedRect: rect, cornerRadius: min(min(rect.width, rect.height) * 0.25, 32))
                : Path(rect)
            }
            if let fill = Self.color(element.backgroundColor) {
                context.fill(path, with: .color(element.fillStyle == "solid" ? fill : fill.opacity(0.45)))
            }
            if let stroke { context.stroke(path, with: .color(stroke), style: style) }
            if element.type.hasSuffix("frame"), let name = element.text {
                context.draw(Text(name).font(.system(size: 14)).foregroundStyle(.gray), at: CGPoint(x: rect.minX, y: rect.minY - 6), anchor: .bottomLeading)
            }

        case "line", "arrow":
            let points = element.points.compactMap { $0.count > 1 ? CGPoint(x: element.x + $0[0], y: element.y + $0[1]) : nil }
            guard points.count > 1, let stroke else { return }
            let path = Self.path(through: points, smooth: element.rounded)
            if element.type == "line", points.first == points.last, let fill = Self.color(element.backgroundColor) {
                context.fill(path, with: .color(element.fillStyle == "solid" ? fill : fill.opacity(0.45)))
            }
            context.stroke(path, with: .color(stroke), style: style)
            if let head = element.endArrowhead {
                arrowhead(head, tip: points[points.count - 1], from: points[points.count - 2], width: element.strokeWidth, color: stroke, in: context)
            }
            if let head = element.startArrowhead {
                arrowhead(head, tip: points[0], from: points[1], width: element.strokeWidth, color: stroke, in: context)
            }

        case "freedraw":
            let points = element.points.compactMap { $0.count > 1 ? CGPoint(x: element.x + $0[0], y: element.y + $0[1]) : nil }
            guard let stroke, let first = points.first else { return }
            if points.count == 1 {
                let r = element.strokeWidth * 1.5
                context.fill(Path(ellipseIn: CGRect(x: first.x - r, y: first.y - r, width: r * 2, height: r * 2)), with: .color(stroke))
                return
            }
            context.stroke(Self.path(through: points, smooth: true), with: .color(stroke),
                style: StrokeStyle(lineWidth: element.strokeWidth * 1.6, lineCap: .round, lineJoin: .round))

        case "text":
            guard let text = element.text, !text.isEmpty else { return }
            let lines = text.components(separatedBy: "\n")
            let lineHeight = element.fontSize * element.lineHeight
            let font: Font = switch element.fontFamily {
            case 3, 8: .system(size: element.fontSize, design: .monospaced)
            case 1, 5: .system(size: element.fontSize, design: .rounded)
            default: .system(size: element.fontSize)
            }
            let (anchor, x): (UnitPoint, Double) = switch element.textAlign {
            case "center": (.top, rect.midX)
            case "right": (.topTrailing, rect.maxX)
            default: (.topLeading, rect.minX)
            }
            for (index, line) in lines.enumerated() {
                context.draw(Text(line).font(font).foregroundStyle(stroke ?? .black),
                    at: CGPoint(x: x, y: rect.minY + Double(index) * lineHeight), anchor: anchor)
            }

        case "image":
            if let id = element.fileId, let image = images[id] {
                context.draw(Image(uiImage: image), in: rect)
            } else {
                context.stroke(Path(rect), with: .color(.gray), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            }

        default:
            break
        }
    }

    private func arrowhead(_ kind: String, tip: CGPoint, from: CGPoint, width: Double, color: Color, in context: GraphicsContext) {
        let angle = atan2(tip.y - from.y, tip.x - from.x)
        let length = max(12, width * 5)
        func point(_ offset: Double, _ distance: Double = length) -> CGPoint {
            CGPoint(x: tip.x - distance * cos(angle + offset), y: tip.y - distance * sin(angle + offset))
        }
        switch kind {
        case "triangle", "triangle_outline":
            let path = Path { $0.addLines([tip, point(.pi / 7), point(-.pi / 7)]); $0.closeSubpath() }
            if kind == "triangle" { context.fill(path, with: .color(color)) }
            context.stroke(path, with: .color(color), lineWidth: width)
        case "dot", "circle", "circle_outline":
            let r = max(4, width * 2)
            let path = Path(ellipseIn: CGRect(x: tip.x - r, y: tip.y - r, width: r * 2, height: r * 2))
            if kind == "circle_outline" { context.stroke(path, with: .color(color), lineWidth: width) } else { context.fill(path, with: .color(color)) }
        case "bar":
            let path = Path { $0.addLines([point(.pi / 2, length / 2), point(-.pi / 2, length / 2)]) }
            context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .round))
        default:
            let path = Path { $0.addLines([point(.pi / 7), tip, point(-.pi / 7)]) }
            context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
        }
    }

    /// Straight segments, or a curve through the midpoints when `smooth`.
    private static func path(through points: [CGPoint], smooth: Bool) -> Path {
        Path { path in
            path.move(to: points[0])
            guard smooth, points.count > 2 else {
                points.dropFirst().forEach { path.addLine(to: $0) }
                return
            }
            for index in 1..<points.count - 1 {
                let mid = CGPoint(x: (points[index].x + points[index + 1].x) / 2, y: (points[index].y + points[index + 1].y) / 2)
                path.addQuadCurve(to: index == points.count - 2 ? points[index + 1] : mid, control: points[index])
            }
        }
    }

    /// Nil for `transparent`.
    static func color(_ value: String) -> Color? {
        var hex = value.trimmingCharacters(in: .whitespaces).lowercased()
        guard hex != "transparent", !hex.isEmpty else { return nil }
        guard hex.hasPrefix("#") else {
            return ["black": .black, "white": .white, "red": .red, "green": .green, "blue": .blue][hex] ?? .black
        }
        hex.removeFirst()
        if hex.count == 3 || hex.count == 4 { hex = hex.map { "\($0)\($0)" }.joined() }
        guard let number = UInt64(hex, radix: 16) else { return .black }
        let hasAlpha = hex.count == 8
        let rgb = hasAlpha ? number >> 8 : number
        return Color(
            red: Double((rgb >> 16) & 0xff) / 255, green: Double((rgb >> 8) & 0xff) / 255, blue: Double(rgb & 0xff) / 255,
            opacity: hasAlpha ? Double(number & 0xff) / 255 : 1)
    }
}
