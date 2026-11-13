import AppKit
import ApplicationServices
import Carbon
import CoreGraphics
import Foundation
import IOKit.hid

let output = DispatchQueue(label: "fork-desktop-helper.output")

func emit(_ object: [String: Any]) {
  output.async {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
  }
}

func reply(_ id: Any, _ result: [String: Any]) {
  emit(["id": id, "ok": true, "result": result])
}

func fail(_ id: Any, _ message: String) {
  emit(["id": id, "ok": false, "error": message])
}

func status() -> [String: Any] {
  let input = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)
  return [
    "accessibility": AXIsProcessTrusted(),
    "screenRecording": CGPreflightScreenCaptureAccess(),
    "inputMonitoring": input == kIOHIDAccessTypeGranted,
    "inputMonitoringUnknown": input == kIOHIDAccessTypeUnknown,
  ]
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
  return error == .success ? value : nil
}

func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
  guard let value = attribute(element, name) else { return nil }
  if CFGetTypeID(value) == CFStringGetTypeID() {
    let text = (value as! String).trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }
  if CFGetTypeID(value) == CFURLGetTypeID() {
    return (value as! URL).absoluteString
  }
  return nil
}

func frame(_ element: AXUIElement) -> [String: Double]? {
  guard let position = attribute(element, kAXPositionAttribute),
    let size = attribute(element, kAXSizeAttribute),
    CFGetTypeID(position) == AXValueGetTypeID(),
    CFGetTypeID(size) == AXValueGetTypeID()
  else { return nil }
  var point = CGPoint.zero
  var extent = CGSize.zero
  AXValueGetValue(position as! AXValue, .cgPoint, &point)
  AXValueGetValue(size as! AXValue, .cgSize, &extent)
  return ["x": Double(point.x), "y": Double(point.y), "width": Double(extent.width), "height": Double(extent.height)]
}

func parent(_ element: AXUIElement) -> AXUIElement? {
  guard let value = attribute(element, kAXParentAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
  return (value as! AXUIElement)
}

func isSecure(_ element: AXUIElement) -> Bool {
  stringAttribute(element, kAXSubroleAttribute) == "AXSecureTextField"
    || stringAttribute(element, kAXRoleAttribute) == "AXSecureTextField"
}

func describe(_ element: AXUIElement) -> [String: Any] {
  let secure = isSecure(element)
  var label: String? = nil
  for name in [kAXTitleAttribute, kAXDescriptionAttribute, "AXPlaceholderValue", kAXHelpAttribute] {
    if let text = stringAttribute(element, name) {
      label = text
      break
    }
  }
  if label == nil && !secure, let value = stringAttribute(element, kAXValueAttribute), value.count <= 120 {
    label = value
  }
  var result: [String: Any] = ["secure": secure]
  if let role = stringAttribute(element, kAXRoleAttribute) { result["role"] = role }
  if let subrole = stringAttribute(element, kAXSubroleAttribute) { result["subrole"] = subrole }
  if let roleDescription = stringAttribute(element, kAXRoleDescriptionAttribute) { result["roleDescription"] = roleDescription }
  if let label { result["label"] = String(label.prefix(160)) }
  if let bounds = frame(element) { result["frame"] = bounds }
  return result
}

func url(from element: AXUIElement) -> String? {
  var current: AXUIElement? = element
  var depth = 0
  while let node = current, depth < 40 {
    if let text = stringAttribute(node, "AXURL"), text.hasPrefix("http") || text.hasPrefix("file") {
      return text
    }
    if stringAttribute(node, kAXRoleAttribute) == kAXWindowRole as String { break }
    current = parent(node)
    depth += 1
  }
  return nil
}

func windowAt(_ x: Double, _ y: Double, excluding: Set<Int32>) -> [String: Any]? {
  let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return nil }
  for info in list {
    guard let pid = info[kCGWindowOwnerPID as String] as? Int32, !excluding.contains(pid) else { continue }
    guard (info[kCGWindowLayer as String] as? Int) == 0 else { continue }
    guard let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
      let bounds = CGRect(dictionaryRepresentation: boundsDict)
    else { continue }
    if (info[kCGWindowAlpha as String] as? Double ?? 1) <= 0.01 { continue }
    guard bounds.contains(CGPoint(x: x, y: y)) else { continue }
    var result: [String: Any] = [
      "pid": pid,
      "windowId": info[kCGWindowNumber as String] as? Int ?? 0,
      "bounds": ["x": Double(bounds.origin.x), "y": Double(bounds.origin.y), "width": Double(bounds.width), "height": Double(bounds.height)],
    ]
    if let owner = info[kCGWindowOwnerName as String] as? String { result["app"] = owner }
    if let title = info[kCGWindowName as String] as? String, !title.isEmpty { result["title"] = title }
    if let running = NSRunningApplication(processIdentifier: pid) {
      if let bundle = running.bundleIdentifier { result["bundleId"] = bundle }
      if let name = running.localizedName { result["app"] = name }
    }
    return result
  }
  return nil
}

