import Foundation
import Vision
import CoreImage
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

struct ComplianceReport: Codable {
    let faceDetected: Bool
    let faceCount: Int
    let rollDegrees: Double
    let yawDegrees: Double
    let pitchDegrees: Double
    // nil when Vision could not score capture quality (the key is omitted from
    // the JSON; the Node side reads a missing key as null).
    let qualityScore: Double?
    let chinYNormalized: Double
    let crownYNormalized: Double
    let eyeLevelNormalized: Double
    let headHeightRatio: Double
    let isCentered: Bool
    let compliant: Bool
    let violations: [String]
    let advisories: [String]
}

struct ProcessResult: Codable {
    let success: Bool
    let outputPath: String
    let width: Int
    let height: Int
    let dpi: Int
    let backgroundReplaced: Bool
    let message: String?
}

struct SheetResult: Codable {
    let success: Bool
    let outputPath: String
    let width: Int
    let height: Int
    let dpi: Int
    let cellCount: Int
    let message: String?
}

// A failed inspection: nothing measured, one violation explaining why.
func failedReport(_ reason: String) -> ComplianceReport {
    return ComplianceReport(
        faceDetected: false,
        faceCount: 0,
        rollDegrees: 0,
        yawDegrees: 0,
        pitchDegrees: 0,
        qualityScore: nil,
        chinYNormalized: 0,
        crownYNormalized: 0,
        eyeLevelNormalized: 0,
        headHeightRatio: 0,
        isCentered: false,
        compliant: false,
        violations: [reason],
        advisories: []
    )
}

func failedProcess(_ message: String) -> ProcessResult {
    return ProcessResult(
        success: false,
        outputPath: "",
        width: 0,
        height: 0,
        dpi: 0,
        backgroundReplaced: false,
        message: message
    )
}

func failedSheet(_ message: String) -> SheetResult {
    return SheetResult(
        success: false,
        outputPath: "",
        width: 0,
        height: 0,
        dpi: 0,
        cellCount: 0,
        message: message
    )
}

// The face with the largest bounding box, which is the subject in a portrait.
func largestFace(_ faces: [VNFaceObservation]) -> VNFaceObservation? {
    return faces.max { a, b in
        a.boundingBox.width * a.boundingBox.height < b.boundingBox.width * b.boundingBox.height
    }
}

// Output format is chosen strictly by extension; anything else is rejected.
func outputTypeIdentifier(for path: String, allowJpeg: Bool) -> CFString? {
    let ext = URL(fileURLWithPath: path).pathExtension.lowercased()
    if ext == "png" {
        return UTType.png.identifier as CFString
    }
    if allowJpeg && (ext == "jpg" || ext == "jpeg") {
        return UTType.jpeg.identifier as CFString
    }
    return nil
}

// Convert Hex string (e.g. "#FFFFFF" or "FFFFFF") to CIColor
func parseHexColor(_ hex: String) -> CIColor? {
    var cString = hex.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    if cString.hasPrefix("#") {
        cString.remove(at: cString.startIndex)
    }
    guard cString.count == 6 || cString.count == 8 else { return nil }
    guard cString.allSatisfy({ $0.isHexDigit }) else { return nil }

    var rgbValue: UInt64 = 0
    guard Scanner(string: cString).scanHexInt64(&rgbValue) else { return nil }

    if cString.count == 6 {
        return CIColor(
            red: CGFloat((rgbValue & 0xFF0000) >> 16) / 255.0,
            green: CGFloat((rgbValue & 0x00FF00) >> 8) / 255.0,
            blue: CGFloat(rgbValue & 0x0000FF) / 255.0,
            alpha: 1.0
        )
    } else {
        return CIColor(
            red: CGFloat((rgbValue & 0xFF000000) >> 24) / 255.0,
            green: CGFloat((rgbValue & 0x00FF0000) >> 16) / 255.0,
            blue: CGFloat((rgbValue & 0x0000FF00) >> 8) / 255.0,
            alpha: CGFloat(rgbValue & 0x000000FF) / 255.0
        )
    }
}

