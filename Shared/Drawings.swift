import Foundation

// MARK: Excalidraw plugin

public struct DrawingSummary: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var createdAt: Double
    public var updatedAt: Double
    public var elementCount: Int?
}

/// An Excalidraw scene, parsed from the JSON string the plugin stores.
public struct DrawingScene: Sendable {
    public struct Element: Decodable, Sendable, Identifiable {
        public var id: String
        public var type: String
        public var x: Double
        public var y: Double
        public var width: Double
        public var height: Double
        public var angle: Double
        public var strokeColor: String
        public var backgroundColor: String
        public var fillStyle: String
        public var strokeWidth: Double
        public var strokeStyle: String
        /// 0…100.
        public var opacity: Double
        public var rounded: Bool
        /// Relative to `x`, `y`; lines, arrows and freehand strokes.
        public var points: [[Double]]
        public var text: String?
        public var fontSize: Double
        public var fontFamily: Int
        public var textAlign: String
        public var lineHeight: Double
        public var startArrowhead: String?
        public var endArrowhead: String?
        public var fileId: String?
        public var isDeleted: Bool

        enum CodingKeys: String, CodingKey {
            case id, type, x, y, width, height, angle, strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle
            case opacity, roundness, points, text, fontSize, fontFamily, textAlign, lineHeight
            case startArrowhead, endArrowhead, fileId, isDeleted
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            type = try c.decode(String.self, forKey: .type)
            x = (try? c.decode(Double.self, forKey: .x)) ?? 0
            y = (try? c.decode(Double.self, forKey: .y)) ?? 0
            width = (try? c.decode(Double.self, forKey: .width)) ?? 0
            height = (try? c.decode(Double.self, forKey: .height)) ?? 0
            angle = (try? c.decode(Double.self, forKey: .angle)) ?? 0
            strokeColor = (try? c.decode(String.self, forKey: .strokeColor)) ?? "#1e1e1e"
            backgroundColor = (try? c.decode(String.self, forKey: .backgroundColor)) ?? "transparent"
            fillStyle = (try? c.decode(String.self, forKey: .fillStyle)) ?? "solid"
            strokeWidth = (try? c.decode(Double.self, forKey: .strokeWidth)) ?? 2
            strokeStyle = (try? c.decode(String.self, forKey: .strokeStyle)) ?? "solid"
            opacity = (try? c.decode(Double.self, forKey: .opacity)) ?? 100
            rounded = ((try? c.decode(JSONValue.self, forKey: .roundness)) ?? .null) != .null
            points = (try? c.decode([[Double]].self, forKey: .points)) ?? []
            text = try? c.decode(String.self, forKey: .text)
            fontSize = (try? c.decode(Double.self, forKey: .fontSize)) ?? 20
            fontFamily = (try? c.decode(Int.self, forKey: .fontFamily)) ?? 1
            textAlign = (try? c.decode(String.self, forKey: .textAlign)) ?? "left"
            lineHeight = (try? c.decode(Double.self, forKey: .lineHeight)) ?? 1.25
            startArrowhead = try? c.decode(String.self, forKey: .startArrowhead)
            endArrowhead = try? c.decode(String.self, forKey: .endArrowhead)
            fileId = try? c.decode(String.self, forKey: .fileId)
            isDeleted = (try? c.decode(Bool.self, forKey: .isDeleted)) ?? false
        }

        /// Bounds in scene coordinates, ignoring rotation.
        public var bounds: (minX: Double, minY: Double, maxX: Double, maxY: Double) {
            if points.count > 1 {
                let xs = points.compactMap(\.first), ys = points.compactMap { $0.count > 1 ? $0[1] : nil }
                return (x + (xs.min() ?? 0), y + (ys.min() ?? 0), x + (xs.max() ?? 0), y + (ys.max() ?? 0))
            }
            return (min(x, x + width), min(y, y + height), max(x, x + width), max(y, y + height))
        }
    }

    public struct File: Decodable, Sendable {
        public var dataURL: String?
        public var mimeType: String?

        public var data: Data? {
            guard let dataURL, let comma = dataURL.firstIndex(of: ",") else { return nil }
            return Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...]))
        }
    }

    public var elements: [Element]
    public var files: [String: File]
    public var background: String?

    public init(json: String) {
        struct Raw: Decodable {
            struct AppState: Decodable { var viewBackgroundColor: String? }
            var elements: [Lossy<Element>]?
            var appState: AppState?
            var files: [String: Lossy<File>]?
        }
        let raw = try? JSONDecoder().decode(Raw.self, from: Data(json.utf8))
        elements = (raw?.elements ?? []).compactMap(\.value).filter { !$0.isDeleted }
        files = (raw?.files ?? [:]).compactMapValues(\.value)
        background = raw?.appState?.viewBackgroundColor
    }

    /// Everything drawn, in scene coordinates.
    public var bounds: (minX: Double, minY: Double, maxX: Double, maxY: Double)? {
        guard let first = elements.first?.bounds else { return nil }
        return elements.dropFirst().reduce(first) { box, element in
            let b = element.bounds
            return (min(box.minX, b.minX), min(box.minY, b.minY), max(box.maxX, b.maxX), max(box.maxY, b.maxY))
        }
    }
}

/// Decodes to nil rather than failing the whole array.
private struct Lossy<T: Decodable>: Decodable {
    var value: T?
    init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}

extension BBClient {
    /// Most recently changed first.
    public func drawings() async throws -> [DrawingSummary] {
        struct Result: Decodable { var drawings: [DrawingSummary] }
        let result: Result = try await rpc("excalidraw", "listDrawings")
        return result.drawings
    }

    public func drawing(_ id: String) async throws -> (name: String, updatedAt: Double, scene: DrawingScene)? {
        struct Result: Decodable {
            struct Drawing: Decodable { var name: String; var updatedAt: Double; var data: String }
            var drawing: Drawing?
        }
        let result: Result = try await rpc("excalidraw", "getDrawing", ["id": .string(id)])
        return result.drawing.map { ($0.name, $0.updatedAt, DrawingScene(json: $0.data)) }
    }

    /// Cheap check for whether an agent or the editor changed the drawing.
    public func drawingUpdatedAt(_ id: String) async throws -> Double {
        struct Result: Decodable { var updatedAt: Double }
        let result: Result = try await rpc("excalidraw", "getDrawingUpdatedAt", ["id": .string(id)])
        return result.updatedAt
    }

    public func deleteDrawing(_ id: String) async throws {
        let _: JSONValue = try await rpc("excalidraw", "deleteDrawing", ["id": .string(id)])
    }
}
