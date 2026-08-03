# Native Android and iOS

This is the recommended mobile builder when the app must be independent from
the website. It does not ship HTML, Cool.css, a browser engine, or a WebView.
Noderyx translates the supported Cool.css class names at build time and emits
plain React Native screens using platform widgets.

Keep mobile screens in `resources/mobile` and website pages in
`resources/views`:

```powershell
noderyx mobile:builder
noderyx mobile:make settings
noderyx native:run android
```

`noderyx native:init` compiles your `.noderframe` views into a real Android and
iOS application. Screens draw platform widgets â€” `View`, `Text`, `Pressable`,
`Image`, `FlatList`. **There is no WebView, no HTML, and no CSS on the device.**

```bash
noderyx native:init          # compile the views and scaffold the app
noderyx native:run android   # build and launch on a device or emulator
noderyx native:run ios       # the same on macOS
```

## Compiled, not interpreted

Everything a screen needs is resolved while you build, not while the user waits:

| Resolved at build time | Consequence on the device |
| --- | --- |
| Element â†’ native widget | No lookup table, no DOM |
| `{{placeholder}}` â†’ JavaScript expression | No template parsing |
| Loop and component variables â†’ direct property access | `post?.title`, not a dictionary lookup |
| Class names â†’ flattened style objects | A re-render allocates nothing |

A view like this:

```text
component PostCard(post)
  article.cool-card
    h3 "{{post.title}}"
    a.cool-btn href="/post" "Read more"

main.cool-container
  h1 "{{siteName}}"
  if !posts
    p.cool-muted "Nothing published yet."
  list post in posts
    PostCard post="{{post}}"
```

compiles to this â€” which is what actually ships:

```jsx
const PostCard = React.memo(function PostCard({ data = {}, post, navigate, ... }) {
  return (
    <View style={s.articleCoolCard}>
      <Text style={s.h3}>{`${str(post?.title)}`}</Text>
      <Pressable style={s.aCoolBtn} onPress={() => navigate("/post")} accessibilityRole="link">
        <Text style={s.linkText}>{"Read more"}</Text>
      </Pressable>
    </View>
  );
});

function Feed({ data = {}, actions = {}, navigate = link }) {
  return (
    <View style={s.screen}>
      <View style={s.mainCoolContainer}>
        <Text style={s.h1}>{`${value(data, "siteName")}`}</Text>
        {!truthy(read(data, "posts")) ? (<>
          <Text style={s.pCoolMuted}>{"Nothing published yet."}</Text>
        </>) : null}
        <FlatList data={items(read(data, "posts"))} keyExtractor={keyFor} removeClippedSubviews
          initialNumToRender={8} windowSize={7}
          renderItem={({ item: post }) => (<PostCard data={data} post={post} navigate={navigate} />)} />
      </View>
    </View>
  );
}

export default React.memo(Feed);
```

Note `post?.title` â€” inside the component, `post` is a real JavaScript variable.
The compiler tracked the scope, so nothing is looked up by name at runtime.

## The language

The same constructs work on the web and on the device.

### Conditions

```text
if user.name
  p "Welcome back, {{user.name}}."
else if guest
  p "Browsing as a guest."
else
  a.cool-btn href="/login" "Sign in"
```

A condition is a path, optionally negated, optionally compared:

```text
if !posts             // false when missing, empty, or an empty list
if status == "live"
if role != "admin"
```

Empty arrays are falsy, so `if !posts` is the empty-state check you want.

### Loops

Two forms, because the choice matters on a phone:

```text
for tag in tags           // renders inline â€” for short, known lists
  span.cool-badge "{{tag}}"

list post in posts        // virtualized FlatList â€” for data of any size
  PostCard post="{{post}}"
```

`list` mounts only the rows on screen. A screen containing a `list` is not
wrapped in a `ScrollView`, because nesting the two would mount every row and
throw the virtualization away.

Both bind an index:

```text
for tag, position in tags
  span "{{position}}: {{tag}}"
```

Keys come from `item.id`, `item.key`, or `item._id` when present, and the index
otherwise.

### Components

```text
component PostCard(post, tone)
  article.cool-card
    h3 "{{post.title}}"
    p.cool-muted "{{post.excerpt}}"

list post in posts
  PostCard post="{{post}}" tone="warm"
```

A capitalised name is a component. A prop that is exactly one placeholder passes
the **value** â€” objects and arrays survive â€” while anything else is interpolated
as text. Components compile to `React.memo`'d components, so a row that has not
changed does not re-render. Screen data stays visible inside them, and recursion
is reported rather than left to hang.

## What is generated

```text
native/
  App.jsx        Entry point: screen map, startup data, status bar
  Navigator.jsx  Stack navigation with animated transitions â€” no dependencies
  native.js      Camera, location, storage, share, notifications, haptics
  runtime.js     The eight helpers compiled screens call
  styles.js      Style combinations, flattened once at load
  theme.js       Design tokens â€” the one file to edit
  home.jsx       One memoized component per view
  errors/404.jsx
  assets/        Generated icon, adaptive icon, and splash art
  app.json  package.json  index.js  babel.config.js
```

Everything except `theme.js` and the project files is regenerated on every
build. Keep your own code in separate modules.

## Element mapping