// Inspect image for biometric and compliance parameters
func inspectImage(path: String) -> ComplianceReport {
    guard let ciImage = CIImage(contentsOf: URL(fileURLWithPath: path)) else {
        return failedReport("Failed to load image file")
    }

    let handler = VNImageRequestHandler(ciImage: ciImage, options: [:])
    let landmarksReq = VNDetectFaceLandmarksRequest()

    do {
        try handler.perform([landmarksReq])
    } catch {
        return failedReport("Vision analysis error: \(error.localizedDescription)")
    }

    let faces = landmarksReq.results ?? []
    guard let primaryFace = largestFace(faces) else {
        return failedReport("No face detected in photo")
    }

    let faceBox = primaryFace.boundingBox // In Vision coordinates (0,0 bottom-left)
    let rollRad = primaryFace.roll?.doubleValue ?? 0
    let yawRad = primaryFace.yaw?.doubleValue ?? 0
    let pitchRad = primaryFace.pitch?.doubleValue ?? 0

    let rollDeg = rollRad * 180.0 / .pi
    let yawDeg = yawRad * 180.0 / .pi
    let pitchDeg = pitchRad * 180.0 / .pi

    // Score capture quality for the chosen face only. If Vision cannot score
    // it, report nil rather than inventing a value.
    let qualityReq = VNDetectFaceCaptureQualityRequest()
    qualityReq.inputFaceObservations = [primaryFace]
    var qualityScore: Double? = nil
    if (try? handler.perform([qualityReq])) != nil,
       let quality = (qualityReq.results?.first as? VNFaceObservation)?.faceCaptureQuality {
        qualityScore = Double(quality)
    }

    // Extract chin from landmarks
    var chinYVision = faceBox.origin.y
    if let contour = primaryFace.landmarks?.faceContour {
        let pts = contour.normalizedPoints
        if !pts.isEmpty {
            let minY = pts.map { $0.y }.min() ?? 0
            chinYVision = faceBox.origin.y + minY * faceBox.size.height
        }
    }

    // Extract eye level
    var eyeYVision = faceBox.origin.y + faceBox.size.height * 0.6
    if let leftEye = primaryFace.landmarks?.leftEye, let rightEye = primaryFace.landmarks?.rightEye {
        let leftPts = leftEye.normalizedPoints
        let rightPts = rightEye.normalizedPoints
        if !leftPts.isEmpty && !rightPts.isEmpty {
            let leftAvgY = leftPts.map { $0.y }.reduce(0, +) / CGFloat(leftPts.count)
            let rightAvgY = rightPts.map { $0.y }.reduce(0, +) / CGFloat(rightPts.count)
            eyeYVision = faceBox.origin.y + ((leftAvgY + rightAvgY) / 2.0) * faceBox.size.height
        }
    }

    // Anthropometric crown ceiling: H_head <= 2.3 * (Y_eye - Y_chin)
    let eyeToChin = max(0.05, eyeYVision - chinYVision)
    let maxHeadHeight = eyeToChin * 2.3
    let crownYVision = min(1.0, chinYVision + maxHeadHeight)

    // Convert Vision normalized coordinates (origin bottom-left) to standard image coordinates (origin top-left)
    let chinYNorm = 1.0 - Double(chinYVision)
    let crownYNorm = 1.0 - Double(crownYVision)
    let eyeLevelNorm = 1.0 - Double(eyeYVision)
    let headHeightNorm = abs(chinYNorm - crownYNorm)

    let faceCenterX = Double(faceBox.origin.x + faceBox.size.width / 2.0)
    let isCentered = abs(faceCenterX - 0.5) <= 0.08

    var violations: [String] = []
    var advisories: [String] = []
    if faces.count > 1 {
        violations.append("Multiple faces detected (\(faces.count)); measured the largest")
    }
    if abs(rollDeg) > 3.0 {
        violations.append(String(format: "Head tilt / roll exceeds ±3° (%.1f°)", rollDeg))
    }
    if abs(yawDeg) > 5.0 {
        violations.append(String(format: "Head turn / yaw exceeds ±5° (%.1f°)", yawDeg))
    }
    if abs(pitchDeg) > 5.0 {
        violations.append(String(format: "Head pitch exceeds ±5° (%.1f°)", pitchDeg))
    }
    if let quality = qualityScore {
        if quality < 0.4 {
            violations.append(String(format: "Photo capture quality is low (%.2f)", quality))
        }
    } else {
        advisories.append("Capture quality could not be measured; it was not checked")
    }
    if !isCentered {
        violations.append(String(format: "Face is not centered horizontally (center at %.1f%%)", faceCenterX * 100))
    }

    let compliant = violations.isEmpty

    return ComplianceReport(
        faceDetected: true,
        faceCount: faces.count,
        rollDegrees: round(rollDeg * 10) / 10,
        yawDegrees: round(yawDeg * 10) / 10,
        pitchDegrees: round(pitchDeg * 10) / 10,
        qualityScore: qualityScore.map { round($0 * 100) / 100 },
        chinYNormalized: round(chinYNorm * 1000) / 1000,
        crownYNormalized: round(crownYNorm * 1000) / 1000,
        eyeLevelNormalized: round(eyeLevelNorm * 1000) / 1000,
        headHeightRatio: round(headHeightNorm * 1000) / 1000,
        isCentered: isCentered,
        compliant: compliant,
        violations: violations,
        advisories: advisories
    )
}

