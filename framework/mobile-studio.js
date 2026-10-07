// Mobile Studio: the page inside the web app that edits each mobile app's
// theme, text, and feature flags. Served by registerMobileUi(). The server's
// CSP allows only same-origin styles and scripts, so they ship as files and
// the page never uses inline style or event-handler attributes.

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function studioPage({ base, csrfToken = "", appName = "Noderyx" }) {
  const root = escapeHtml(base);
  return `<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="csrf-token" content="${escapeHtml(csrfToken)}">
<title>Mobile Studio — ${escapeHtml(appName)}</title>
<link rel="stylesheet" href="/public/cool.css">
<link rel="stylesheet" href="${root}/studio.css">
<script src="${root}/studio.js" defer></script>
</head><body class="ms-body">
<header class="ms-top">
  <strong>Mobile Studio</strong>
  <label class="ms-inline">App <select id="ms-app"></select></label>
  <span class="ms-status" id="ms-status" role="status" aria-live="polite"></span>
</header>
<section class="ms-lock" id="ms-lock" hidden>
  <p>Enter the Mobile Studio token to make changes.</p>
  <form id="ms-unlock" class="ms-inline"><input id="ms-token" type="password" autocomplete="off" aria-label="Studio token" required>
  <button class="cool-btn cool-btn-small" type="submit">Unlock</button></form>
</section>
<main class="ms-layout">
  <form class="ms-editor" id="ms-form">
    <fieldset><legend>Theme</legend><div class="ms-grid" id="ms-theme"></div>
      <label class="ms-field">Corner radius <span><input id="ms-radius" type="range" min="0" max="40" step="1"> <output id="ms-radius-out"></output></span></label>
      <label class="ms-field">Mode <select id="ms-mode"><option value="">Default</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
    </fieldset>
    <fieldset><legend>Text and content <small>available in views as {{name}}</small></legend>
      <div id="ms-data" class="ms-rows"></div>
      <button class="cool-btn secondary cool-btn-small" type="button" id="ms-add-data">Add text</button>
    </fieldset>
    <fieldset><legend>Feature flags <small>available as {{flags.name}} and Noderyx.flags</small></legend>
      <div id="ms-flags" class="ms-rows"></div>
      <button class="cool-btn secondary cool-btn-small" type="button" id="ms-add-flag">Add flag</button>
    </fieldset>
    <div class="ms-actions"><button class="cool-btn" type="submit" id="ms-save">Publish to devices</button>
    <span class="ms-note">Installed apps pick this up on their next launch or resume.</span></div>
  </form>
  <aside class="ms-preview-panel">
    <label class="ms-inline">Screen <select id="ms-route"></select></label>
    <div class="ms-phone"><div id="ms-preview"></div></div>
    <p class="ms-note" id="ms-version"></p>
  </aside>
</main>
</body></html>
`;
}

