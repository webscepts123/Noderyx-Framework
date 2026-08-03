import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { parse } from "./compiler.js";
import { noderyxIcon, noderyxSplash } from "./icons.js";
import { renderNative } from "./renderers/native.js";

/**
 * Build a native Android and iOS application from `.noderframe` views.
 *
 * Screens are compiled to React Native components at build time and drawn with
 * real platform widgets. There is no WebView, no HTML, and no template parsing
 * at runtime â€” a screen is a plain JavaScript module by the time it ships.
 */

const VIEW_EXTENSIONS = [".noderframe", ".untitled"];

export const NATIVE_DEFAULTS = {
  views: "views",
  out: "native",
  entry: "home",
  appId: "com.noderyx.app",
  appName: "Noderyx",
  scroll: true
};

// Cool.css translated into React Native style objects. Classes that are not
// listed still get an entry, so a designer can fill them in one place.
const COOL_STYLES = {
  screen: { flex: 1, backgroundColor: "#090B14" },
  text: { color: "#F3F3FA", fontSize: 16, lineHeight: 24 },
  placeholder: { color: "#A1A5B8" },

  h1: { color: "#F3F3FA", fontSize: 34, fontWeight: "700", lineHeight: 40, marginBottom: 12 },
  h2: { color: "#F3F3FA", fontSize: 26, fontWeight: "700", lineHeight: 32, marginBottom: 10 },
  h3: { color: "#F3F3FA", fontSize: 20, fontWeight: "600", lineHeight: 26, marginBottom: 8 },
  p: { color: "#C7CAD6", fontSize: 16, lineHeight: 24, marginBottom: 12 },
  span: { color: "#F3F3FA", fontSize: 16 },
  strong: { color: "#F3F3FA", fontSize: 16, fontWeight: "700" },
  code: { color: "#22D3EE", fontFamily: "Courier", fontSize: 14 },
  a: { alignItems: "center", flexDirection: "row", gap: 6 },
  linkText: { color: "#7C5CFF", fontSize: 16 },
  button: { alignItems: "center", flexDirection: "row", gap: 6, justifyContent: "center" },
  buttonText: { color: "#F3F3FA", fontSize: 16, fontWeight: "600" },
  li: { color: "#C7CAD6", fontSize: 16, lineHeight: 24, marginBottom: 6 },
  label: { color: "#A1A5B8", fontSize: 13, marginBottom: 6 },
  img: { width: "100%", height: 200, borderRadius: 16 },
  input: {
    backgroundColor: "#161928",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    borderWidth: 1,
    color: "#F3F3FA",
    fontSize: 16,
    marginBottom: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  textarea: { minHeight: 120, textAlignVertical: "top" },

  coolContainer: { paddingHorizontal: 20, paddingVertical: 12, width: "100%" },
  coolStack: { flexDirection: "column", gap: 12 },
  coolRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 12 },
  coolHero: { paddingVertical: 32 },
  coolCard: {
    backgroundColor: "#161928",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 16,
    padding: 20
  },
  coolBtn: {
    alignItems: "center",
    backgroundColor: "#7C5CFF",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 22,
    paddingVertical: 12
  },
  coolBtnSmall: { minHeight: 40, paddingHorizontal: 16, paddingVertical: 8 },
  secondary: { backgroundColor: "transparent", borderColor: "rgba(255,255,255,0.16)", borderWidth: 1 },
  coolBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(124,92,255,0.14)",
    borderRadius: 999,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 6
  },
  coolMuted: { color: "#A1A5B8" },
  coolLead: { color: "#C7CAD6", fontSize: 18, lineHeight: 27 },
  coolEyebrow: { color: "#22D3EE", fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase" },
  coolCaption: { color: "#A1A5B8", fontSize: 13 },
  coolGradientText: { color: "#22D3EE" },
  coolSection: { paddingVertical: 28 },
  coolSectionHeading: { marginBottom: 20 },
  coolMobileBody: { flex: 1 },
  coolMobileShell: { flex: 1 },
  coolAppbar: {
    alignItems: "center",
    borderBottomColor: "rgba(255,255,255,0.1)",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 60,
    paddingHorizontal: 18,
    paddingVertical: 10
  },
  coolMobileContent: { flex: 1, paddingHorizontal: 18, paddingVertical: 20 },
  coolMobileGrid: { gap: 12 },
  coolIconBtn: {
    alignItems: "center",
    backgroundColor: "#161928",
    borderRadius: 12,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  coolSafeTop: {},
  coolFeatureGrid: { flexDirection: "column", gap: 16 },
  coolChecklist: { gap: 8, marginBottom: 16 },
  coolFooter: { borderTopColor: "rgba(255,255,255,0.1)", borderTopWidth: 1, paddingVertical: 24 },
  coolTabbar: {
    backgroundColor: "#0E1120",
    borderTopColor: "rgba(255,255,255,0.1)",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 10
  }
};

async function collectViews(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await collectViews(path));
    else if (entry.isFile() && VIEW_EXTENSIONS.includes(extname(path))) found.push(path);
  }
  return found;
}