// Encode a CGImage to `path` with DPI metadata. The format follows the
// extension (.png, or .jpg/.jpeg when allowed); returns an error message or nil.
func writeImage(_ cgImage: CGImage, to path: String, dpi: Int, allowJpeg: Bool) -> String? {
    guard let uti = outputTypeIdentifier(for: path, allowJpeg: allowJpeg) else {
        return allowJpeg
            ? "Unsupported output extension; use .png, .jpg or .jpeg"
            : "Unsupported output extension; use .png"
    }
    let outputURL = URL(fileURLWithPath: path)
    guard let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, uti, 1, nil) else {
        return "Cannot create image destination"
    }

    let properties: [CFString: Any] = [
        kCGImagePropertyDPIWidth: dpi,
        kCGImagePropertyDPIHeight: dpi,
        kCGImagePropertyPixelWidth: cgImage.width,
        kCGImagePropertyPixelHeight: cgImage.height
    ]

    CGImageDestinationAddImage(destination, cgImage, properties as CFDictionary)
    return CGImageDestinationFinalize(destination) ? nil : "Failed to finalize image file destination"
}

// Process, auto-frame, and segment image
func processImage(
    inputPath: String,
    outputPath: String,
    targetWidth: Int,
    targetHeight: Int,
    bgColorHex: String,
    autoFrame: Bool,
    targetHeadRatio: Double,
    targetTopMargin: Double,
    dpi: Int
) -> ProcessResult {
    guard outputTypeIdentifier(for: outputPath, allowJpeg: true) != nil else {
        return failedProcess("Unsupported output extension; use .png, .jpg or .jpeg")
    }

    // An unparsable colour is an error, never a silent "keep the background".
    let wantsBgReplacement = bgColorHex != "none"
    var bgColor: CIColor? = nil
    if wantsBgReplacement {
        guard let parsed = parseHexColor(bgColorHex) else {
            return failedProcess("Invalid background colour; expected #RRGGBB, #RRGGBBAA or none")
        }
        bgColor = parsed
    }

    guard let ciImage = CIImage(contentsOf: URL(fileURLWithPath: inputPath)) else {
        return failedProcess("Cannot open input image")
    }

    let imgExtent = ciImage.extent
    let imgW = imgExtent.width
    let imgH = imgExtent.height
    guard imgW > 10 && imgH > 10 else {
        return failedProcess("Invalid image dimensions")
    }

    var workingImage = ciImage
    // Set only when segmentation actually succeeded; the frame crop may then
    // extend past the original image, padded with this background.
    var solidBackground: CIImage? = nil
    var notes: [String] = []

    // Person segmentation & background replacement
    if let bgColor = bgColor {
        let segReq = VNGeneratePersonSegmentationRequest()
        segReq.qualityLevel = .accurate
        segReq.outputPixelFormat = kCVPixelFormatType_OneComponent8

        let segHandler = VNImageRequestHandler(ciImage: ciImage, options: [:])
        do {
            try segHandler.perform([segReq])
            if let maskObservation = segReq.results?.first {
                let maskBuffer = maskObservation.pixelBuffer
                var maskImage = CIImage(cvPixelBuffer: maskBuffer)

                let scaleX = imgW / maskImage.extent.width
                let scaleY = imgH / maskImage.extent.height
                maskImage = maskImage.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
                maskImage = maskImage.transformed(by: CGAffineTransform(
                    translationX: imgExtent.origin.x - maskImage.extent.origin.x,
                    y: imgExtent.origin.y - maskImage.extent.origin.y
                ))

                let solidBg = CIImage(color: bgColor)

                if let blendFilter = CIFilter(name: "CIBlendWithMask") {
                    blendFilter.setValue(ciImage, forKey: kCIInputImageKey)
                    blendFilter.setValue(solidBg.cropped(to: imgExtent), forKey: kCIInputBackgroundImageKey)
                    blendFilter.setValue(maskImage, forKey: kCIInputMaskImageKey)
                    if let output = blendFilter.outputImage {
                        workingImage = output.composited(over: solidBg).cropped(to: imgExtent)
                        solidBackground = solidBg
                    }
                }
            }
        } catch {
            // Keep the original image; reported via backgroundReplaced = false.
        }
        if solidBackground == nil {
            notes.append("Person segmentation failed; the original background was kept")
        }
    }
    let bgReplaced = solidBackground != nil

    if autoFrame {
        let handler = VNImageRequestHandler(ciImage: ciImage, options: [:])
        let landmarksReq = VNDetectFaceLandmarksRequest()
        try? handler.perform([landmarksReq])

        if let primaryFace = largestFace(landmarksReq.results ?? []) {
            let faceBox = primaryFace.boundingBox

            // Extract chin & eye in image pixels (Vision coords: 0,0 is bottom-left)
            var chinYVision = faceBox.origin.y
            if let contour = primaryFace.landmarks?.faceContour {
                let pts = contour.normalizedPoints
                if !pts.isEmpty {
                    let minY = pts.map { $0.y }.min() ?? 0
                    chinYVision = faceBox.origin.y + minY * faceBox.size.height
                }
            }
            var eyeYVision = faceBox.origin.y + faceBox.size.height * 0.6
            if let leftEye = primaryFace.landmarks?.leftEye, let rightEye = primaryFace.landmarks?.rightEye {
                let leftPts = leftEye.normalizedPoints
                let rightPts = rightEye.normalizedPoints
                if !leftPts.isEmpty && !rightPts.isEmpty {
                    let leftAvgY = leftPts.map { $0.y }.reduce(0, +) / CGFloat(leftPts.count)
                    let rightAvgY = rightPts.map { $0.y }.reduce(0, +) / CGFloat(rightPts.count)
                    eyeYVision = faceBox.origin.y + ((leftAvgY + rightAvgY) / 2.0) * faceBox.size.height
                }
            }

            let eyeToChin = max(0.05, eyeYVision - chinYVision)
            let crownYVision = min(1.0, chinYVision + eyeToChin * 2.3)

            let chinYPx = chinYVision * imgH
            let crownYPx = crownYVision * imgH
            let headHeightPx = max(50.0, crownYPx - chinYPx)

            // Specs range from ~0.33 (wallet prints) to ~0.9 head height.
            let targetHeadRatioClamped = max(0.2, min(0.95, targetHeadRatio))
            let frameHPx = headHeightPx / CGFloat(targetHeadRatioClamped)
            let aspect = CGFloat(targetWidth) / CGFloat(targetHeight)
            let frameWPx = frameHPx * aspect

            let faceCenterXPx = (faceBox.origin.x + faceBox.size.width / 2.0) * imgW

            if let solidBg = solidBackground {
                // Background replaced: the frame may extend past the photo and
                // is padded with the new background colour.
                let topMarginPx = frameHPx * CGFloat(targetTopMargin)
                let cropRect = CGRect(
                    x: faceCenterXPx - (frameWPx / 2.0),
                    y: crownYPx + topMarginPx - frameHPx,
                    width: frameWPx,
                    height: frameHPx
                )
                workingImage = workingImage.composited(over: solidBg).cropped(to: cropRect)
            } else {
                // Original background: stay inside the photo.
                let maxFitH = min(imgH, imgW / aspect)
                let boundedH = min(frameHPx, maxFitH)
                let boundedW = boundedH * aspect
                let cropRect = CGRect(
                    x: max(0, min(imgW - boundedW, faceCenterXPx - (boundedW / 2.0))),
                    y: max(0, min(imgH - boundedH, crownYPx + (boundedH * CGFloat(targetTopMargin)) - boundedH)),
                    width: boundedW,
                    height: boundedH
                )
                workingImage = workingImage.cropped(to: cropRect)
            }
        } else {
            notes.append("No face detected; auto-frame was skipped and the photo was centre-cropped")
        }
    }

    // Ensure workingImage matches target aspect ratio before scaling
    let currentExtent = workingImage.extent
    let currentAspect = currentExtent.width / currentExtent.height
    let targetAspect = CGFloat(targetWidth) / CGFloat(targetHeight)
    if abs(currentAspect - targetAspect) > 0.001 {
        let cropW: CGFloat
        let cropH: CGFloat
        if currentAspect > targetAspect {
            cropH = currentExtent.height
            cropW = cropH * targetAspect
        } else {
            cropW = currentExtent.width
            cropH = cropW / targetAspect
        }
        let cropX = currentExtent.origin.x + (currentExtent.width - cropW) / 2.0
        let cropY = currentExtent.origin.y + (currentExtent.height - cropH) / 2.0
        workingImage = workingImage.cropped(to: CGRect(x: cropX, y: cropY, width: cropW, height: cropH))
    }

    let finalExtent = workingImage.extent
    let finalScaleX = CGFloat(targetWidth) / finalExtent.width
    let finalScaleY = CGFloat(targetHeight) / finalExtent.height
    let scaledImage = workingImage
        .transformed(by: CGAffineTransform(scaleX: finalScaleX, y: finalScaleY))
        .transformed(by: CGAffineTransform(translationX: -finalExtent.origin.x * finalScaleX, y: -finalExtent.origin.y * finalScaleY))
        .cropped(to: CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight))

    let context = CIContext(options: [.useSoftwareRenderer: false])
    guard let cgImage = context.createCGImage(scaledImage, from: CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight)) else {
        return failedProcess("Failed to render CoreGraphics image")
    }

    if let error = writeImage(cgImage, to: outputPath, dpi: dpi, allowJpeg: true) {
        return failedProcess(error)
    }

    return ProcessResult(
        success: true,
        outputPath: outputPath,
        width: targetWidth,
        height: targetHeight,
        dpi: dpi,
        backgroundReplaced: bgReplaced,
        message: notes.isEmpty ? nil : notes.joined(separator: "; ")
    )
}

