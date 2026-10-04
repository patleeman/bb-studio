# Configured limit visibility follow-up

Verified 2026-10-03 on the iOS 27 simulator with the committed `1f17e01` control unchanged. Ordinary scrolling fully reveals **Configured limit, Automatic**. No production layout repair is justified by these cases.

The earlier [product-row screenshot](../settings-minimal/product-row/settings-configured-limit-accessibility-xxxl.png) showed only partial value visibility. Its passing audit and hittability did not establish full visibility. That original evidence remains unchanged.

## Results

All frames below are in screen points. Each final combined accessibility label is exactly `Configured limit, Automatic`, exists, is hittable, and fits horizontally and vertically inside the tested visible area. Full glyph visibility was separately checked in the named screenshots.

| Device / orientation / text | Final row y range | Conservative visible y range | Ordinary scrolls from opening Settings | Screenshot |
| --- | --- | --- | --- | --- |
| iPhone 18 Pro / portrait / default | 502.3–554.3 | 176–783 | 0 | [default](iphone/settings-default-portrait-fully-visible.png) |
| iPhone 18 Pro / portrait / accessibility XXXL | 342.7–565.3 | 197–783 | 3 | [XXXL](iphone/settings-xxxl-portrait-fully-visible.png) |
| iPad Pro 11-inch M5 / portrait / default | 457–509 | 146–1168 | 0 | [default](ipad/settings-default-portrait-fully-visible.png) |
| iPad Pro 11-inch M5 / portrait / accessibility XXXL | 867.5–961 | 167–1168 | 0 | [XXXL](ipad/settings-xxxl-portrait-fully-visible.png) |
| iPad Pro 11-inch M5 / landscape / default | 457–509 | 146–792 | 0 | [default screen capture](ipad-screen/settings-default-landscape-fully-visible.png) |
| iPad Pro 11-inch M5 / landscape / accessibility XXXL | 514–607.5 | 167–792 | 1 | [XXXL screen capture](ipad-screen/settings-xxxl-landscape-fully-visible.png) |

On iPhone XXXL, the first reachable position was y=644.3–867, behind a tab bar starting at y=791: [partial screenshot](iphone/settings-xxxl-portrait-first-reachable.png), [bounds](iphone/settings-xxxl-portrait-first-reachable-bounds.json). **One further ordinary upward drag** revealed the whole row at y=342.7–565.3, leaving over 225 points before the tab bar. The two preceding drags only brought the row into view. At iPad XXXL landscape, the first reachable frame extended below the screen; one ordinary upward drag revealed it fully.

## Evidence and diagnostic boundaries

The private [diagnostic source](SettingsVisibilityUITests.swift) checks the named combined label, nonempty frame, hittability, full horizontal containment, and full vertical containment below navigation and above the bottom tab bar (with eight-point margins). iPad adaptive navigation exposes Settings as a `Cell`, rather than an iPhone `TabBar` button. This is a test query adaptation, not a product fix.

The final run has six verified device/text/orientation cases: [iPhone log](https://github.com/patleeman/bb-studio/blob/321665bec62f1c351a85b78aee7b532243b63f7d/apps/ios/docs/quality-verification/settings-visibility/iphone/run.log) has two passes and two explicit landscape skips; [iPad log](https://github.com/patleeman/bb-studio/blob/321665bec62f1c351a85b78aee7b532243b63f7d/apps/ios/docs/quality-verification/settings-visibility/ipad/run.log) has four passes. iPhone declares and actually remains portrait-only. [Landscape capture repeat](https://github.com/patleeman/bb-studio/blob/321665bec62f1c351a85b78aee7b532243b63f7d/apps/ios/docs/quality-verification/settings-visibility/ipad-screen/run.log) has two passes. No broad accessibility audit was run or waived, and no global/host limit or setting was changed. Accessibility reachability here means XCTest's exposed named element and hittability; it is not a manual VoiceOver gesture test.

Initial iPad diagnostics failed before opening Settings because they required `app.tabBars.buttons["Settings"]`; their [raw log](https://github.com/patleeman/bb-studio/blob/321665bec62f1c351a85b78aee7b532243b63f7d/apps/ios/docs/quality-verification/settings-visibility/ipad-initial-navigation-failure.log) is retained. Initial `XCUIApplication.screenshot()` landscape images in `ipad/` contain a black band and crop the right edge, despite correct accessibility bounds. They are retained as capture artifacts and **are not visual visibility proof**. Repeating only landscape with `XCUIScreen.main.screenshot()` produced the complete, unmodified screenshots in `ipad-screen/` used above.

## Isolation and reproduction

Follow the [private-copy staged reproduction](../../quality-verification.md), using normal simulator signing so the installed app-group container exists, and only this private diagnostic class. Replace both private fallback constants with `http://127.0.0.1:49486`; seed and read back the actual app and app-group preference containers before any launch. Set runner `BB_QA_SERVER_URL` to that exact origin in a private xctestrun and select only `SettingsVisibilityUITests`. Do not run legacy UI suites.

[source.json](source.json) records the resynced source and unchanged control fingerprint. [prelaunch-isolation.json](prelaunch-isolation.json) records both actual containers and verified staged preferences on each fresh simulator. Private source: `/var/folders/cv/q6nc4gqx0kddgybjp7s817zr0000gn/T/bb-share-review-vhuq54aq/ios`; derived data: `/tmp/bb-share-derived`. Result bundles remain at `/tmp/bb-settings-visibility-{iphone2,ipad3,ipad-screen}.xcresult`. Both owned simulators were shut down and deleted after evidence capture; source/derived data ownership was released to root. No user simulator, physical device, global Xcode selection, production connection, or Electron launch was involved.
