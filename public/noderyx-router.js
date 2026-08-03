// Noderyx clean-route navigator for server-rendered web and Capacitor builds.
(() => {
  const style = document.createElement("style");
  style.textContent = `
    html::before{content:"";position:fixed;z-index:2147483647;inset:0 auto auto 0;width:0;height:3px;background:linear-gradient(90deg,#7c3aed,#22d3ee);opacity:0;transition:width .35s ease,opacity .2s ease;pointer-events:none}
    html[data-noderyx-navigating]::before{width:72%;opacity:1}
    html[data-noderyx-navigating] main{opacity:.72;transform:translateY(3px);transition:opacity .18s ease,transform .18s ease}
    ::view-transition-old(root){animation:180ms ease both noderyx-out}
    ::view-transition-new(root){animation:260ms cubic-bezier(.2,.8,.2,1) both noderyx-in}
    @keyframes noderyx-out{to{opacity:0;transform:translateX(-10px)}}
    @keyframes noderyx-in{from{opacity:0;transform:translateX(14px)}}
    @media(prefers-reduced-motion:reduce){html::before,html[data-noderyx-navigating] main{transition:none}::view-transition-old(root),::view-transition-new(root){animation:none}}
  `;
  document.head.append(style);
  const routes = new Set(window.NODERYX_ROUTES || []);
  const entry = window.NODERYX_ENTRY || "home";
  const bundled = routes.size > 0;
  let navigating = false;

  const routeName = (url) => {
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.html$/, "");
    return path || entry;
  };

  const isPage = (url) => {
    if (url.origin !== location.origin) return false;
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/public/")) return false;
    return !bundled || routes.has(routeName(url));
  };

  const sourceFor = (url) => {
    if (!bundled) return url.href;
    const route = routeName(url);
    const file = `/${route}.mnoderframe`;
    return `${file}${url.search}`;
  };

  const decodeText = (value) => {
    const area = document.createElement("textarea");
    area.innerHTML = value;
    return area.value;
  };

  const mobileDocument = (source) => {
    if (!source.startsWith("MNF1\n")) return null;
    const payload = JSON.parse(source.slice(5));
    if (payload?.format !== "mnoderframe" || payload.version !== 1) throw new Error("Invalid .mnoderframe page");
    const build = (item) => {
      if (typeof item === "string") return document.createTextNode(decodeText(item));
      const element = document.createElement(item.tag);
      for (const [name, value] of Object.entries(item.attrs || {})) element.setAttribute(name, decodeText(value));
      for (const child of item.children || []) element.append(build(child));
      return element;
    };
    const fragment = document.createDocumentFragment();
    for (const node of payload.document) fragment.append(build(node));
    return fragment;
  };

  const announce = (message) => {
    let live = document.getElementById("noderyx-route-status");
    if (!live) {
      live = document.createElement("div");
      live.id = "noderyx-route-status";
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
      Object.assign(live.style, { position: "fixed", width: "1px", height: "1px", overflow: "hidden", clipPath: "inset(50%)" });
      document.body.append(live);
    }
    live.textContent = message;
  };

  async function navigate(target, { replace = false, history = true } = {}) {
    const url = new URL(target, location.href);
    if (!isPage(url) || navigating) return false;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) {
      document.querySelector(url.hash)?.scrollIntoView({ behavior: "smooth" });
      if (history) window.history.pushState({}, "", url.pathname + url.search + url.hash);
      return true;
    }

    navigating = true;
    document.documentElement.dataset.noderyxNavigating = "true";
    try {
      const response = await fetch(sourceFor(url), { headers: { "X-Noderyx-Navigation": "1" } });
      if (!response.ok) throw new Error(`Navigation failed (${response.status})`);
      const source = await response.text();
      const compiled = mobileDocument(source);
      const next = compiled
        ? { querySelector: (selector) => compiled.querySelector(selector), title: compiled.querySelector("title")?.textContent || "", body: compiled.querySelector("body") || { className: "" } }
        : new DOMParser().parseFromString(source, "text/html");
      const currentMain = document.querySelector("main");
      const nextMain = next.querySelector("main");
      if (!currentMain || !nextMain) {
        location.href = sourceFor(url);
        return true;
      }
      const swap = () => {
        currentMain.replaceWith(document.importNode(nextMain, true));
        document.title = next.title || document.title;
        document.body.className = next.body.className;
      };
      if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        await document.startViewTransition(swap).finished;
      } else swap();
      if (history) window.history[replace ? "replaceState" : "pushState"]({}, "", url.pathname + url.search + url.hash);
      if (url.hash) document.querySelector(url.hash)?.scrollIntoView();
      else scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      const heading = document.querySelector("main h1, main [role=heading], main");
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      announce(next.title ? `${next.title} loaded` : "Page loaded");
      dispatchEvent(new CustomEvent("noderyx:navigate", { detail: { url: url.href } }));
      return true;
    } catch (error) {
      location.href = sourceFor(url);
      return true;
    } finally {
      navigating = false;
      delete document.documentElement.dataset.noderyxNavigating;
    }
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (!isPage(url)) return;
    event.preventDefault();
    navigate(url.href);
  });

  addEventListener("popstate", () => navigate(location.href, { history: false }));
  window.Noderyx = Object.assign(window.Noderyx || {}, { navigate, routes: [...routes] });
})();