export function themeModule(keys) {
  const entries = [...new Set(keys)].sort()
    .map((key) => `  ${key}: ${JSON.stringify(COOL_STYLES[key] ?? {})}`);

  return `// Generated by Noderyx â€” the Cool.css design tokens as React Native styles.
// This is the one file to edit. Classes without a translation start empty.
export const theme = {
${entries.join(",\n")}
};

export const palette = {
  violet: "#7C5CFF",
  cyan: "#22D3EE",
  lime: "#B7F34A",
  night: "#090B14",
  surface: "#161928",
  text: "#F3F3FA",
  muted: "#A1A5B8"
};
`;
}

/**
 * Style combinations are flattened once when the module loads, so rendering a
 * screen never builds a style array.
 */
export function stylesModule(styles) {
  const entries = [...styles.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, parts]) => {
      const references = parts.map((part) => `theme.${part}`);
      return `  ${key}: ${references.length === 1 ? references[0] : `flatten(${references.join(", ")})`}`;
    });

  return `// Generated by Noderyx. Every combination is flattened at load time, so a
// re-render allocates nothing. Edit theme.js, not this file.
import { StyleSheet } from "react-native";
import { theme } from "./theme";

const flatten = (...parts) => StyleSheet.flatten(parts);

export const s = {
${entries.join(",\n")}
};

export const ripple = { color: "rgba(255,255,255,0.12)", borderless: false };
export { theme };
`;
}

const RUNTIME_MODULE = `// Generated by Noderyx. The handful of helpers compiled screens call.
import { Linking } from "react-native";

const EMPTY = [];

/** Read a dotted path out of the screen data. */
export function read(data, path) {
  const dot = path.indexOf(".");
  if (dot < 0) return data?.[path];

  let current = data;
  for (const key of path.split(".")) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

/** The same lookup, as text for display. */
export function value(data, path) {
  return str(read(data, path));
}

export function str(input) {
  return input == null ? "" : String(input);
}

export function truthy(input) {
  return Array.isArray(input) ? input.length > 0 : Boolean(input);
}

export function same(input, expected) {
  return str(input) === String(expected);
}

/** Loops accept anything; only a real array renders rows. */
export function items(input) {
  return Array.isArray(input) ? input : EMPTY;
}

export function keyFor(item, index) {
  if (item != null && typeof item === "object") {
    const key = item.id ?? item.key ?? item._id;
    if (key != null) return String(key);
  }
  return String(index);
}

/** Fallback for links when no navigator is mounted. */
export function link(href) {
  const target = String(href ?? "");
  if (/^[a-z][\\w+.-]*:/i.test(target)) Linking.openURL(target).catch(() => {});
}
`;