// Tile one photo onto a white print sheet. Cells use top-left pixel
// coordinates, exactly as planned by the Node side (printSheetCells).
func renderSheet(
    photoPath: String,
    outputPath: String,
    sheetWidth: Int,
    sheetHeight: Int,
    dpi: Int,
    cells: [CGRect],
    cutGuides: Bool
) -> SheetResult {
    guard outputTypeIdentifier(for: outputPath, allowJpeg: false) != nil else {
        return failedSheet("Unsupported output extension; use .png")
    }
    guard sheetWidth > 0 && sheetHeight > 0 && sheetWidth <= 20000 && sheetHeight <= 20000 else {
        return failedSheet("Invalid sheet dimensions")
    }
    guard !cells.isEmpty else {
        return failedSheet("No cells to draw")
    }
    let sheetBounds = CGRect(x: 0, y: 0, width: sheetWidth, height: sheetHeight)
    for cell in cells where cell.width <= 0 || cell.height <= 0 || !sheetBounds.contains(cell) {
        return failedSheet("Cell lies outside the sheet")
    }

    guard let photo = CIImage(contentsOf: URL(fileURLWithPath: photoPath), options: [.applyOrientationProperty: true]) else {
        return failedSheet("Cannot open photo")
    }
    let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    guard let photoImage = ciContext.createCGImage(photo, from: photo.extent) else {
        return failedSheet("Failed to decode photo")
    }

    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
          let ctx = CGContext(
            data: nil,
            width: sheetWidth,
            height: sheetHeight,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
          ) else {
        return failedSheet("Cannot allocate sheet bitmap")
    }

    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(sheetBounds)
    ctx.interpolationQuality = .high

    let srcW = CGFloat(photoImage.width)
    let srcH = CGFloat(photoImage.height)
    for cell in cells {
        // Aspect-fill: centre-crop the photo to the cell's aspect so it is
        // never distorted (a correctly processed photo already matches).
        let cellAspect = cell.width / cell.height
        var cropW = srcW
        var cropH = srcW / cellAspect
        if cropH > srcH {
            cropH = srcH
            cropW = srcH * cellAspect
        }
        let crop = CGRect(x: (srcW - cropW) / 2.0, y: (srcH - cropH) / 2.0, width: cropW, height: cropH).integral
        guard let tile = photoImage.cropping(to: crop) else {
            return failedSheet("Failed to crop photo for tiling")
        }
        // CoreGraphics draws with a bottom-left origin.
        let target = CGRect(
            x: cell.origin.x,
            y: CGFloat(sheetHeight) - cell.origin.y - cell.height,
            width: cell.width,
            height: cell.height
        )
        ctx.draw(tile, in: target)
    }

    if cutGuides {
        // One-pixel grey hairline just outside each photo, in the gutter.
        ctx.setStrokeColor(CGColor(red: 0.6, green: 0.6, blue: 0.6, alpha: 1))
        ctx.setLineWidth(1)
        for cell in cells {
            let target = CGRect(
                x: cell.origin.x,
                y: CGFloat(sheetHeight) - cell.origin.y - cell.height,
                width: cell.width,
                height: cell.height
            )
            ctx.stroke(target.insetBy(dx: -0.5, dy: -0.5))
        }
    }

    guard let sheetImage = ctx.makeImage() else {
        return failedSheet("Failed to render sheet")
    }
    if let error = writeImage(sheetImage, to: outputPath, dpi: dpi, allowJpeg: false) {
        return failedSheet(error)
    }

    return SheetResult(
        success: true,
        outputPath: outputPath,
        width: sheetWidth,
        height: sheetHeight,
        dpi: dpi,
        cellCount: cells.count,
        message: nil
    )
}

