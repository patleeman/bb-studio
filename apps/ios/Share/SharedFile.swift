import UIKit
import UniformTypeIdentifiers
import ImageIO

struct SharedContent {
    var text: String
    var files: [SharedFile]
    var errors: [String]

    static func load(_ providers: [NSItemProvider]) async -> SharedContent {
        var parts: [String] = []
        var files: [SharedFile] = []
        var errors: [String] = []
        for provider in providers {
            do {
                if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    files.append(try await SharedFile.image(from: provider))
                } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    guard let url = try await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL else { throw SharedFile.ReadError.unsupported }
                    if url.isFileURL { files.append(try SharedFile.file(url)) } else { parts.append(url.absoluteString) }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    let type = provider.hasItemConformingToTypeIdentifier(UTType.utf8PlainText.identifier) ? UTType.utf8PlainText
                        : provider.hasItemConformingToTypeIdentifier(UTType.utf16PlainText.identifier) ? UTType.utf16PlainText : UTType.plainText
                    let item = try await provider.loadItem(forTypeIdentifier: type.identifier)
                    let text = (item as? String) ?? (item as? Data).flatMap {
                        String(data: $0, encoding: type == .utf16PlainText ? .utf16 : .utf8)
                    }
                    guard let text else { throw SharedFile.ReadError.unsupported }
                    parts.append(text)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
                    guard let url = try await provider.loadItem(forTypeIdentifier: UTType.data.identifier) as? URL else { throw SharedFile.ReadError.unsupported }
                    files.append(try SharedFile.file(url))
                } else { throw SharedFile.ReadError.unsupported }
            } catch {
                errors.append("\(provider.suggestedName ?? "Shared item"): \(error.localizedDescription)")
            }
        }
        return SharedContent(text: parts.joined(separator: "\n\n"), files: files, errors: errors)
    }
}

/// Shared photos use actual pixel bounds, independent of the device's screen scale.
struct SharedFile: Identifiable {
    static let maximumBytes = 35 * 1024 * 1024
    static let maximumImagePixels = 2048
    let id = UUID()
    var data: Data
    var name: String
    var mimeType: String
    var thumbnail: UIImage?

    enum ReadError: LocalizedError {
        case unsupported, invalidImage, tooLarge
        var errorDescription: String? {
            switch self {
            case .unsupported: return "This shared item could not be read."
            case .invalidImage: return "This photo could not be read."
            case .tooLarge: return "Files must be 35 MB or smaller."
            }
        }
    }

    static func image(from provider: NSItemProvider) async throws -> SharedFile {
        let item = try await provider.loadItem(forTypeIdentifier: UTType.image.identifier)
        let source: CGImageSource?
        switch item {
        case let image as UIImage:
            return try imageFile(image, name: provider.suggestedName ?? "photo")
        case let url as URL:
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            source = CGImageSourceCreateWithURL(url as CFURL, nil)
            return try thumbnail(source, name: provider.suggestedName ?? "photo")
        case let data as Data:
            source = CGImageSourceCreateWithData(data as CFData, nil)
        default: throw ReadError.invalidImage
        }
        return try thumbnail(source, name: provider.suggestedName ?? "photo")
    }

    private static func thumbnail(_ source: CGImageSource?, name: String) throws -> SharedFile {
        guard let source, let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumImagePixels,
        ] as CFDictionary) else { throw ReadError.invalidImage }
        return try imageFile(UIImage(cgImage: cgImage), name: name)
    }

    static func imageFile(_ image: UIImage, name: String) throws -> SharedFile {
        guard image.size.width > 0, image.size.height > 0 else { throw ReadError.invalidImage }
        let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let scale = min(1, CGFloat(maximumImagePixels) / max(pixels.width, pixels.height))
        let size = CGSize(width: max(1, floor(pixels.width * scale)), height: max(1, floor(pixels.height * scale)))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let data = resized.jpegData(compressionQuality: 0.85) else { throw ReadError.invalidImage }
        return SharedFile(data: data, name: "\((name as NSString).deletingPathExtension).jpg", mimeType: "image/jpeg", thumbnail: resized)
    }

    static func file(_ url: URL) throws -> SharedFile {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        // Refuse large files before allocating their contents in the extension.
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true else { throw ReadError.unsupported }
        guard (values.fileSize ?? 0) <= maximumBytes else { throw ReadError.tooLarge }
        let data = try Data(contentsOf: url)
        guard data.count <= maximumBytes else { throw ReadError.tooLarge }
        let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        return SharedFile(data: data, name: url.lastPathComponent, mimeType: mimeType)
    }
}
