import UIKit

/// A deliberately narrow pixel check for nearly monochrome native text.
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
                guard pixels[index + 3] == 255, rgb.max()! - rgb.min()! <= 4 else { continue }
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

    struct ColorSample {
        let foreground: [Int]
        let background: [Int]
        let ratio: Double
    }

    /// Conservative sRGB sampling for a label on a light background, including
    /// tinted toolbar text. Both pixel populations must be substantial; a dark
    /// edge or a mostly transparent image is not evidence of readable text.
    static func sampleColor(_ image: UIImage) -> ColorSample? {
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
        func luminance(_ rgb: [Int]) -> Double {
            let linear = rgb.map { value -> Double in
                let component = Double(value) / 255
                return component <= 0.04045 ? component / 12.92 : pow((component + 0.055) / 1.055, 2.4)
            }
            return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
        }
        let insetX = width / 10, insetY = height / 10
        let count = (width - insetX * 2) * (height - insetY * 2)
        var dark: [(rgb: [Int], luminance: Double)] = [], light: [(rgb: [Int], luminance: Double)] = []
        for y in insetY..<(height - insetY) {
            for x in insetX..<(width - insetX) {
                let index = (y * width + x) * 4
                guard pixels[index + 3] == 255 else { continue }
                let rgb = pixels[index..<(index + 3)].map(Int.init)
                let value = luminance(rgb)
                if value <= 0.25 { dark.append((rgb, value)) }
                if value >= 0.7 { light.append((rgb, value)) }
            }
        }
        guard dark.count >= count / 20, light.count >= count * 2 / 5 else { return nil }
        dark.sort { $0.luminance < $1.luminance }
        light.sort { $0.luminance < $1.luminance }
        let foreground = dark[dark.count / 2], background = light[light.count / 20]
        return ColorSample(foreground: foreground.rgb, background: background.rgb,
                           ratio: (background.luminance + 0.05) / (foreground.luminance + 0.05))
    }

}