const NAVIGATOR_MODULE = `// Generated by Noderyx â€” a stack navigator with no dependencies.
// Screens are already imported, so pushing one costs a render, not a load.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Dimensions, Easing, Linking, StyleSheet, View } from "react-native";
import { theme } from "./theme";

const DURATION = 260;

function Screen({ screen, data, entering, onSettled, navigate, actions }) {
  const width = Dimensions.get("window").width;
  const offset = useRef(new Animated.Value(entering ? width : 0)).current;

  useEffect(() => {
    if (!entering) return undefined;
    const animation = Animated.timing(offset, {
      toValue: 0,
      duration: DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    });
    animation.start(onSettled);
    return () => animation.stop();
  }, [entering, offset, onSettled]);

  const Component = screen.component;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: offset }] }]}>
      <Component data={data} navigate={navigate} actions={actions} />
    </Animated.View>
  );
}

/**
 * Resolve a href to a route name. "/", "/about", and "/about.html" all work,
 * so the same views link correctly on the web and on a device.
 */
export function routeFor(href, screens, entry) {
  const target = String(href ?? "").split("#")[0].split("?")[0];
  if (!target || target === "/") return entry;
  const name = target.replace(/^\\//, "").replace(/\\.html$/, "").replace(/\\/$/, "");
  return screens[name] ? name : null;
}

export default function Navigator({ screens, entry, data = {}, actions = {} }) {
  const [stack, setStack] = useState([entry]);
  const [animating, setAnimating] = useState(false);

  const navigate = useCallback((href) => {
    if (/^[a-z][\\w+.-]*:/i.test(String(href))) {
      Linking.openURL(String(href)).catch(() => {});
      return;
    }
    const name = routeFor(href, screens, entry);
    if (!name) return;
    setAnimating(true);
    setStack((current) => (current[current.length - 1] === name ? current : [...current, name]));
  }, [entry, screens]);

  const back = useCallback(() => {
    let popped = false;
    setStack((current) => {
      if (current.length <= 1) return current;
      popped = true;
      return current.slice(0, -1);
    });
    return popped;
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", back);
    return () => subscription.remove();
  }, [back]);

  const settled = useCallback(() => setAnimating(false), []);
  const visible = useMemo(() => {
    const top = stack[stack.length - 1];
    const beneath = stack[stack.length - 2];
    return animating && beneath ? [beneath, top] : [top];
  }, [animating, stack]);

  return (
    <View style={theme.screen}>
      {visible.map((name, index) => (
        <Screen
          key={\`\${name}-\${stack.length - visible.length + index}\`}
          screen={{ component: screens[name] }}
          data={data}
          entering={visible.length > 1 && index === visible.length - 1}
          onSettled={settled}
          navigate={navigate}
          actions={{ ...actions, back }}
        />
      ))}
    </View>
  );
}
`;

const BRIDGE_MODULE = `// Generated by Noderyx â€” the same Noderyx.native API the web build exposes,
// implemented with native modules. App code moves between targets unchanged.
import { Alert, Linking, Platform, Share, Vibration } from "react-native";

function optional(name) {
  try {
    // Loaded lazily so a project only needs the modules it actually uses.
    return require(name);
  } catch {
    return null;
  }
}

let apiBase = "";

const memory = new Map();
const storageModule = () => optional("@react-native-async-storage/async-storage")?.default ?? null;

export const native = {
  isNative: true,
  isStandalone: true,
  platform: Platform.OS,
  get isAndroid() { return Platform.OS === "android"; },
  get isIOS() { return Platform.OS === "ios"; },

  configure({ apiUrl } = {}) {
    apiBase = String(apiUrl ?? "").replace(/\\/+$/, "");
    return native;
  },
  get apiUrl() { return apiBase; },

  async ready() { return native; },

  fetch(path, init) {
    const url = /^[a-z][\\w+.-]*:/i.test(path) ? path : \`\${apiBase}\${path}\`;
    return fetch(url, init);
  },

  async api(path, { body, headers, ...init } = {}) {
    const response = await native.fetch(path, {
      ...init,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) {
      const error = new Error(\`Request failed with status \${response.status}\`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  },

  async share({ title, text, url } = {}) {
    return Share.share({ title, message: [text, url].filter(Boolean).join(" ") });
  },

  async camera({ source = "camera", quality = 0.8 } = {}) {
    const picker = optional("expo-image-picker");
    if (!picker) throw new Error("Install expo-image-picker to use the camera");

    const permission = source === "camera"
      ? await picker.requestCameraPermissionsAsync()
      : await picker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return null;

    const result = source === "camera"
      ? await picker.launchCameraAsync({ quality, base64: true })
      : await picker.launchImageLibraryAsync({ quality, base64: true });
    if (result.canceled) return null;

    const asset = result.assets[0];
    return { uri: asset.uri, dataUrl: asset.base64 ? \`data:image/jpeg;base64,\${asset.base64}\` : null };
  },

  async location({ highAccuracy = true } = {}) {
    const location = optional("expo-location");
    if (!location) throw new Error("Install expo-location to read the device position");

    const permission = await location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const position = await location.getCurrentPositionAsync({
      accuracy: highAccuracy ? location.Accuracy.High : location.Accuracy.Balanced
    });
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  },

  async haptics(style = "medium") {
    const haptics = optional("expo-haptics");
    if (haptics) {
      const styles = { light: "Light", medium: "Medium", heavy: "Heavy" };
      return haptics.impactAsync(haptics.ImpactFeedbackStyle[styles[style] ?? "Medium"]);
    }
    Vibration.vibrate({ light: 10, medium: 20, heavy: 35 }[style] ?? 20);
    return null;
  },

  async notify({ title, body } = {}) {
    const notifications = optional("expo-notifications");
    if (!notifications) {
      Alert.alert(title ?? "", body ?? "");
      return null;
    }
    await notifications.requestPermissionsAsync();
    return notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
  },

  async browser(url) {
    const browser = optional("expo-web-browser");
    if (browser) return browser.openBrowserAsync(url);
    return Linking.openURL(url);
  },

  storage: {
    async get(key) {
      const store = storageModule();
      return store ? store.getItem(key) : (memory.get(key) ?? null);
    },
    async set(key, value) {
      const store = storageModule();
      return store ? store.setItem(key, String(value)) : void memory.set(key, String(value));
    },
    async remove(key) {
      const store = storageModule();
      return store ? store.removeItem(key) : void memory.delete(key);
    }
  }
};

export default native;
`;

