import XCTest
import UIKit

@MainActor
final class ShareFileTests: XCTestCase {
    func testPhotoDimensionsArePixelsNotRetinaPoints() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let original = UIGraphicsImageRenderer(size: CGSize(width: 3000, height: 1500), format: format).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 3000, height: 1500))
        }
        let retina = UIImage(cgImage: try XCTUnwrap(original.cgImage), scale: 3, orientation: .up)
        for source in [original, retina] {
            let file = try SharedFile.imageFile(source, name: "Example.heic")
            let image = try XCTUnwrap(UIImage(data: file.data)?.cgImage)
            XCTAssertEqual(image.width, 2048)
            XCTAssertEqual(image.height, 1024)
            XCTAssertEqual(file.name, "Example.jpg")
            XCTAssertEqual(file.mimeType, "image/jpeg")
        }
    }

    func testOversizeFileIsRejectedAndReadableFilePreservesBytes() throws {
        let url = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".txt")
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("A small shared file".utf8).write(to: url)
        XCTAssertEqual(try SharedFile.file(url).data, Data("A small shared file".utf8))
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: UInt64(SharedFile.maximumBytes + 1))
        try handle.close()
        XCTAssertThrowsError(try SharedFile.file(url)) { error in
            XCTAssertEqual(error.localizedDescription, SharedFile.ReadError.tooLarge.localizedDescription)
        }
    }

    func testUnreadableAndInvalidImageItemsReportFailure() async throws {
        let url = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        XCTAssertThrowsError(try SharedFile.file(url))
        let provider = NSItemProvider()
        provider.registerDataRepresentation(forTypeIdentifier: "public.image", visibility: .all) { completion in
            completion(Data("not an image".utf8), nil)
            return nil
        }
        do {
            _ = try await SharedFile.image(from: provider)
            XCTFail("Invalid image must remain an explicit failure")
        } catch { XCTAssertFalse(error.localizedDescription.isEmpty) }
    }

    func testMixedShareRetainsTextAndReportsTheFailedAttachment() async {
        let good = NSItemProvider(object: "Keep this message" as NSString)
        let bad = NSItemProvider()
        bad.suggestedName = "broken.png"
        bad.registerDataRepresentation(forTypeIdentifier: "public.image", visibility: .all) { completion in
            completion(nil, CocoaError(.fileReadNoSuchFile))
            return nil
        }
        let content = await SharedContent.load([good, bad])
        XCTAssertEqual(content.text, "Keep this message")
        XCTAssertTrue(content.files.isEmpty)
        XCTAssertEqual(content.errors.count, 1)
        XCTAssertTrue(content.errors[0].hasPrefix("broken.png:"))
    }

    func testSharedTextAcceptsUTF16DataRepresentations() async {
        let provider = NSItemProvider()
        provider.registerDataRepresentation(forTypeIdentifier: "public.utf16-plain-text", visibility: .all) { completion in
            completion("雪 and text".data(using: .utf16), nil)
            return nil
        }
        let content = await SharedContent.load([provider])
        XCTAssertEqual(content.text, "雪 and text")
        XCTAssertTrue(content.errors.isEmpty)
    }
}