export const STUDIO_CSS = `.ms-body{min-height:100vh;margin:0;color:var(--cool-text);background:var(--cool-bg);font-family:inherit}
.ms-top{display:flex;flex-wrap:wrap;align-items:center;gap:1rem;padding:1rem 1.25rem;border-bottom:1px solid var(--cool-border)}
.ms-inline{display:inline-flex;align-items:center;gap:.5rem}
.ms-status{margin-left:auto;color:var(--cool-muted);font-size:.9rem}
.ms-status.is-error{color:#ff7a90}
.ms-lock{padding:1rem 1.25rem;border-bottom:1px solid var(--cool-border)}
.ms-layout{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:1.5rem;padding:1.25rem;max-width:1200px;margin:0 auto}
@media (max-width:900px){.ms-layout{grid-template-columns:1fr}}
.ms-editor fieldset{margin:0 0 1rem;padding:1rem;border:1px solid var(--cool-border);border-radius:var(--cool-radius)}
.ms-editor legend{padding:0 .4rem;font-weight:700}
.ms-editor legend small{margin-left:.4rem;color:var(--cool-muted);font-weight:400}
.ms-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.75rem}
.ms-field{display:flex;flex-direction:column;gap:.35rem;margin-top:.75rem;color:var(--cool-muted);font-size:.85rem}
.ms-color{display:flex;gap:.4rem}
.ms-color input[type=color]{width:2.6rem;height:2.4rem;padding:0;border:1px solid var(--cool-border);border-radius:.5rem;background:none}
.ms-body input[type=text],.ms-body input[type=password],.ms-body textarea,.ms-body select{min-height:2.4rem;padding:.4rem .6rem;border:1px solid var(--cool-border);border-radius:.5rem;color:var(--cool-text);background:var(--cool-surface-solid);font:inherit}
.ms-color input[type=text]{flex:1;min-width:0}
.ms-rows{display:flex;flex-direction:column;gap:.5rem;margin-bottom:.75rem}
.ms-row{display:grid;grid-template-columns:minmax(0,180px) minmax(0,1fr) auto;gap:.5rem;align-items:start}
.ms-row textarea{min-height:2.4rem;resize:vertical}
.ms-row button{min-height:2.4rem}
.ms-actions{display:flex;flex-wrap:wrap;align-items:center;gap:1rem}
.ms-note{color:var(--cool-muted);font-size:.85rem}
.ms-preview-panel{position:sticky;top:1rem;align-self:start}
.ms-phone{width:360px;max-width:100%;height:680px;margin-top:.75rem;overflow:auto;border:10px solid #000;border-radius:2.2rem;background:var(--cool-bg)}
`;