// "x,y,w,h;x,y,w,h;..." in integer pixels.
func parseCells(_ value: String) -> [CGRect]? {
    var rects: [CGRect] = []
    for part in value.split(separator: ";") {
        let nums = part.split(separator: ",").map { Int($0.trimmingCharacters(in: .whitespaces)) }
        guard nums.count == 4, let x = nums[0], let y = nums[1], let w = nums[2], let h = nums[3] else {
            return nil
        }
        rects.append(CGRect(x: x, y: y, width: w, height: h))
    }
    return rects.isEmpty ? nil : rects
}

func printJSON<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted]
    if let data = try? encoder.encode(value), let jsonStr = String(data: data, encoding: .utf8) {
        print(jsonStr)
    }
}

// Usage errors: JSON on stdout for the Node side, exit code 2.
func fail(_ message: String) -> Never {
    printJSON(["error": message])
    exit(2)
}

func printUsage() {
    let usage = """
    Usage:
      idify-vision inspect <path-to-image>
      idify-vision process <path-to-image> --output <path.png|.jpg> --width <px> --height <px> [--bg <hex|none>] [--auto-frame] [--head-ratio <0.2-0.95>] [--top-margin <0-1>] [--dpi <dpi>]
      idify-vision sheet <path-to-photo> --output <path.png> --sheet-width <px> --sheet-height <px> --cells <x,y,w,h;...> [--dpi <dpi>] [--cut-guides]

    """
    FileHandle.standardError.write(usage.data(using: .utf8)!)
}