function appModule(screens, options) {
  const imports = screens.map((screen) => `import ${screen.name} from "./${screen.route}";`);
  const map = screens.map((screen) => `  ${JSON.stringify(screen.route)}: ${screen.name}`).join(",\n");

  return `// Generated by Noderyx â€” the application entry point.
import React, { useEffect, useState } from "react";
import { SafeAreaView, StatusBar } from "react-native";
import Navigator from "./Navigator";
import native from "./native";
import { theme } from "./theme";
${imports.join("\n")}

export const screens = {
${map}
};

export const ENTRY = ${JSON.stringify(options.entry)};

native.configure({ apiUrl: ${JSON.stringify(options.apiUrl ?? "")} });

export default function App({ data: initialData = {}, actions = {} }) {
  const [data, setData] = useState(initialData);

  // Load once at startup. The first frame draws immediately from initialData,
  // so the app is never blank while this runs.
  useEffect(() => {
    let live = true;
    if (!native.apiUrl) return undefined;
    native.api("/api/app")
      .then((remote) => { if (live && remote) setData((current) => ({ ...current, ...remote })); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  return (
    <SafeAreaView style={theme.screen}>
      <StatusBar barStyle="light-content" backgroundColor={theme.screen.backgroundColor} />
      <Navigator screens={screens} entry={ENTRY} data={data} actions={actions} />
    </SafeAreaView>
  );
}
`;
}

/**
 * Compile every view into a React Native screen, plus the theme, styles,
 * runtime, navigator, and native bridge they rely on.
 */
export async function buildNative(config = {}, overrides = {}, log = console.log) {
  const provided = Object.fromEntries(
    Object.entries(overrides).filter(([, item]) => item !== undefined)
  );
  const options = { ...NATIVE_DEFAULTS, ...(config.native ?? {}), ...provided };
  options.apiUrl = options.apiUrl ?? config.mobile?.apiUrl ?? null;

  const viewsRoot = resolve(options.views);
  const outRoot = resolve(options.out);
  if (!existsSync(viewsRoot)) throw new Error(`Views directory not found: ${viewsRoot}`);

  const files = await collectViews(viewsRoot);
  if (!files.length) throw new Error(`No .noderframe views found in ${viewsRoot}`);

  const preferred = new Set(files
    .filter((file) => file.endsWith(".noderframe"))
    .map((file) => file.slice(0, -".noderframe".length)));
  const selected = files.filter((file) => !(file.endsWith(".untitled")
    && preferred.has(file.slice(0, -".untitled".length))));

  await mkdir(outRoot, { recursive: true });

  const styles = new Map();
  const screens = [];
  const notes = [];

  for (const file of selected) {
    const route = relative(viewsRoot, file).replaceAll("\\", "/").slice(0, -extname(file).length);
    const rendered = renderNative(parse(await readFile(file, "utf8")), {
      route,
      scroll: options.scroll
    });

    const target = join(outRoot, `${route}.jsx`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, rendered.source);

    for (const [key, parts] of rendered.styles) styles.set(key, parts);
    for (const note of rendered.notes) notes.push(`${route}: ${note}`);
    screens.push({ route, name: rendered.name, title: rendered.title });
  }

  if (!screens.some((screen) => screen.route === options.entry)) {
    throw new Error(`Entry view not found: ${options.entry} (available: ${screens.map((s) => s.route).join(", ")})`);
  }

  const themeKeys = [...new Set([...styles.values()].flat())];
  await writeFile(join(outRoot, "theme.js"), themeModule([...themeKeys, "placeholder"]));
  await writeFile(join(outRoot, "styles.js"), stylesModule(styles));
  await writeFile(join(outRoot, "runtime.js"), RUNTIME_MODULE);
  await writeFile(join(outRoot, "Navigator.jsx"), NAVIGATOR_MODULE);
  await writeFile(join(outRoot, "native.js"), BRIDGE_MODULE);
  await writeFile(join(outRoot, "App.jsx"), appModule(screens, options));

  log(`Compiled ${screens.length} native screen${screens.length === 1 ? "" : "s"} into ${relative(process.cwd(), outRoot) || outRoot}`);
  log(`Styles flattened: ${styles.size}   Entry: ${options.entry}`);
  if (notes.length) {
    log(`\n${notes.length} element${notes.length === 1 ? "" : "s"} need attention:`);
    for (const note of notes.slice(0, 20)) log(`  ${note}`);
    if (notes.length > 20) log(`  ...and ${notes.length - 20} more`);
  }

  return { out: outRoot, screens, styles: [...styles.keys()], notes, options };
}

