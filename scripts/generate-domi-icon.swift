import AppKit

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
  fputs("Usage: swift generate-domi-icon.swift <input> <output>\n", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: arguments[1])
let outputURL = URL(fileURLWithPath: arguments[2])

guard let source = NSImage(contentsOf: inputURL) else {
  fputs("Could not read input image: \(inputURL.path)\n", stderr)
  exit(1)
}

let canvasSize = NSSize(width: 1024, height: 1024)
let tileScale: CGFloat = 0.82
let tileSize = canvasSize.width * tileScale
let tileOrigin = (canvasSize.width - tileSize) / 2
let tileRect = NSRect(x: tileOrigin, y: tileOrigin, width: tileSize, height: tileSize)
let cornerRadius = tileSize * 0.225
let contentScale: CGFloat = 0.66
let contentSize = tileSize * contentScale
let contentOrigin = (canvasSize.width - contentSize) / 2
let contentRect = NSRect(x: contentOrigin, y: contentOrigin, width: contentSize, height: contentSize)
let canvasRect = NSRect(origin: .zero, size: canvasSize)

func sampledDarkBackground(from image: NSImage) -> NSColor {
  guard
    let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
  else {
    return NSColor(calibratedRed: 0.055, green: 0.020, blue: 0.050, alpha: 1.0)
  }

  let bitmap = NSBitmapImageRep(cgImage: cgImage)
  var red: CGFloat = 0
  var green: CGFloat = 0
  var blue: CGFloat = 0
  var count: CGFloat = 0
  let step = 8

  for y in stride(from: 0, to: bitmap.pixelsHigh, by: step) {
    for x in stride(from: 0, to: bitmap.pixelsWide, by: step) {
      guard
        let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB)
      else {
        continue
      }

      let luminance = 0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent
      if color.alphaComponent > 0.9 && luminance < 0.055 {
        red += color.redComponent
        green += color.greenComponent
        blue += color.blueComponent
        count += 1
      }
    }
  }

  guard count > 0 else {
    return NSColor(calibratedRed: 0.055, green: 0.020, blue: 0.050, alpha: 1.0)
  }

  return NSColor(calibratedRed: red / count, green: green / count, blue: blue / count, alpha: 1.0)
}

func foregroundOnly(from image: NSImage) -> NSImage {
  guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    return image
  }

  let sourceBitmap = NSBitmapImageRep(cgImage: cgImage)
  guard let outputBitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: sourceBitmap.pixelsWide,
    pixelsHigh: sourceBitmap.pixelsHigh,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    return image
  }

  outputBitmap.size = NSSize(width: sourceBitmap.pixelsWide, height: sourceBitmap.pixelsHigh)

  for y in 0..<sourceBitmap.pixelsHigh {
    for x in 0..<sourceBitmap.pixelsWide {
      guard
        let rawColor = sourceBitmap.colorAt(x: x, y: y),
        let color = rawColor.usingColorSpace(.deviceRGB)
      else {
        continue
      }

      let luminance = 0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent
      let alpha: CGFloat
      if luminance < 0.055 {
        alpha = 0
      } else if luminance < 0.155 {
        alpha = (luminance - 0.055) / 0.100
      } else {
        alpha = 1
      }

      outputBitmap.setColor(
        NSColor(
          calibratedRed: color.redComponent,
          green: color.greenComponent,
          blue: color.blueComponent,
          alpha: min(1, max(0, alpha))
        ),
        atX: x,
        y: y
      )
    }
  }

  let output = NSImage(size: outputBitmap.size)
  output.addRepresentation(outputBitmap)
  return output
}

guard let bitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: Int(canvasSize.width),
  pixelsHigh: Int(canvasSize.height),
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  fputs("Could not create output bitmap\n", stderr)
  exit(1)
}

bitmap.size = canvasSize

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

NSColor.clear.setFill()
canvasRect.fill()

let tilePath = NSBezierPath(roundedRect: tileRect, xRadius: cornerRadius, yRadius: cornerRadius)
tilePath.addClip()

sampledDarkBackground(from: source).setFill()
tileRect.fill()

let foreground = foregroundOnly(from: source)

foreground.draw(
  in: contentRect,
  from: NSRect(origin: .zero, size: foreground.size),
  operation: .sourceOver,
  fraction: 1.0,
  respectFlipped: true,
  hints: [.interpolation: NSImageInterpolation.high]
)

let innerStroke = NSBezierPath(roundedRect: tileRect.insetBy(dx: 3, dy: 3), xRadius: cornerRadius - 3, yRadius: cornerRadius - 3)
NSColor(calibratedWhite: 1.0, alpha: 0.08).setStroke()
innerStroke.lineWidth = 3
innerStroke.stroke()

NSGraphicsContext.restoreGraphicsState()

guard
  let pngData = bitmap.representation(using: .png, properties: [:])
else {
  fputs("Could not encode output PNG\n", stderr)
  exit(1)
}

do {
  try pngData.write(to: outputURL)
} catch {
  fputs("Could not write output image: \(error)\n", stderr)
  exit(1)
}
