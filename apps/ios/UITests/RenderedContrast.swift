import UIKit

/// A deliberately narrow check for the native Select control's monochrome text.
/// Other palettes or insufficient text/background samples fail closed.
enum RenderedContrast {
    struct Sample {
        let foreground: Int
        let background: Int
        let ratio: Double
    }

    static func sample(_ image: UIImage) -> Sample? {
        guard let source = image.cgImage,
              let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        let width = source.width, height = source.height
        guard width > 10, height > 10 else { return nil }
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = pixels.withUnsafeMutableBytes { bytes -> Bool in
            guard let context = CGContext(data: bytes.baseAddress, width: width, height: height,
                                          bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }
        // Sample inside the frame, excluding the glass border and its shadow.
        let insetX = width / 10, insetY = height / 10
        var dark: [Int] = [], light: [Int] = []
        let count = (width - insetX * 2) * (height - insetY * 2)
        for y in insetY..<(height - insetY) {
            for x in insetX..<(width - insetX) {
                let index = (y * width + x) * 4
                let rgb = pixels[index..<(index + 3)].map(Int.init)
                guard pixels[index + 3] == 255, rgb.max()! - rgb.min()! <= 2 else { continue }
                let gray = rgb.reduce(0, +) / 3
                if gray <= 128 { dark.append(gray) }
                if gray >= 220 { light.append(gray) }
            }
        }
        // A lone dark edge must not stand in for the label's foreground.
        guard dark.count >= count / 20, light.count >= count * 2 / 5 else { return nil }
        dark.sort(); light.sort()
        let foreground = dark[dark.count / 2]
        let background = light[light.count / 20]
        func luminance(_ gray: Int) -> Double {
            let component = Double(gray) / 255
            return component <= 0.04045 ? component / 12.92 : pow((component + 0.055) / 1.055, 2.4)
        }
        return Sample(foreground: foreground, background: background,
                      ratio: (luminance(background) + 0.05) / (luminance(foreground) + 0.05))
    }
}