/**
 * Scaffold a complete, runnable React Native project around the compiled
 * screens. Nothing here uses a WebView.
 */
export async function initNativeProject(config = {}, overrides = {}, log = console.log) {
  const result = await buildNative(config, overrides, log);
  const options = result.options;
  const root = resolve(options.out);
  const slug = options.appName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const files = {
    "package.json": `${JSON.stringify({
      name: slug || "noderyx-app",
      version: "1.0.0",
      private: true,
      main: "index.js",
      scripts: {
        start: "expo start",
        android: "expo run:android",
        ios: "expo run:ios",
        prebuild: "expo prebuild"
      },
      dependencies: {
        expo: "~52.0.0",
        "expo-status-bar": "~2.0.0",
        react: "18.3.1",
        "react-native": "0.76.5"
      }
    }, null, 2)}\n`,

    "app.json": `${JSON.stringify({
      expo: {
        name: options.appName,
        slug: slug || "noderyx-app",
        version: "1.0.0",
        orientation: "portrait",
        icon: "./assets/icon.png",
        userInterfaceStyle: "dark",
        newArchEnabled: true,
        splash: {
          image: "./assets/splash.png",
          resizeMode: "contain",
          backgroundColor: "#090B14"
        },
        assetBundlePatterns: ["**/*"],
        ios: { supportsTablet: true, bundleIdentifier: options.appId },
        android: {
          package: options.appId,
          adaptiveIcon: {
            foregroundImage: "./assets/adaptive-icon.png",
            backgroundColor: "#090B14"
          }
        }
      }
    }, null, 2)}\n`,

    "index.js": `import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
`,

    "babel.config.js": `module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
`,

    ".gitignore": `node_modules/
.expo/
android/
ios/
*.log
`,

    "README.md": `# ${options.appName}

A native Android and iOS app compiled from \`.noderframe\` views by Noderyx.
No WebView is involved: every screen draws real platform widgets.

\`\`\`bash
npm install
npm run android      # or: npm run ios
\`\`\`

## What is generated

| File | Purpose |
| --- | --- |
| \`${options.entry}.jsx\` and siblings | One compiled component per view |
| \`theme.js\` | Design tokens â€” **the file to edit** |
| \`styles.js\` | Style combinations, flattened once at load |
| \`runtime.js\` | The few helpers compiled screens call |
| \`Navigator.jsx\` | Stack navigation, no dependencies |
| \`native.js\` | Camera, location, storage, share, notifications |
| \`App.jsx\` | Entry point |

Everything except \`theme.js\` is regenerated by \`noderyx build:native\`.
Keep your own code in separate files.

## Optional native modules

Install only what you use:

\`\`\`bash
npx expo install expo-image-picker expo-location expo-haptics
npx expo install expo-notifications expo-web-browser
npx expo install @react-native-async-storage/async-storage
\`\`\`
`
  };

  for (const [name, contents] of Object.entries(files)) {
    const target = join(root, name);
    if (existsSync(target)) continue; // never overwrite project files
    await writeFile(target, contents);
  }

  const assets = join(root, "assets");
  await mkdir(assets, { recursive: true });
  const artwork = {
    "icon.png": () => noderyxIcon(1024),
    "adaptive-icon.png": () => noderyxIcon(1024, { maskable: true }),
    "splash.png": () => noderyxSplash(2048)
  };
  for (const [name, draw] of Object.entries(artwork)) {
    const target = join(assets, name);
    if (!existsSync(target)) await writeFile(target, draw());
  }

  log(`
Native project ready in ${relative(process.cwd(), root) || root}

  cd ${relative(process.cwd(), root) || root}
  npm install
  npm run android        Build and launch on a device or emulator
  npm run ios            The same on macOS

App ID: ${options.appId}`);

  return { ...result, root };
}