// Parse "--flag value" / "--switch" options; unknown or malformed options are errors.
func parseOptions(_ args: ArraySlice<String>, valued: Set<String>, switches: Set<String>) -> [String: String] {
    var options: [String: String] = [:]
    var i = args.startIndex
    while i < args.endIndex {
        let arg = args[i]
        if switches.contains(arg) {
            options[arg] = "true"
            i += 1
        } else if valued.contains(arg) {
            guard i + 1 < args.endIndex else { fail("Missing value for \(arg)") }
            options[arg] = args[i + 1]
            i += 2
        } else {
            fail("Unknown option \(arg)")
        }
    }
    return options
}

func intOption(_ options: [String: String], _ key: String, default value: Int?, range: ClosedRange<Int>) -> Int {
    guard let raw = options[key] else {
        guard let value = value else { fail("Missing required option \(key)") }
        return value
    }
    guard let parsed = Int(raw), range.contains(parsed) else {
        fail("Invalid value for \(key)")
    }
    return parsed
}

func doubleOption(_ options: [String: String], _ key: String, default value: Double, range: ClosedRange<Double>) -> Double {
    guard let raw = options[key] else { return value }
    guard let parsed = Double(raw), range.contains(parsed) else {
        fail("Invalid value for \(key)")
    }
    return parsed
}