func inspect(_ x: Double, _ y: Double, excluding: Set<Int32>) -> [String: Any] {
  guard var window = windowAt(x, y, excluding: excluding) else { return ["found": false] }
  window["found"] = true
  guard AXIsProcessTrusted(), let pid = window["pid"] as? Int32 else { return window }
  let app = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(app, 0.8)
  var hit: AXUIElement?
  if AXUIElementCopyElementAtPosition(app, Float(x), Float(y), &hit) == .success, let element = hit {
    window["element"] = describe(element)
    if let link = url(from: element) { window["url"] = link }
    if window["title"] == nil, let owner = attribute(element, kAXWindowAttribute), CFGetTypeID(owner) == AXUIElementGetTypeID() {
      if let title = stringAttribute(owner as! AXUIElement, kAXTitleAttribute) { window["title"] = title }
    }
  }
  if window["url"] == nil, let focused = attribute(app, kAXFocusedWindowAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID() {
    if let document = stringAttribute(focused as! AXUIElement, kAXDocumentAttribute), document.hasPrefix("http") {
      window["url"] = document
    }
  }
  return window
}

func focused() -> [String: Any] {
  var result: [String: Any] = ["secureInput": IsSecureEventInputEnabled()]
  guard AXIsProcessTrusted() else { return result }
  let system = AXUIElementCreateSystemWide()
  AXUIElementSetMessagingTimeout(system, 0.8)
  if let value = attribute(system, kAXFocusedUIElementAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() {
    let element = value as! AXUIElement
    result["element"] = describe(element)
    var pid: pid_t = 0
    if AXUIElementGetPid(element, &pid) == .success { result["pid"] = pid }
  }
  return result
}

struct WatchedKey {
  let codes: Set<Int64>
  let flag: CGEventFlags
}

func watchedKey(_ name: String) -> WatchedKey? {
  switch name {
  case "fn": return WatchedKey(codes: [Int64(kVK_Function)], flag: .maskSecondaryFn)
  case "AltRight": return WatchedKey(codes: [Int64(kVK_RightOption)], flag: .maskAlternate)
  case "MetaRight": return WatchedKey(codes: [Int64(kVK_RightCommand)], flag: .maskCommand)
  case "ControlRight": return WatchedKey(codes: [Int64(kVK_RightControl)], flag: .maskControl)
  default: return nil
  }
}

final class KeyWatch {
  var key: WatchedKey?
  var name = ""
  var down = false
  var tap: CFMachPort?
  var source: CFRunLoopSource?

  func start(_ name: String) -> String? {
    guard let key = watchedKey(name) else { return "unknown key \(name)" }
    stop()
    self.key = key
    self.name = name
    let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
    let callback: CGEventTapCallBack = { _, type, event, refcon in
      guard let refcon else { return Unmanaged.passUnretained(event) }
      let watch = Unmanaged<KeyWatch>.fromOpaque(refcon).takeUnretainedValue()
      watch.handle(type, event)
      return Unmanaged.passUnretained(event)
    }
    guard let tap = CGEvent.tapCreate(
      tap: .cgSessionEventTap,
      place: .headInsertEventTap,
      options: .listenOnly,
      eventsOfInterest: CGEventMask(mask),
      callback: callback,
      userInfo: Unmanaged.passUnretained(self).toOpaque()
    ) else {
      return "input monitoring is not allowed"
    }
    self.tap = tap
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    self.source = source
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    return nil
  }

  func stop() {
    if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
    if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
    tap = nil
    source = nil
    key = nil
    if down {
      down = false
      emit(["event": "key", "key": name, "down": false])
    }
  }

  func handle(_ type: CGEventType, _ event: CGEvent) {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
      return
    }
    guard let key else { return }
    if type == .keyDown {
      if down { emit(["event": "keyOther"]) }
      return
    }
    let code = event.getIntegerValueField(.keyboardEventKeycode)
    guard key.codes.contains(code) else {
      if down { emit(["event": "keyOther"]) }
      return
    }
    let pressed = event.flags.contains(key.flag)
    if pressed != down {
      down = pressed
      emit(["event": "key", "key": name, "down": pressed])
    }
  }
}

let watch = KeyWatch()

func handle(_ line: String) {
  guard let data = line.data(using: .utf8),
    let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
    let id = request["id"],
    let op = request["op"] as? String
  else { return }
  let excluding = Set((request["excludePids"] as? [Int] ?? []).map { Int32($0) })
  DispatchQueue.main.async {
    switch op {
    case "status":
      reply(id, status())
    case "requestInputMonitoring":
      let granted = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)
      reply(id, ["granted": granted])
    case "requestScreenRecording":
      reply(id, ["granted": CGRequestScreenCaptureAccess()])
    case "requestAccessibility":
      let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
      reply(id, ["granted": AXIsProcessTrustedWithOptions(options)])
    case "inspect":
      guard let x = request["x"] as? Double, let y = request["y"] as? Double else { return fail(id, "x and y are required") }
      reply(id, inspect(x, y, excluding: excluding))
    case "focused":
      reply(id, focused())
    case "watchKey":
      guard let key = request["key"] as? String else { return fail(id, "key is required") }
      if let error = watch.start(key) { fail(id, error) } else { reply(id, ["watching": key]) }
    case "unwatchKey":
      watch.stop()
      reply(id, [:])
    default:
      fail(id, "unknown op \(op)")
    }
  }
}

DispatchQueue.global(qos: .userInitiated).async {
  while let line = readLine(strippingNewline: true) {
    handle(line)
  }
  DispatchQueue.main.async {
    output.sync {}
    exit(0)
  }
}

emit(["event": "ready", "pid": ProcessInfo.processInfo.processIdentifier])
CFRunLoopRun()
