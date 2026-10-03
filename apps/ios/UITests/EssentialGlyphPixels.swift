import UIKit

/// Measures the rendered ink, not the SwiftUI layout frame. Emoji use their
/// colored pixels; a waiting badge uses white ink on its dark capsule.
enum EssentialGlyphPixels {
    static func inkSize(_ image: UIImage, points: CGSize, badge: Bool) -> CGSize? {
        guard let cg = image.cgImage else { return nil }
        let width = cg.width, height = cg.height
        var rgba = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = rgba.withUnsafeMutableBytes { bytes -> Bool in
            guard let context = CGContext(data: bytes.baseAddress, width: width, height: height,
                                          bitsPerComponent: 8, bytesPerRow: width * 4,
                                          space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }
        // The rounded badge can expose light tile background at the crop's
        // corners. Only an enclosed white component can be the numeral ink.
        var badgeInk: Set<Int> = []
        if badge {
            var visited: Set<Int> = []
            for start in 0..<(width * height) {
                guard !visited.contains(start) else { continue }
                var queue = [start], component: [Int] = [], edge = false
                while let position = queue.popLast() {
                    guard visited.insert(position).inserted else { continue }
                    let offset = position * 4
                    guard rgba[offset] > 220, rgba[offset + 1] > 220, rgba[offset + 2] > 220 else { continue }
                    component.append(position)
                    let x = position % width, y = position / width
                    if x == 0 || y == 0 || x == width - 1 || y == height - 1 { edge = true }
                    if x > 0 { queue.append(position - 1) }
                    if x + 1 < width { queue.append(position + 1) }
                    if y > 0 { queue.append(position - width) }
                    if y + 1 < height { queue.append(position + width) }
                }
                if !edge, component.count > badgeInk.count { badgeInk = Set(component) }
            }
        }
        var minX = width, minY = height, maxX = -1, maxY = -1, count = 0
        for y in 0..<height {
            for x in 0..<width {
                let offset = (y * width + x) * 4
                let r = Int(rgba[offset]), g = Int(rgba[offset + 1]), b = Int(rgba[offset + 2])
                let high = max(r, max(g, b)), low = min(r, min(g, b))
                let ink = badge ? badgeInk.contains(y * width + x) : high - low > 45 && high > 70
                if ink {
                    minX = min(minX, x); minY = min(minY, y)
                    maxX = max(maxX, x); maxY = max(maxY, y)
                    count += 1
                }
            }
        }
        guard count >= 8, maxX >= minX, maxY >= minY else { return nil }
        return CGSize(width: CGFloat(maxX - minX + 1) * points.width / CGFloat(width),
                      height: CGFloat(maxY - minY + 1) * points.height / CGFloat(height))
    }
}