export const STUDIO_JS = `// Generated by Noderyx: Mobile Studio.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKENS = { primary: "Primary", accent: "Accent", background: "Background", surface: "Surface", text: "Text", muted: "Muted text", border: "Border" };
  const VARS = { primary: ["--cool-primary", "--noderyx-violet"], accent: ["--cool-accent", "--runtime-cyan"], background: ["--cool-bg", "--kernel-night"], surface: ["--cool-surface", "--cool-surface-solid"], text: ["--cool-text"], muted: ["--cool-muted"], border: ["--cool-border"] };
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content ?? "";
  const state = { app: null, manifest: null, editable: false };
  let token = "";
  try { token = sessionStorage.getItem("noderyx:studio-token") ?? ""; } catch {}

  const status = (message, error = false) => {
    $("ms-status").textContent = message;
    $("ms-status").classList.toggle("is-error", error);
  };

  async function call(path, init = {}) {
    const headers = { accept: "application/json", ...(init.headers ?? {}) };
    if (token) headers.authorization = "Bearer " + token;
    const response = await fetch(path, { credentials: "same-origin", ...init, headers });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error ?? body?.message ?? "Request failed (" + response.status + ")");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  // Theme fields
  for (const [name, label] of Object.entries(TOKENS)) {
    const field = document.createElement("label");
    field.className = "ms-field";
    field.append(label);
    const row = document.createElement("span");
    row.className = "ms-color";
    const swatch = Object.assign(document.createElement("input"), { type: "color" });
    const text = Object.assign(document.createElement("input"), { type: "text", placeholder: "default", id: "ms-t-" + name });
    swatch.setAttribute("aria-label", label + " colour picker");
    swatch.addEventListener("input", () => { text.value = swatch.value; preview(); });
    text.addEventListener("input", () => { if (/^#[0-9a-f]{6}$/i.test(text.value)) swatch.value = text.value; preview(); });
    row.append(swatch, text);
    field.append(row);
    $("ms-theme").append(field);
  }
  $("ms-radius").addEventListener("input", () => { $("ms-radius-out").textContent = $("ms-radius").value + "px"; preview(); });
  $("ms-mode").addEventListener("change", preview);

  function addRow(container, kind, key = "", value = "") {
    const row = document.createElement("div");
    row.className = "ms-row";
    const name = Object.assign(document.createElement("input"), { type: "text", value: key, placeholder: "name" });
    name.setAttribute("aria-label", kind === "flag" ? "Flag name" : "Text name");
    let input;
    if (kind === "flag") {
      const wrap = document.createElement("label");
      wrap.className = "ms-inline";
      input = Object.assign(document.createElement("input"), { type: "checkbox", checked: value === true });
      wrap.append(input, "Enabled");
      row.append(name, wrap);
    } else {
      input = document.createElement("textarea");
      input.rows = 1;
      input.value = String(value);
      input.setAttribute("aria-label", "Text value");
      row.append(name, input);
    }
    const remove = Object.assign(document.createElement("button"), { type: "button", className: "cool-btn secondary cool-btn-small", textContent: "Remove" });
    remove.addEventListener("click", () => row.remove());
    row.append(remove);
    container.append(row);
  }
  $("ms-add-data").addEventListener("click", () => addRow($("ms-data"), "data"));
  $("ms-add-flag").addEventListener("click", () => addRow($("ms-flags"), "flag"));

  function collect() {
    const theme = {};
    for (const name of Object.keys(TOKENS)) {
      const value = $("ms-t-" + name).value.trim();
      if (value) theme[name] = value;
    }
    if ($("ms-radius").dataset.touched) theme.radius = Number($("ms-radius").value);
    if ($("ms-mode").value) theme.mode = $("ms-mode").value;
    const data = {};
    for (const row of $("ms-data").children) {
      const [name, value] = row.querySelectorAll("input, textarea");
      if (name.value.trim()) data[name.value.trim()] = value.value;
    }
    const flags = {};
    for (const row of $("ms-flags").children) {
      const [name, value] = row.querySelectorAll("input");
      if (name.value.trim()) flags[name.value.trim()] = value.checked;
    }
    return { theme, data, flags };
  }
  $("ms-radius").addEventListener("change", () => { $("ms-radius").dataset.touched = "1"; });

  function fill(settings) {
    const theme = settings.theme ?? {};
    for (const name of Object.keys(TOKENS)) $("ms-t-" + name).value = theme[name] ?? "";
    $("ms-radius").value = theme.radius ?? 20;
    if (theme.radius !== undefined) $("ms-radius").dataset.touched = "1";
    else delete $("ms-radius").dataset.touched;
    $("ms-radius-out").textContent = (theme.radius ?? 20) + "px";
    $("ms-mode").value = theme.mode ?? "";
    $("ms-data").replaceChildren();
    $("ms-flags").replaceChildren();
    for (const [key, value] of Object.entries(settings.data ?? {})) addRow($("ms-data"), "data", key, value);
    for (const [key, value] of Object.entries(settings.flags ?? {})) addRow($("ms-flags"), "flag", key, value);
  }

  // Preview: the screen's body drawn in a shadow root with Cool.css, so the
  // studio's own styles never leak in. Theme edits apply as you type.
  const host = $("ms-preview");
  const shadow = host.attachShadow({ mode: "open" });
  const decode = (value) => { const area = document.createElement("textarea"); area.innerHTML = value; return area.value; };
  const SKIP = new Set(["script", "link", "meta", "title", "style", "head", "iframe", "object", "embed"]);

  function build(node) {
    if (typeof node === "string") return document.createTextNode(decode(node));
    if (SKIP.has(node.tag)) return null;
    const tag = node.tag === "body" || node.tag === "html" ? "div" : node.tag;
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(node.attrs ?? {})) {
      const text = decode(value);
      if (/^on/i.test(name) || name === "style" || /^\\s*javascript:/i.test(text)) continue;
      element.setAttribute(name, text);
    }
    for (const child of node.children ?? []) {
      const built = build(child);
      if (built) element.append(built);
    }
    return element;
  }

  function findBody(nodes) {
    for (const node of nodes) {
      if (typeof node === "string") continue;
      if (node.tag === "body") return node;
      const found = findBody(node.children ?? []);
      if (found) return found;
    }
    return null;
  }

  function preview() {
    const manifest = state.manifest;
    if (!manifest) return;
    const route = $("ms-route").value || manifest.entry;
    const source = manifest.pages?.[route];
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "/public/cool.css";
    const frame = document.createElement("div");
    frame.className = "ms-frame";
    if (source?.startsWith("MNF1\\n")) {
      const body = findBody(JSON.parse(source.slice(5)).document);
      if (body) frame.append(build(body));
    }
    const { theme } = collect();
    for (const [token, properties] of Object.entries(VARS)) {
      for (const property of properties) {
        if (theme[token]) host.style.setProperty(property, theme[token]);
        else host.style.removeProperty(property);
      }
    }
    if (theme.radius !== undefined) host.style.setProperty("--cool-radius", theme.radius + "px");
    else host.style.removeProperty("--cool-radius");
    host.style.setProperty("display", "block");
    host.style.setProperty("min-height", "100%");
    host.style.setProperty("color", "var(--cool-text)");
    host.style.setProperty("background", "var(--cool-bg)");
    shadow.replaceChildren(style, frame);
  }

  // Links inside the preview switch the previewed screen instead of navigating.
  shadow.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link) return;
    event.preventDefault();
    const route = link.getAttribute("href").replace(/^\\/+|\\/+$/g, "").split(/[?#]/)[0] || state.manifest?.entry;
    if (state.manifest?.pages?.[route]) { $("ms-route").value = route; preview(); }
  });
  $("ms-route").addEventListener("change", preview);

  async function loadManifest() {
    state.manifest = await call("/api/mobile/" + encodeURIComponent(state.app) + "/ui");
    const select = $("ms-route");
    const current = select.value;
    select.replaceChildren(...state.manifest.routes.map((route) => Object.assign(document.createElement("option"), { value: route, textContent: route })));
    select.value = state.manifest.routes.includes(current) ? current : state.manifest.entry;
    $("ms-version").textContent = "Live version " + state.manifest.version + (state.manifest.updatedAt ? " · updated " + new Date(state.manifest.updatedAt).toLocaleString() : "");
    preview();
  }

  async function loadApp(name) {
    state.app = name;
    status("Loading " + name + "...");
    try {
      if (state.editable) {
        try {
          fill(await call("/api/mobile/" + encodeURIComponent(name) + "/settings"));
          $("ms-lock").hidden = true;
        } catch (error) {
          if (error.status !== 401) throw error;
          $("ms-lock").hidden = false;
          fill(await call("/api/mobile/" + encodeURIComponent(name) + "/ui?target=native"));
        }
      } else {
        fill(await call("/api/mobile/" + encodeURIComponent(name) + "/ui?target=native"));
      }
      await loadManifest();
      status(state.editable ? (token || $("ms-lock").hidden ? "Ready" : "Locked") : "Read-only: changes are disabled on this server", !state.editable);
    } catch (error) {
      status(error.message, true);
    }
  }

  $("ms-unlock").addEventListener("submit", (event) => {
    event.preventDefault();
    token = $("ms-token").value;
    try { sessionStorage.setItem("noderyx:studio-token", token); } catch {}
    $("ms-token").value = "";
    loadApp(state.app);
  });

  $("ms-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.editable) return status("Read-only: changes are disabled on this server", true);
    $("ms-save").disabled = true;
    status("Publishing...");
    try {
      const result = await call("/api/mobile/" + encodeURIComponent(state.app) + "/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(collect())
      });
      await loadManifest();
      status("Published version " + result.version);
    } catch (error) {
      if (error.status === 401) $("ms-lock").hidden = false;
      status(error.message, true);
    } finally {
      $("ms-save").disabled = false;
    }
  });

  $("ms-app").addEventListener("change", () => loadApp($("ms-app").value));

  call("/api/mobile/apps").then(({ apps, editable }) => {
    state.editable = editable;
    $("ms-app").replaceChildren(...apps.map((app) => Object.assign(document.createElement("option"), { value: app.name, textContent: app.appName + " (" + app.name + ")" })));
    if (apps.length) loadApp(apps[0].name);
  }).catch((error) => status(error.message, true));
})();
`;