| `.noderframe` | React Native |
| --- | --- |
| `div`, `main`, `section`, `article`, `header`, `footer`, `nav`, `form`, `ul`, `ol` | `View` |
| `h1`, `h2`, `h3`, `p`, `span`, `strong`, `code` | `Text` |
| `a` | `Pressable`, `accessibilityRole="link"` |
| `button` | `Pressable`, `accessibilityRole="button"` |
| `img` | `Image` with `source={{ uri }}` |
| `input`, `textarea` | `TextInput` |
| `li`, `label` | `Text` alone, `View` when they contain elements |
| `list` | `FlatList` |
| `head`, `meta`, `link`, `script` | Skipped |

`aria-label` and `alt` become `accessibilityLabel`, `id` becomes `testID`,
`type="email"` sets the keyboard, `type="password"` sets `secureTextEntry`, and
`disabled` disables the control. Anything without an equivalent is **reported,
not silently dropped**:

```text
2 elements need attention:
  checkout: Line 31: <select> has no native primitive; the options render as a list.
  errors/404: Line 20: onclick="history.back()" became actions["button"]
```

## Screen props

```jsx
<Home
  data={{ siteName: "Noderyx", posts }}   // fills {{placeholders}}
  navigate={(href) => ...}                 // links; the navigator supplies this
  actions={{ save: () => ... }}            // handlers, keyed by name or id
  onChange={(name, text) => ...}           // text input changes
/>
```

`export const title = (data) => ...` comes from the view's `<title>`, so a
navigation bar can label the screen.

## Navigation

`Navigator.jsx` is a stack with animated transitions and no dependencies. It
resolves `href="/about"`, `"/about.html"`, and `"/"` to screens, so the same
views link correctly on both targets. External URLs open in the system browser.
The Android hardware back button pops the stack.

Screens are statically imported, so pushing one costs a render, not a load.

Replace it with React Navigation or Expo Router when you need tabs, modals, or
deep links â€” the screens are ordinary components and need no changes.

## Styling

`theme.js` holds one entry per tag and Cool.css class your views use. Known
classes arrive filled in; the rest start empty:

```js
export const theme = {
  coolBtn: { alignItems: "center", backgroundColor: "#7C5CFF", borderRadius: 999, ... },
  coolBrand: {},   // fill this in
};
```

`styles.js` composes them **once when the module loads**:

```js
export const s = {
  mainCoolContainer: flatten(theme.main, theme.coolContainer)
};
```

That is why a re-render allocates nothing: `style={s.mainCoolContainer}` passes
an object that already exists, instead of building `[a, b]` every frame.

Class names are camel-cased â€” `cool-error-card` becomes `coolErrorCard`. Editing
`theme.js` updates every screen, and regenerating never overwrites it.

## Native features

`native.js` exposes the same API as the web bridge, so app code moves between
targets unchanged:

```js
import native from "./native";

await native.camera();                     // expo-image-picker
await native.location();                   // expo-location
await native.share({ title, url });        // the system share sheet
await native.haptics("light");             // expo-haptics, or Vibration
await native.notify({ title, body });      // expo-notifications
await native.storage.set("token", value);  // AsyncStorage, or memory
const data = await native.api("/api/me");  // JSON against your Noderyx server
```

Modules are loaded lazily, so install only what you use:

```bash
npx expo install expo-image-picker expo-location expo-haptics
npx expo install expo-notifications expo-web-browser
npx expo install @react-native-async-storage/async-storage
```

## Talking to your server

The app has no server of its own. Point it at yours:

```js
// noderyx.config.js
export default {
  native: {
    appId: "com.example.myapp",
    appName: "My App",
    views: "resources/views",
    out: "platforms/native",
    entry: "home",
    apiUrl: process.env.MOBILE_API_URL
  }
};
```

`App.jsx` fetches `/api/app` once at startup and merges the result into the
screen data. The first frame draws immediately from whatever you passed in, so
the app is never blank while that request is in flight.

Your Noderyx server must allow the app's origin â€” see
[security](SECURITY.md#cors-and-the-mobile-app).

## Shipping

```bash
cd native
npx expo prebuild            # generate the android/ and ios/ projects
npx expo run:android         # or open android/ in Android Studio
```

Version numbers live in `app.json`. For Google Play, build an app bundle from
Android Studio; for the App Store, archive from Xcode on macOS.

Icons and splash art are generated into `native/assets/`. Replace them with your
own at the same paths â€” the build never overwrites a file that already exists.

## Current limits

- `select` has no React Native primitive; its options render as a list.
- Inline `onclick` handlers become entries in the `actions` prop.
- Cool.css translation covers layout, type, buttons, cards, and inputs.
  Gradients, blur, and CSS animation have no StyleSheet equivalent.
- The navigator is a stack. Tabs and modals mean bringing your own.

## The other mobile path

[MOBILE.md](MOBILE.md) documents `noderyx mobile:init`, which packages the
**web** build inside a native shell. It is still supported and still ships to
both stores, but it renders Cool.css in a WebView.

| | `native:init` | `mobile:init` |
| --- | --- | --- |
| Rendering | Platform widgets | Cool.css in a WebView |
| Startup | Native, no web engine to boot | Waits for the WebView |
| Scrolling and lists | Virtualized `FlatList` | DOM |
| Styling | The translated subset | All of Cool.css |
| Views | Used as-is | Used as-is |

Both read the same `.noderframe` files. Use `native:init` unless you need a CSS
feature the translation does not cover.
