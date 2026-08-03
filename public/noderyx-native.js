/**
 * Noderyx native bridge.
 *
 * One API for the browser, installed PWAs, and the Android/iOS builds produced
 * by `noderyx build:mobile`. Every call works on the web; when the page runs
 * inside the native shell the matching Capacitor plugin is used instead.
 *
 *   await Noderyx.native.share({ title: "Noderyx", url: location.href });
 *   await Noderyx.native.storage.set("token", "abc");
 *   if (Noderyx.native.isNative) { ... }
 */
(() => {
  const capacitor = () => globalThis.Capacitor ?? null;
  const plugin = (name) => capacitor()?.Plugins?.[name] ?? null;
  const isNative = Boolean(capacitor()?.isNativePlatform?.());
  const platform = capacitor()?.getPlatform?.()
    ?? (/android/i.test(navigator.userAgent)
      ? "android"
      : /iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : "web");

  const standalone = globalThis.matchMedia?.("(display-mode: standalone)")?.matches
    || navigator.standalone === true;

  const listeners = new Map();

  function emit(name, detail) {
    for (const handler of listeners.get(name) ?? []) {
      try {
        handler(detail);
      } catch (error) {
        console.error(`[Noderyx] ${name} listener failed`, error);
      }
    }
  }

  async function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Unable to read file"));
      reader.readAsDataURL(file);
    });
  }

  function pickImage({ capture }) {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      if (capture) input.capture = "environment";
      input.style.display = "none";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return resolve(null);
        try {
          resolve({ dataUrl: await readFileAsDataUrl(file), format: file.type, name: file.name });
        } catch (error) {
          reject(error);
        }
      });
      document.body.append(input);
      input.click();
    });
  }

  const memoryStore = new Map();
  const webStorage = {
    read(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return memoryStore.get(key) ?? null;
      }
    },
    write(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        memoryStore.set(key, value);
      }
    },
    erase(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        memoryStore.delete(key);
      }
    }
  };

  const native = {
    isNative,
    isStandalone: Boolean(standalone),
    platform,
    get isAndroid() { return platform === "android"; },
    get isIOS() { return platform === "ios"; },

    /** Resolves once the native shell (if any) has finished booting. */
    async ready() {
      if (document.readyState === "loading") {
        await new Promise((resolve) => {
          document.addEventListener("DOMContentLoaded", resolve, { once: true });
        });
      }
      await plugin("SplashScreen")?.hide?.().catch(() => {});
      return native;
    },

    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },

    /**
     * Base URL of the Noderyx server. Empty on the web, where relative paths
     * already resolve; set by `noderyx build:mobile --api-url=...` for packaged
     * apps, which have no server of their own.
     */
    apiUrl: String(globalThis.NODERYX_API_BASE ?? "").replace(/\/+$/, ""),

    /** fetch() that resolves relative paths against the Noderyx server. */
    fetch(path, init) {
      const url = /^[a-z][\w+.-]*:/i.test(path) ? path : `${native.apiUrl}${path}`;
      return fetch(url, { credentials: native.apiUrl ? "omit" : "same-origin", ...init });
    },

    /** The CSRF token for this session, sent automatically by `api()`. */
    get csrfToken() {
      return csrfToken();
    },

    /** JSON request helper: `await Noderyx.native.api("/users", { method: "POST", body })`. */
    async api(path, { body, headers, ...init } = {}) {
      const unsafe = !["GET", "HEAD", "OPTIONS"].includes((init.method ?? "GET").toUpperCase());
      const token = unsafe ? csrfToken() : "";

      const response = await native.fetch(path, {
        ...init,
        headers: {
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { "x-csrf-token": token } : {}),
          ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (!response.ok) {
        const error = new Error(`Request failed with status ${response.status}`);
        error.status = response.status;
        error.response = response;
        throw error;
      }
      return response.status === 204 ? null : response.json();
    },

    async share({ title, text, url } = {}) {
      const share = plugin("Share");
      if (share) return share.share({ title, text, url });
      if (navigator.share) {
        try {
          return await navigator.share({ title, text, url });
        } catch (error) {
          if (error?.name === "AbortError") return null;
          throw error;
        }
      }
      await navigator.clipboard?.writeText(url ?? text ?? title ?? "");
      return { copied: true };
    },

    /** Take a photo, or fall back to a file picker on the web. */
    async camera({ source = "camera", quality = 80 } = {}) {
      const camera = plugin("Camera");
      if (camera) {
        const photo = await camera.getPhoto({
          quality,
          resultType: "dataUrl",
          source: source === "photos" ? "PHOTOS" : "CAMERA"
        });
        return { dataUrl: photo.dataUrl, format: `image/${photo.format ?? "jpeg"}` };
      }
      return pickImage({ capture: source === "camera" });
    },

    async location({ highAccuracy = true, timeout = 10000 } = {}) {
      const geolocation = plugin("Geolocation");
      if (geolocation) {
        const position = await geolocation.getCurrentPosition({
          enableHighAccuracy: highAccuracy,
          timeout
        });
        return { latitude: position.coords.latitude, longitude: position.coords.longitude };
      }
      if (!navigator.geolocation) throw new Error("Geolocation is unavailable");
      return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) => resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          }),
          reject,
          { enableHighAccuracy: highAccuracy, timeout }
        );
      });
    },

    async haptics(style = "medium") {
      const haptics = plugin("Haptics");
      if (haptics) return haptics.impact({ style: style.toUpperCase() });
      const durations = { light: 10, medium: 20, heavy: 35 };
      navigator.vibrate?.(durations[style] ?? 20);
      return null;
    },

    async notify({ title, body, id = Date.now() % 100000 } = {}) {
      const notifications = plugin("LocalNotifications");
      if (notifications) {
        await notifications.requestPermissions().catch(() => {});
        return notifications.schedule({ notifications: [{ id, title, body }] });
      }
      if (!("Notification" in globalThis)) return null;
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission !== "granted") return null;
      return new Notification(title ?? "", { body });
    },

    async network() {
      const network = plugin("Network");
      if (network) return network.getStatus();
      return { connected: navigator.onLine, connectionType: navigator.onLine ? "unknown" : "none" };
    },

    async browser(url) {
      const browser = plugin("Browser");
      if (browser) return browser.open({ url });
      globalThis.open(url, "_blank", "noopener");
      return null;
    },

    storage: {
      async get(key) {
        const preferences = plugin("Preferences");
        if (preferences) return (await preferences.get({ key })).value;
        return webStorage.read(key);
      },
      async set(key, value) {
        const preferences = plugin("Preferences");
        if (preferences) return preferences.set({ key, value: String(value) });
        return webStorage.write(key, String(value));
      },
      async remove(key) {
        const preferences = plugin("Preferences");
        if (preferences) return preferences.remove({ key });
        return webStorage.erase(key);
      }
    },

    /** Prompt to install the web app; resolves to true when the user accepts. */
    async install() {
      const prompt = native._installPrompt;
      if (!prompt) return false;
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      native._installPrompt = null;
      return outcome === "accepted";
    },
    canInstall: false,
    _installPrompt: null
  };

  // Declarative behaviour, so pages never need an inline handler that a strict
  // Content-Security-Policy would block.
  function wireActions() {
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest?.("[data-noderyx]");
      if (!trigger) return;

      const action = trigger.dataset.noderyx;
      if (action === "back") {
        event.preventDefault();
        if (globalThis.history.length > 1) globalThis.history.back();
        else globalThis.location.assign("/");
      } else if (action === "reload") {
        event.preventDefault();
        globalThis.location.reload();
      } else if (action === "share") {
        event.preventDefault();
        native.share({ title: document.title, url: globalThis.location.href });
      } else if (action === "install") {
        event.preventDefault();
        native.install();
      }
    });
  }

  /** The CSRF token Noderyx set for this session, for your own fetch calls. */
  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)noderyx_csrf=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function applyChrome() {
    const root = document.documentElement;
    root.dataset.platform = platform;
    root.classList.toggle("noderyx-native", isNative);
    root.classList.toggle("noderyx-standalone", Boolean(standalone) || isNative);

    if (!isNative) return;
    plugin("StatusBar")?.setStyle?.({ style: "DARK" }).catch(() => {});
    plugin("StatusBar")?.setBackgroundColor?.({ color: "#090B14" }).catch(() => {});
    plugin("Keyboard")?.setResizeMode?.({ mode: "native" }).catch(() => {});
  }

  // The Android hardware back button should walk the history, then exit.
  capacitor()?.Plugins?.App?.addListener?.("backButton", ({ canGoBack }) => {
    if (canGoBack ?? globalThis.history.length > 1) globalThis.history.back();
    else plugin("App")?.exitApp?.();
  });

  capacitor()?.Plugins?.App?.addListener?.("appStateChange", (state) => emit("appState", state));
  capacitor()?.Plugins?.Network?.addListener?.("networkStatusChange", (status) => emit("network", status));

  addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    native._installPrompt = event;
    native.canInstall = true;
    emit("installable", event);
  });

  addEventListener("online", () => emit("network", { connected: true }));
  addEventListener("offline", () => emit("network", { connected: false }));

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      applyChrome();
      wireActions();
    }, { once: true });
  } else {
    applyChrome();
    wireActions();
  }

  globalThis.Noderyx = Object.assign(globalThis.Noderyx ?? {}, { native });
})();
