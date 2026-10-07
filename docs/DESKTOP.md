# Desktop apps for Windows and macOS

`noderyx desktop:init` turns your `.noderframe` views into an installable
desktop application: a Windows installer (`.exe`) and a macOS disk image
(`.dmg`), plus an optional Linux AppImage. It uses
[Electron](https://www.electronjs.org/) to draw the window and
[electron-builder](https://www.electron.build/) to package it.

The desktop app ships the same compiled bundle as the
[packaged mobile build](MOBILE.md): clean routes, `.mnoderframe` pages, Cool.css,
and the `Noderyx.native` bridge. A view you write once runs on the web, on
phones, and on the desktop.

## Requirements

- Node.js 20 or later.
- **Windows installer**: build on Windows. (macOS and Linux can build it too
  with Wine installed, but Windows is simpler.)
- **macOS disk image**: build on a Mac. Apple only allows macOS apps to be built
  and signed on macOS. From Windows, use the
  [GitHub Actions workflow](#build-windows-and-macos-from-anywhere).

## Create the desktop app

```bash
npm run desktop:init       # noderyx desktop:init
```

This compiles your views into `platforms/desktop/www`, writes the Electron
project around them, and installs Electron and electron-builder **inside
`platforms/desktop`**. They stay out of your web app's dependencies, so your
server stays small.

## Everyday commands

```bash
noderyx desktop:run                  # Build and open the app in a window
noderyx desktop:package windows      # Windows installer -> platforms/desktop/dist/*.exe
noderyx desktop:package mac          # macOS .dmg and .zip (run on a Mac)
noderyx desktop:package linux        # Linux AppImage
noderyx desktop:package              # Whatever OS you are on
noderyx build:desktop                # Rebuild the bundle only
noderyx desktop:workflow             # Write .github/workflows/desktop.yml
```

Every command rebuilds from your views first, so you never package stale pages.

`build:desktop`, `desktop:run`, and `desktop:package` accept `--app-id`,
`--app-name`, `--entry`, `--views`, `--out`, and `--api-url` to override the
configuration for one run.

### Develop against the live server

To see changes without rebuilding, point the window at your dev server:

```bash
npm run dev                                           # in one terminal
noderyx desktop:run --live-reload=http://localhost:3000   # in another
```

## Configuration

Add a `desktop` block to `noderyx.config.js`. Anything it leaves out (`appId`,
`appName`, `views`, `entry`, `apiUrl`, `data`, `pages`) comes from your `mobile`
block, so most projects only set the window size:

```js
export default {
  desktop: {
    appId: "com.example.myapp",      // reverse domain form
    appName: "My App",
    views: "resources/views",
    entry: "home",
    out: "platforms/desktop",
    apiUrl: process.env.DESKTOP_API_URL ?? null,
    version: null,                   // null = your package.json version

    window: {
      width: 1200,
      height: 800,
      minWidth: 720,
      minHeight: 480,
      resizable: true,
      rememberBounds: true           // reopen at the last size and position
    },

    singleInstance: true,            // a second launch focuses the open window
    devTools: null,                  // null = only while unpackaged
    // Browser permissions the app may grant. Everything else is refused.
    permissions: ["notifications", "clipboard-sanitized-write", "fullscreen"],

    windows: { targets: ["nsis"] },
    mac: { targets: ["dmg", "zip"], category: "public.app-category.productivity" },
    linux: { targets: ["AppImage"], category: "Utility" }
  }
};
```

To let the app use the camera, microphone, or location, add `"media"` or
`"geolocation"` to `permissions`.

### Icon

The first build writes the Noderyx mark to `platforms/desktop/build/icon.png`.
Replace it with your own **1024×1024 PNG**. electron-builder turns it into the
Windows `.ico` and macOS `.icns`, and later builds never overwrite it.

### The API URL

The desktop app has no server of its own. Its pages are files inside the app,
served from the private origin `noderyx://app`. As with the mobile build, set
`apiUrl` to your deployed Noderyx server. The build rewrites server routes to
absolute URLs, and `Noderyx.native.api("/api/...")` resolves against it.

Your server sees requests from the origin `noderyx://app`, so allow that origin
for CORS:

```bash
CORS_ORIGINS=noderyx://app,capacitor://localhost,https://localhost
```

## Detect the desktop in your pages

The bridge tells pages where they are running:

```js
Noderyx.native.isDesktop   // true inside the desktop app
Noderyx.native.platform    // "windows", "macos", or "linux" on the desktop
Noderyx.native.isWindows
Noderyx.native.isMacOS
```

The `<html>` element also gets the `noderyx-desktop` class and a
`data-platform` attribute, so CSS can adapt:

```css
.noderyx-desktop .mobile-only { display: none; }
[data-platform="macos"] .titlebar { padding-left: 80px; }
```

`Noderyx.native.notify()` shows system notifications, and
`Noderyx.native.browser(url)` opens links in the user's default browser.

## Security

The generated app follows Electron's security checklist:

- Pages run sandboxed with context isolation and no Node.js access. The preload
  script exposes only plain values (`window.NoderyxDesktop`), never Electron or
  Node APIs.
- The bundle is served from a private, secure scheme, and requests cannot reach
  files outside it.
- The Content Security Policy from the mobile build still applies: only bundled
  scripts run.
- Links that leave the app open in the system browser instead of the app
  window. Only `http`, `https`, and `mailto` links are opened.
- Permission requests not listed in `permissions` are refused.
- Developer tools are disabled in packaged builds unless `devTools: true`.

`main.cjs` and `preload.cjs` are rewritten on every build, so framework updates
reach your app. Configure the app through `noderyx.config.js`, not by editing
them.

## What to commit

Commit `platforms/desktop/package.json`, `platforms/desktop/package-lock.json`,
and `platforms/desktop/build/icon.png`. The generated `.gitignore` already
excludes `www/`, `node_modules/`, and `dist/`.

`package.json` in that folder is merged on every build. Noderyx manages the
name, version, entry point, and `build` section. Dependencies and scripts you
add are kept.

## Build Windows and macOS from anywhere

You cannot build a macOS app on Windows, but GitHub can build it for you:

```bash
noderyx desktop:workflow
```

This writes `.github/workflows/desktop.yml`. It packages the Windows installer on
a Windows runner and the macOS disk image on a macOS runner. Run it from the
**Actions** tab, or push a tag such as `v1.0.0`. The installers are attached to
the run as downloadable artifacts.

## Code signing

Unsigned builds work, but both operating systems warn users before opening
them. Windows SmartScreen shows "Windows protected your PC", and macOS
Gatekeeper refuses to open a downloaded app until the user allows it in System
Settings.

To sign, give electron-builder your certificates through environment variables.
In the workflow, add them as repository secrets:

| Secret | Purpose |
| --- | --- |
| `CSC_LINK` | Base64 `.p12`/`.pfx` certificate (Windows code signing or Apple Developer ID) |
| `CSC_KEY_PASSWORD` | The certificate's password |
| `APPLE_ID` | Apple ID used to notarize the macOS app |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Your Apple Developer team ID |

On your own machine, set the same variables before `noderyx desktop:package`.
See electron-builder's [code signing guide](https://www.electron.build/code-signing)
for details.

## Troubleshooting

**`Electron is not installed for the desktop app yet`.** Run
`noderyx desktop:init`.

**The window never opens and Electron prints a Node.js version.** Something set
`ELECTRON_RUN_AS_NODE=1`, which Electron-based editors sometimes pass to child
processes. Noderyx removes it for `desktop:run` and `desktop:package`. If you
run `npx electron .` yourself, unset it first.

**API calls fail with CORS errors.** Add `noderyx://app` to `CORS_ORIGINS` on
your server, and check that `apiUrl` is set.