// CLI entry point
func main() {
    let args = CommandLine.arguments
    if args.count < 3 {
        printUsage()
        fail("Missing command or image path")
    }

    let command = args[1]
    let imagePath = args[2]
    let rest = args[3...]

    if command == "inspect" {
        guard rest.isEmpty else { fail("inspect takes exactly one image path") }
        printJSON(inspectImage(path: imagePath))
    } else if command == "process" {
        let options = parseOptions(
            rest,
            valued: ["--output", "--width", "--height", "--bg", "--head-ratio", "--top-margin", "--dpi"],
            switches: ["--auto-frame"]
        )
        guard let outputPath = options["--output"] else { fail("Missing required option --output") }

        let result = processImage(
            inputPath: imagePath,
            outputPath: outputPath,
            targetWidth: intOption(options, "--width", default: nil, range: 16...20000),
            targetHeight: intOption(options, "--height", default: nil, range: 16...20000),
            bgColorHex: options["--bg"] ?? "#ffffff",
            autoFrame: options["--auto-frame"] != nil,
            targetHeadRatio: doubleOption(options, "--head-ratio", default: 0.75, range: 0.05...1.0),
            targetTopMargin: doubleOption(options, "--top-margin", default: 0.10, range: 0.0...0.5),
            dpi: intOption(options, "--dpi", default: 600, range: 72...1200)
        )
        printJSON(result)
        if !result.success {
            exit(1)
        }
    } else if command == "sheet" {
        let options = parseOptions(
            rest,
            valued: ["--output", "--sheet-width", "--sheet-height", "--dpi", "--cells"],
            switches: ["--cut-guides"]
        )
        guard let outputPath = options["--output"] else { fail("Missing required option --output") }
        guard let cellsRaw = options["--cells"], let cells = parseCells(cellsRaw) else {
            fail("Missing or invalid --cells")
        }

        let result = renderSheet(
            photoPath: imagePath,
            outputPath: outputPath,
            sheetWidth: intOption(options, "--sheet-width", default: nil, range: 1...20000),
            sheetHeight: intOption(options, "--sheet-height", default: nil, range: 1...20000),
            dpi: intOption(options, "--dpi", default: 300, range: 72...1200),
            cells: cells,
            cutGuides: options["--cut-guides"] != nil
        )
        printJSON(result)
        if !result.success {
            exit(1)
        }
    } else {
        printUsage()
        fail("Unknown command: \(command)")
    }
}

main()
