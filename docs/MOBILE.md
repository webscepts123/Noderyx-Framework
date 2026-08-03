# Packaged web app for Android and iOS

> **Most projects want [native widgets](NATIVE.md) instead.** `noderyx
> native:init` compiles the same views into real platform widgets with no
> WebView and no web engine to boot. This page documents the other path.

`noderyx mobile:init` wraps the **web** build in a native shell. Your pages run
as Cool.css in a WebView, with native plugin access around them.

Choose this path when you need a CSS feature the native translation does not
cover â€” gradients, blur, complex animation â€” and are willing to pay for a
WebView starting up.

| | [`native:init`](NATIVE.md) | `mobile:init` (this page) |
| --- | --- | --- |
| Rendering | Platform widgets | Cool.css in a WebView |
| Startup | Native | Waits for the WebView |
| Lists | Virtualized | DOM |
| Styling | The translated subset | All of Cool.css |

Both read the same `.noderframe` files, so moving between them costs nothing.

> For a standalone, fast application with **no WebView**, use the native mobile
> builder instead: `noderyx mobile:builder`. It reads dedicated screens from
> `resources/mobile`, compiles them to React Native components, and emits real
> Android/iOS widgets under `platforms/native`. Website views remain completely
> separate in `resources/views`.

```powershell
noderyx mobile:builder --no-install  # generate without installing dependencies
noderyx mobile:make portfolio       # add resources/mobile/portfolio.noderframe
noderyx build:native --views=resources/mobile
noderyx native:run android
```

The rest of this page documents the optional Capacitor/WebView compatibility
target. See [Native Android and iOS](NATIVE.md) for the standalone renderer.

## Clean routes

Link pages with normal extension-free paths in every `.noderframe` view:

```noderframe
a href="/profile" "Profile"
a href="/settings/account" "Account settings"
```

Do not add `.html`. Noderyx derives routes from the `.noderframe` filenames and
uses the same paths on the web, in the Capacitor mobile app, and in the native
navigator. The mobile bundle keeps compiled pages as `.mnoderframe`
payloads, and the navigation runtime maps clean routes to them automatically. It also handles
tap transitions, browser history, device back navigation, focus, and reduced
motion preferences.

Source views use `.noderframe`; `.mnoderframe` is reserved for generated mobile
route payloads. The entry and offline fallback are also `.mnoderframe`, so the
generated mobile page collection contains no `.html` documents.

Do not write or edit `.mnoderframe` files. They are machine-readable build
artifacts under `platforms/mobile/www` and are hidden in VS Code by default.
Write the readable source in `resources/views/*.noderframe`, then run
`npm run build:mobile`. You can reveal excluded files from VS Code's Explorer
menu when debugging generated output.

## Requirements

