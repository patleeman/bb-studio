# Studio Applets app

**Experimental.** The signed macOS menu-bar app that runs Studio Applets:
small native apps your agents write as plain folders in
`~/.bb-studio/applets/<id>/`. The BB side is the
[Studio Applets plugin](../../packages/bb-studio-applets/), which writes
applet folders, keeps approvals, and serves the API applets use to reach BB.

## How it works

- **One signed app, many applets.** An applet is a `manifest.json` plus HTML,
  JavaScript and CSS. The app loads it from disk, so a new applet needs no
  build and no code signing. Changing a file reloads the applet.
- **API only.** Applet pages run with `contextIsolation`, `sandbox` and no
  Node. They get `window.studio` and nothing else. Each call is checked in
  the main process against the capabilities approved for that applet.
- **Approval first.** An applet starts only when every capability its
  manifest asks for is approved in the plugin's settings
  (`~/.bb-studio/applets/grants.json`).
- **BB through the plugin.** `studio.bb.*` calls go to the applets plugin's
  RPC API on the local BB server, or, for an approved
  `bb.rpc:<plugin>:<method>`, to that plugin's method. Applets that can read
  threads get `bb:threads` pushes every few seconds when something changes.
- **BB's look.** `studio://kit/boot.js` loads BB's compiled stylesheet and
  the active theme, and follows the system's light or dark mode. Tailwind's
  browser build adds classes BB's sheet doesn't include, with BB's tokens
  (`bg-background`, `text-muted-foreground`, `border-border`, …).
  `studio://kit/ui.js` exports React, `html` (htm templates, JSX without a
  build), `render`, and the Studio kit's components (`Button`, `Input`,
  `Select`, `Dialog`, `Tooltip`, `Icon` with Lucide names, `cn`, …).
- **Logs.** Console output and API errors go to
  `~/.bb-studio/applets/.logs/<id>.log`, which `applets_logs` and
  `bb applets logs <id>` read.

## Writing an applet

`examples/hud` is the Thread HUD: an always-on-top overlay of the threads
that need you, with replies. The smallest applet:

```html
<!-- index.html -->
<script type="module" src="studio://kit/boot.js"></script>
<script type="module" src="app.js"></script>
```

```js
// app.js — inline scripts are blocked by the applet CSP, so use files.
import { html, render, Button } from "studio://kit/ui.js";
render(html`<div className="p-4"><${Button} onClick=${() => studio.notify({ title: "Hi" })}>Say hi<//></div>`);
```

`window.studio` (API 1): `applet`, `log`, `on(event, fn)`,
`storage.get/set`, `window.open/close/hide/toggle/setBounds/setClickThrough/setOpacity`,
`tray.set`, `notify`, `clipboard.readText/writeText`, `fs.read/write/list`
(the applet's `data/` folder), `open(url)`,
`bb.threads.list/get/tell`, `bb.open(threadId)`, `bb.rpc(plugin, method, input)`.
Events: `shortcut:<name>`, `notify:action`, `window:shown|hidden|focus`,
`tray:click`, `bb:threads`, `bb:connected`, `bb:disconnected`.

## Develop

```sh
cd apps/applets
npm install
npm start                                   # build and run from source
STUDIO_APPLETS_DIR=/tmp/applets npm start   # use another applets folder
npm test && npm run typecheck
```

`STUDIO_APPLETS_CAPTURE=<file.png>` saves the first applet window as a PNG
after a few seconds and quits, for screenshots and smoke tests.
`BB_SERVER_URL` points it at another BB, such as a staged one.

## Build, sign and notarize

```sh
npm run dist             # universal .zip and .dmg in release/
npm run dist:unsigned    # no signing, for local tries
```

`dist` signs with `Developer ID Application: patrick lee (3753DAN98U)` from
the login keychain and notarizes with the `studio-applets` notarytool
keychain profile (`APPLE_KEYCHAIN_PROFILE` overrides it). Check a build with
`spctl --assess --type execute -vv "release/mac-universal/Studio Applets.app"`,
which should say `source=Notarized Developer ID`.

Not done yet: an app icon and tray icon, GitHub releases, installing and
updating from the plugin's settings page, and the plugin's host daemon
pushing BB events instead of the app polling.