- **Android**: [Android Studio](https://developer.android.com/studio) with an
  SDK platform and either a device in USB debugging mode or an emulator.
- **iOS**: macOS with Xcode and CocoaPods. Windows and Linux can generate and
  edit the iOS project, but only macOS can compile and sign the binary.

## Create the mobile projects

```powershell
npm run mobile:init
```

That single command builds the web bundle, installs Capacitor and the plugins
the Noderyx bridge uses, and generates the native `android/` and `ios/`
projects. Limit it to one platform with `noderyx mobile:init android`.

## Everyday commands

```bash
noderyx build:mobile          # Compile views into mobile/www
noderyx mobile:sync           # Rebuild, then copy into the native projects
noderyx mobile:run android    # Build, sync, and launch on a device or emulator
noderyx mobile:run ios        # The same on macOS
noderyx mobile:open android   # Open the project in Android Studio
noderyx mobile:open ios       # Open the project in Xcode
```

`build:mobile` accepts `--app-id`, `--app-name`, `--entry`, `--views`, `--out`,
and `--api-url` when you want to override the configuration file for one run.

## Configuration

Add a `mobile` block to `noderyx.config.js`:

```js
export default {
  mobile: {
    appId: "com.example.myapp",   // reverse domain form, required by both stores
    appName: "My App",
    views: "resources/views",
    public: "public",
    entry: "home",                // the view that becomes index.html
    out: "platforms/mobile",                // the bundle lands in mobile/www
    apiUrl: process.env.MOBILE_API_URL ?? null,
    data: { siteName: "My App" }, // render data shared by every page
    pages: {                      // extra render data per view
      "dashboards/admin": { title: "Admin" }
    },
    exclude: ["generated"],       // public/ entries to keep out of the bundle
    liveReloadUrl: null,
    splashDuration: 1200
  }
};
```

### The API URL matters

A packaged app has no server of its own. Its pages are files inside the app, so
a link or `fetch` to `/api/users` resolves against the app shell and fails.

Set `apiUrl` to the address of your deployed Noderyx server. The build then
rewrites every server route to an absolute URL, and `Noderyx.native.api()`
resolves relative paths the same way:

```js
const users = await Noderyx.native.api("/api/users");
await Noderyx.native.api("/api/users", { method: "POST", body: { email } });
```

During development point it at your machine on the local network:

```bash
noderyx build:mobile --api-url=http://192.168.1.10:3000
```

Android blocks plaintext HTTP by default. Use HTTPS, or add a network security
configuration in `android/app/src/main/res/xml/` for local testing.

### The API server must allow the app's origin

A packaged build runs from `capacitor://localhost` (iOS) or `https://localhost`
(Android), so every API call is cross-origin. Your Noderyx server refuses those
by default â€” allowlist them explicitly:

```js
const app = noderyx({
  views: "./views",
  security: {
    cors: {
      origins: ["capacitor://localhost", "https://localhost"],
      credentials: true
    }
  }
});
```

The bundle also ships a Content-Security-Policy in each page, since a packaged
app has no server to send headers. `build:mobile` adds your `apiUrl` to its
`connect-src` automatically; anything else you call must be added to
`bundleCsp` in [src/mobile.js](../framework/mobile.js). The policy forbids inline
scripts, so `window.NODERYX_API_BASE` and the service worker registration ship
as `public/noderyx-boot.js` rather than inline tags.

See [security](SECURITY.md) for the rest.

## The native bridge

`public/noderyx-native.js` is injected into every page. Every call works in a
browser and switches to the matching native plugin inside the app, so one
implementation covers web, Android, and iOS.

```js
await Noderyx.native.ready();

Noderyx.native.isNative     // true inside the Android or iOS build
Noderyx.native.platform     // "android" | "ios" | "web"
Noderyx.native.isStandalone // true when installed as a PWA

await Noderyx.native.camera();                    // camera, or a file picker on the web
await Noderyx.native.share({ title, text, url }); // share sheet, or navigator.share
await Noderyx.native.location();                  // GPS, or the geolocation API
await Noderyx.native.haptics("light");            // taptics, or navigator.vibrate
await Noderyx.native.notify({ title, body });     // local notification
await Noderyx.native.network();                   // { connected, connectionType }
await Noderyx.native.browser(url);                // in-app browser

await Noderyx.native.storage.set("token", value); // Preferences, or localStorage
await Noderyx.native.storage.get("token");
await Noderyx.native.storage.remove("token");

Noderyx.native.on("network", (status) => { ... });
Noderyx.native.on("appState", ({ isActive }) => { ... });
```

The bridge also handles the Android hardware back button, hides the splash
screen once the page is ready, and applies the status bar and keyboard styling.

## Styling for phones

`applyChrome()` sets `data-platform` and adds `noderyx-native` or
`noderyx-standalone` to `<html>`, which Cool.css uses:

```text
main.cool-safe-area           Respect the notch and home indicator on all sides
header.cool-safe-top          Safe-area padding at the top only
nav.cool-tabbar               Fixed bottom tab bar with safe-area padding
a.cool-web-only               Hidden inside the native build
a.cool-native-only            Shown only inside the native build
```

The insets are also available as `--cool-safe-top`, `--cool-safe-right`,
`--cool-safe-bottom`, and `--cool-safe-left` for your own rules. Touch targets
grow to 44px automatically on coarse pointers.

An app-style tab bar in `.noderframe`:

```text
nav.cool-tabbar aria-label="Main"
  a href="/" aria-current="page"
    span.cool-tabbar-icon "âŒ‚"
    span "Home"
  a href="/search"
    span.cool-tabbar-icon "âŒ•"
    span "Search"
  a href="/profile"
    span.cool-tabbar-icon "â—"
    span "You"
```

## Installable on the web too

The Noderyx server serves `/manifest.webmanifest` and `/sw.js`, and injects the
mobile head tags into every rendered page. Visitors on Android and iOS can add
your site to the home screen and it opens without browser chrome, works offline,
and shows an offline page when the network drops.

Turn it off, or change the details, when creating the app:

```js
const app = noderyx({ views: "./views", public: "./public", pwa: false });

const app = noderyx({
  views: "./views",
  pwa: { name: "My App", themeColor: "#7C5CFF", orientation: "any", version: "3" }
});
```

Raise `version` whenever you deploy so installed clients discard the old cache.

Prompt the visitor to install:

```js
if (Noderyx.native.canInstall) await Noderyx.native.install();
```

## Icons and splash screens

Launcher artwork is generated, so nothing binary needs to be committed. The
build writes `platforms/mobile/www/public/icons/`:

| File | Used by |
| --- | --- |
| `icon-192.png`, `icon-512.png` | Web manifest, Android |
| `icon-maskable-512.png` | Android adaptive icons |
| `apple-touch-icon.png` | iOS home screen |
| `splash.png` | Launch screen |

Replace any of them with your own artwork at the same size and path. The build
never overwrites a file that already exists.

To push new artwork into the native projects:

```bash
npm install --save-dev @capacitor/assets
npx capacitor-assets generate --iconBackgroundColor "#090B14"
```

## Shipping

**Android** â€” open the project, then *Build â†’ Generate Signed Bundle / APK* and
choose *Android App Bundle* for Google Play:

```bash
noderyx mobile:open android
```

Version numbers live in `android/app/build.gradle` (`versionCode`, `versionName`).

**iOS** â€” on macOS, open the workspace, set your team under *Signing &
Capabilities*, then *Product â†’ Archive*:

```bash
noderyx mobile:open ios
```

Version numbers live in `ios/App/App/Info.plist`.

Both stores require a privacy policy URL, and iOS requires a usage description
for every permission you request. Add them to `Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Take photos to attach to your posts.</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>Show places near you.</string>
```

Android permissions go in `android/app/src/main/AndroidManifest.xml`.

## Live reload on a device

Serve the site on your network and let the app load from it:

```bash
noderyx serve --host=0.0.0.0
noderyx build:mobile --live-reload=http://192.168.1.10:3000
noderyx mobile:run android
```

Remove `--live-reload` and rebuild before shipping, or the store build will
point at your laptop.

## What runs where

| | Web | Installed PWA | Android / iOS build |
| --- | --- | --- | --- |
| `.noderframe` views | Yes | Yes | Yes |
| Cool.css | Yes | Yes | Yes |
| Controllers, models, migrations | Yes | Yes | Through `apiUrl` |
| Offline | No | Yes | Yes |
| Camera, GPS, haptics, notifications | Where the browser allows | Where the browser allows | Native |
| App store distribution | No | No | Yes |
