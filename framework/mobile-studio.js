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
  const name = escapeHtml(appName);
  return `<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="csrf-token" content="${escapeHtml(csrfToken)}">
<title>Mobile Studio — ${name}</title>
<link rel="stylesheet" href="/public/cool.css">
<link rel="stylesheet" href="${root}/studio.css">
<script src="${root}/studio.js" defer></script>
</head><body class="ms-body" data-base="${root}">
<header class="ms-top">
  <div class="ms-brand"><span class="ms-logo" aria-hidden="true">N</span>
    <div><strong>Mobile Studio</strong><small>${name}</small></div></div>
  <label class="ms-picker">App <select id="ms-app" aria-label="Mobile app"></select></label>
  <span class="ms-pill" id="ms-status" role="status" aria-live="polite" data-tone="busy">Loading</span>
  <div class="ms-top-actions">
    <button class="ms-ghost" type="button" id="ms-lock-btn" hidden>Lock</button>
    <button class="cool-btn secondary cool-btn-small" type="button" id="ms-discard" disabled>Discard</button>
    <button class="cool-btn cool-btn-small" type="submit" form="ms-form" id="ms-save" disabled>Publish to devices</button>
  </div>
</header>
<section class="ms-banner" id="ms-readonly" hidden>
  <div><strong>Read-only</strong>
  <p>Changes are turned off on this server. Set <code>MOBILE_STUDIO_TOKEN</code> (16+ characters) or pass <code>authorize</code> to <code>registerMobileUi</code> to allow publishing.</p></div>
</section>
<section class="ms-banner" id="ms-lock" hidden>
  <div><strong>Unlock to publish</strong>
  <p>Enter the Mobile Studio token. It is kept for this browser tab only.</p></div>
  <form id="ms-unlock" class="ms-unlock"><input id="ms-token" type="password" autocomplete="off" aria-label="Studio token" placeholder="Studio token" required>
  <button class="cool-btn cool-btn-small" type="submit">Unlock</button></form>
</section>
<main class="ms-layout">
  <form class="ms-editor" id="ms-form" novalidate>
  <fieldset class="ms-fields" id="ms-fields">
    <section class="ms-card" aria-labelledby="ms-h-theme">
      <div class="ms-card-head"><div><h2 id="ms-h-theme">Theme</h2>
        <p>Colours, corners, and colour mode. Empty fields use the Cool.css default.</p></div></div>
      <div class="ms-presets" id="ms-presets" role="group" aria-label="Theme presets"></div>
      <div class="ms-grid" id="ms-theme"></div>
      <div class="ms-split">
        <div class="ms-field"><label class="ms-label" for="ms-radius">Corner radius</label>
          <div class="ms-range"><input id="ms-radius" type="range" min="0" max="40" step="1"><output id="ms-radius-out" for="ms-radius"></output>
          <button class="ms-ghost ms-small" type="button" id="ms-radius-reset" hidden>Reset</button></div></div>
        <div class="ms-field"><span class="ms-label" id="ms-mode-label">Colour mode</span>
          <div class="ms-seg" role="radiogroup" aria-labelledby="ms-mode-label">
            <label><input type="radio" name="ms-mode" value="" checked><span>Default</span></label>
            <label><input type="radio" name="ms-mode" value="dark"><span>Dark</span></label>
            <label><input type="radio" name="ms-mode" value="light"><span>Light</span></label>
          </div></div>
      </div>
    </section>
    <section class="ms-card" aria-labelledby="ms-h-data">
      <div class="ms-card-head"><div><h2 id="ms-h-data">Text and content <span class="ms-count" id="ms-data-count">0</span></h2>
        <p>Use in views as <code>{{name}}</code>.</p></div>
        <button class="cool-btn secondary cool-btn-small" type="button" id="ms-add-data">Add text</button></div>
      <div id="ms-data" class="ms-rows"></div>
      <p class="ms-empty">No text yet. Add headlines, labels, or announcements to change them without a release.</p>
    </section>
    <section class="ms-card" aria-labelledby="ms-h-flags">
      <div class="ms-card-head"><div><h2 id="ms-h-flags">Feature flags <span class="ms-count" id="ms-flags-count">0</span></h2>
        <p>Use as <code>{{flags.name}}</code> in views and <code>Noderyx.flags</code> in scripts.</p></div>
        <button class="cool-btn secondary cool-btn-small" type="button" id="ms-add-flag">Add flag</button></div>
      <div id="ms-flags" class="ms-rows"></div>
      <p class="ms-empty">No flags yet. Flags turn features on or off for every installed app.</p>
    </section>
    <p class="ms-note ms-foot">Installed apps pick up published changes on their next launch or resume. Press Ctrl+S to publish.</p>
  </fieldset>
  </form>
  <aside class="ms-preview-panel" aria-label="Preview">
    <div class="ms-preview-bar">
      <label class="ms-picker">Screen <select id="ms-route"></select></label>
      <div class="ms-seg ms-seg-small" role="radiogroup" aria-label="Device size">
        <label><input type="radio" name="ms-device" value="360"><span>Small</span></label>
        <label><input type="radio" name="ms-device" value="390" checked><span>Medium</span></label>
        <label><input type="radio" name="ms-device" value="430"><span>Large</span></label>
      </div>
    </div>
    <div class="ms-phone" id="ms-phone">
      <div class="ms-screen">
        <div class="ms-statusbar" aria-hidden="true"><span>9:41</span><span class="ms-island"></span>
          <span class="ms-sb-icons"><span class="ms-signal"><i></i><i></i><i></i><i></i></span><span class="ms-battery"></span></span></div>
        <iframe id="ms-preview" title="Screen preview" src="${root}/frame" sandbox="allow-same-origin"></iframe>
        <span class="ms-homebar" aria-hidden="true"></span>
      </div>
    </div>
    <p class="ms-note ms-preview-note" id="ms-preview-note"></p>
    <dl class="ms-meta">
      <div><dt>Live version</dt><dd id="ms-version">—</dd></div>
      <div><dt>Last published</dt><dd id="ms-updated">—</dd></div>
    </dl>
  </aside>
</main>
</body></html>
`;
}

// The empty document the preview draws screens into. Being a real frame, the
// screen gets its own viewport, so Cool.css media queries match the phone.
export const STUDIO_FRAME = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Preview</title>
<link rel="stylesheet" href="/public/cool.css">
</head><body></body></html>
`;

export const STUDIO_CSS = `.ms-body{min-height:100vh;margin:0;color:var(--cool-text);background:var(--cool-bg);line-height:1.5}
.ms-body [hidden]{display:none!important}
.ms-body :focus-visible{outline:3px solid rgb(124 92 255 / 45%);outline-offset:2px}
.ms-body code,.ms-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.8em}
.ms-body p code,.ms-body h2 code{padding:.1rem .35rem;border-radius:.35rem;background:rgb(127 127 127 / 16%);color:var(--cool-text)}
.ms-body input[type=text],.ms-body input[type=password],.ms-body textarea,.ms-body select{min-height:2.5rem;padding:.45rem .7rem;border:1px solid var(--cool-border);border-radius:.6rem;color:var(--cool-text);background:var(--cool-surface-solid);font:inherit;font-size:.92rem;transition:border-color .15s,box-shadow .15s}
.ms-body input:focus,.ms-body textarea:focus,.ms-body select:focus{outline:none;border-color:var(--cool-primary);box-shadow:0 0 0 3px rgb(124 92 255 / 25%)}
.ms-body [aria-invalid=true]{border-color:#ff7a90!important}
.ms-body fieldset:disabled{opacity:.7}

.ms-top{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;align-items:center;gap:.75rem 1.25rem;padding:.75rem 1.25rem;border-bottom:1px solid var(--cool-border);background:rgb(9 11 20 / 82%);backdrop-filter:blur(14px)}
.ms-brand{display:flex;align-items:center;gap:.65rem}
.ms-logo{display:grid;place-items:center;width:2.2rem;height:2.2rem;border-radius:.7rem;color:#fff;font-weight:800;background:linear-gradient(135deg,var(--noderyx-violet),var(--runtime-cyan))}
.ms-brand strong{display:block;font-size:1rem;line-height:1.2}
.ms-brand small{display:block;color:var(--cool-muted);font-size:.78rem;line-height:1.2}
.ms-picker{display:inline-flex;align-items:center;gap:.5rem;color:var(--cool-muted);font-size:.85rem}
.ms-pill{display:inline-flex;align-items:center;gap:.45rem;padding:.25rem .7rem;border:1px solid currentColor;border-radius:999px;color:var(--cool-muted);font-size:.8rem;font-weight:600;white-space:nowrap}
.ms-pill::before{content:"";width:.45rem;height:.45rem;border-radius:50%;background:currentColor}
.ms-pill[data-tone=ok]{color:#4ade80}
.ms-pill[data-tone=dirty]{color:#fbbf24}
.ms-pill[data-tone=busy]{color:var(--cool-accent)}
.ms-pill[data-tone=busy]::before{animation:ms-pulse 1s ease-in-out infinite}
.ms-pill[data-tone=error]{color:#ff7a90}
@keyframes ms-pulse{50%{opacity:.25}}
.ms-top-actions{display:flex;align-items:center;gap:.5rem;margin-left:auto}
.ms-top .cool-btn{white-space:nowrap}
.ms-top .cool-btn:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}
.ms-ghost{padding:.4rem .7rem;border:0;border-radius:.5rem;color:var(--cool-muted);background:transparent;font:inherit;font-size:.85rem;cursor:pointer}
.ms-ghost:hover{color:var(--cool-text);background:rgb(127 127 127 / 14%)}
.ms-small{padding:.2rem .5rem;font-size:.78rem}

.ms-banner{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75rem 1.5rem;width:min(1280px,calc(100% - 2.5rem));margin:1.25rem auto 0;padding:1rem 1.25rem;border:1px solid rgb(251 191 36 / 30%);border-radius:1rem;background:rgb(251 191 36 / 7%)}
.ms-banner strong{display:block}
.ms-banner p{margin:.15rem 0 0;color:var(--cool-muted);font-size:.88rem}
.ms-unlock{display:flex;flex-wrap:wrap;gap:.5rem}
.ms-unlock input{width:16rem;max-width:100%}

.ms-layout{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1.75rem;width:min(1280px,calc(100% - 2.5rem));margin:1.25rem auto 3rem}
.ms-fields{display:flex;flex-direction:column;gap:1rem;min-width:0;margin:0;padding:0;border:0}
.ms-card{padding:1.25rem;border:1px solid var(--cool-border);border-radius:1rem;background:var(--cool-surface)}
.ms-card-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:.75rem 1rem;margin-bottom:1rem}
.ms-card-head h2{display:flex;align-items:center;gap:.5rem;margin:0;font-size:1.05rem}
.ms-card-head p{margin:.2rem 0 0;color:var(--cool-muted);font-size:.85rem}
.ms-count{min-width:1.5rem;padding:0 .45rem;border-radius:999px;color:var(--cool-muted);background:rgb(127 127 127 / 18%);font-size:.75rem;font-weight:600;line-height:1.5;text-align:center}
.ms-label{color:var(--cool-muted);font-size:.78rem;font-weight:600}
.ms-msg{grid-area:msg;margin:0;color:#ff7a90;font-size:.78rem}
.ms-msg:empty{display:none}
.ms-note{margin:0;color:var(--cool-muted);font-size:.83rem}
.ms-foot{padding:0 .25rem}

.ms-presets{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem}
.ms-preset{display:inline-flex;align-items:center;gap:.55rem;padding:.35rem .8rem .35rem .4rem;border:1px solid var(--cool-border);border-radius:999px;color:var(--cool-text);background:var(--cool-surface-solid);font:inherit;font-size:.83rem;cursor:pointer;transition:border-color .15s}
.ms-preset:hover{border-color:var(--cool-primary)}
.ms-dots{display:inline-flex}
.ms-dots span{width:1rem;height:1rem;margin-left:-.35rem;border:2px solid var(--cool-surface-solid);border-radius:50%;background:var(--chip)}
.ms-dots span:first-child{margin-left:0}

.ms-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:.65rem}
.ms-color{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"swatch body reset" "msg msg msg";align-items:center;gap:.25rem .65rem;padding:.55rem;border:1px solid var(--cool-border);border-radius:.8rem;background:var(--cool-surface-solid)}
.ms-swatch{position:relative;grid-area:swatch;width:2.5rem;height:2.5rem;overflow:hidden;border-radius:.6rem;background:repeating-conic-gradient(#bbb 0 25%,#fff 0 50%) 0 0/10px 10px;cursor:pointer}
.ms-swatch input{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;opacity:0;cursor:pointer}
.ms-chip{position:absolute;inset:0;border-radius:inherit;background:var(--chip,transparent);box-shadow:inset 0 0 0 1px rgb(127 127 127 / 35%);pointer-events:none}
.ms-color-body{grid-area:body;display:flex;flex-direction:column;min-width:0}
.ms-body input.ms-hex{width:100%;min-height:1.9rem;padding:.15rem .4rem;margin-left:-.4rem;border-color:transparent;background:transparent;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85rem}
.ms-body input.ms-hex:hover{border-color:var(--cool-border)}
.ms-color .ms-reset{grid-area:reset}

.ms-split{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem 1.5rem;margin-top:1.25rem}
.ms-field{display:flex;flex-direction:column;gap:.45rem}
.ms-range{display:flex;align-items:center;gap:.75rem;min-height:2.5rem}
.ms-range input{flex:1;min-width:0;accent-color:var(--cool-primary)}
.ms-range output{min-width:2.8rem;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85rem}
.ms-seg{display:inline-flex;align-self:flex-start;padding:.2rem;border:1px solid var(--cool-border);border-radius:.7rem;background:var(--cool-surface-solid)}
.ms-seg label{position:relative}
.ms-seg input{position:absolute;opacity:0;pointer-events:none}
.ms-seg span{display:block;padding:.35rem .85rem;border-radius:.5rem;color:var(--cool-muted);font-size:.85rem;cursor:pointer;transition:background .15s,color .15s}
.ms-seg span:hover{color:var(--cool-text)}
.ms-seg input:checked+span{color:var(--cool-text);background:rgb(127 127 127 / 22%);font-weight:600}
.ms-seg input:focus-visible+span{outline:3px solid rgb(124 92 255 / 45%)}
.ms-seg-small span{padding:.25rem .65rem;font-size:.8rem}

.ms-rows{display:flex;flex-direction:column;gap:.6rem}
.ms-rows:not(:empty)+.ms-empty{display:none}
.ms-empty{margin:0;padding:1.25rem;border:1px dashed var(--cool-border);border-radius:.8rem;color:var(--cool-muted);font-size:.88rem;text-align:center}
.ms-row{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr) auto;grid-template-areas:"key value remove" "msg msg msg";align-items:start;gap:.35rem .6rem;padding:.6rem;border:1px solid var(--cool-border);border-radius:.8rem;background:var(--cool-surface-solid)}
.ms-row-flag{align-items:center}
.ms-keycell{grid-area:key;display:flex;flex-direction:column;gap:.3rem;min-width:0}
.ms-body input.ms-k{width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85rem}
.ms-usage{align-self:flex-start;max-width:100%;overflow:hidden;color:var(--cool-muted);font-size:.75rem;text-overflow:ellipsis;white-space:nowrap}
.ms-body .ms-row textarea{grid-area:value;width:100%;min-height:2.5rem;max-height:12rem;resize:vertical;field-sizing:content}
.ms-row .ms-switch{grid-area:value}
.ms-row .ms-remove{grid-area:remove}
.ms-icon-btn{display:grid;place-items:center;width:2.5rem;height:2.5rem;padding:0;border:0;border-radius:.6rem;color:var(--cool-muted);background:transparent;cursor:pointer}
.ms-icon-btn:hover{color:#ff7a90;background:rgb(255 122 144 / 12%)}
.ms-icon-btn svg{width:1.1rem;height:1.1rem;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ms-reset{width:2rem;height:2rem}
.ms-reset:hover{color:var(--cool-text);background:rgb(127 127 127 / 16%)}
.ms-switch{display:inline-flex;align-items:center;gap:.6rem;min-height:2.5rem;color:var(--cool-muted);font-size:.88rem;cursor:pointer}
.ms-switch input{position:absolute;width:1px;height:1px;opacity:0}
.ms-track{position:relative;flex:0 0 auto;width:2.6rem;height:1.5rem;border-radius:999px;background:rgb(127 127 127 / 35%);transition:background .2s}
.ms-track::after{content:"";position:absolute;top:.2rem;left:.2rem;width:1.1rem;height:1.1rem;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgb(0 0 0 / 30%);transition:transform .2s}
.ms-switch input:checked+.ms-track{background:var(--cool-primary)}
.ms-switch input:checked+.ms-track::after{transform:translateX(1.1rem)}
.ms-switch input:focus-visible+.ms-track{outline:3px solid rgb(124 92 255 / 45%);outline-offset:2px}
.ms-state::before{content:"Off"}
.ms-switch input:checked~.ms-state{color:var(--cool-text)}
.ms-switch input:checked~.ms-state::before{content:"On"}

.ms-preview-panel{position:sticky;top:5rem;align-self:start;display:flex;flex-direction:column;align-items:center;gap:.85rem;width:min(460px,100%)}
.ms-preview-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.6rem;width:100%}
.ms-preview-bar select{max-width:12rem}
.ms-phone{--ms-device:390px;width:calc(var(--ms-device) + 24px);max-width:100%;padding:12px;border-radius:3rem;background:#030408;box-shadow:0 0 0 1px rgb(255 255 255 / 12%),0 0 0 4px #1b1e2b,0 30px 80px rgb(0 0 0 / 45%);transition:width .25s}
.ms-screen{position:relative;display:flex;flex-direction:column;height:min(calc(var(--ms-device) * 2.05),calc(100vh - 13rem));min-height:520px;overflow:hidden;border-radius:2.3rem;color:var(--ms-screen-text,var(--cool-text));background:var(--ms-screen,var(--cool-bg))}
.ms-statusbar{position:relative;display:flex;flex:0 0 auto;align-items:center;justify-content:space-between;height:2.75rem;padding:0 1.7rem 0 1.9rem;font-size:.85rem;font-weight:650}
.ms-island{position:absolute;top:.6rem;left:50%;width:6.4rem;height:1.65rem;margin-left:-3.2rem;border-radius:999px;background:#000}
.ms-sb-icons{display:inline-flex;align-items:center;gap:.35rem}
.ms-signal{display:inline-flex;align-items:flex-end;gap:2px;height:.7rem}
.ms-signal i{width:3px;border-radius:1px;background:currentColor}
.ms-signal i:nth-child(1){height:35%}.ms-signal i:nth-child(2){height:55%}.ms-signal i:nth-child(3){height:78%}.ms-signal i:nth-child(4){height:100%}
.ms-battery{position:relative;width:1.4rem;height:.7rem;border:1.5px solid currentColor;border-radius:.22rem;opacity:.9}
.ms-battery::before{content:"";position:absolute;inset:1.5px;right:30%;border-radius:1px;background:currentColor}
.ms-battery::after{content:"";position:absolute;top:50%;right:-4px;width:2px;height:.3rem;margin-top:-.15rem;border-radius:0 1px 1px 0;background:currentColor}
.ms-screen iframe{display:block;flex:1;width:100%;border:0;background:transparent}
.ms-homebar{position:absolute;bottom:.45rem;left:50%;width:8rem;height:.3rem;margin-left:-4rem;border-radius:999px;background:currentColor;opacity:.5;pointer-events:none}
.ms-preview-note{min-height:1.3em;text-align:center}
.ms-meta{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;width:100%;margin:0;padding:.75rem 1rem;border:1px solid var(--cool-border);border-radius:.8rem;background:var(--cool-surface)}
.ms-meta dt{color:var(--cool-muted);font-size:.75rem}
.ms-meta dd{margin:0;overflow:hidden;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.82rem;text-overflow:ellipsis;white-space:nowrap}

@media (max-width:1040px){
  .ms-layout{grid-template-columns:minmax(0,1fr)}
  .ms-preview-panel{position:static;justify-self:center}
}
@media (max-width:640px){
  .ms-top{padding:.65rem 1rem}
  .ms-top-actions{width:100%;margin-left:0}
  .ms-top-actions .cool-btn{flex:1}
  .ms-layout,.ms-banner{width:calc(100% - 2rem)}
  .ms-card{padding:1rem}
  .ms-row{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"key remove" "value value" "msg msg"}
  .ms-screen{min-height:460px}
}
`;

// String.raw keeps the regular expressions below readable. Do not use
// template literals or "${" inside it.
export const STUDIO_JS = String.raw`// Generated by Noderyx: Mobile Studio.
(() => {
  const $ = (id) => document.getElementById(id);
  const make = (tag, className, props) => Object.assign(document.createElement(tag), className ? { className } : {}, props ?? {});
  const BASE = document.body.dataset.base || "/mobile-studio";
  const TOKENS = { primary: "Primary", accent: "Accent", background: "Background", surface: "Surface", text: "Text", muted: "Muted text", border: "Border" };
  const VARS = { primary: ["--cool-primary", "--noderyx-violet"], accent: ["--cool-accent", "--runtime-cyan"], background: ["--cool-bg", "--kernel-night"], surface: ["--cool-surface", "--cool-surface-solid"], text: ["--cool-text"], muted: ["--cool-muted"], border: ["--cool-border"] };
  // Same rules the server applies in validateSettings().
  const COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/]+\))$/i;
  const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
  const MAX_TEXT = 5000;
  const DEFAULT_RADIUS = 20;
  const PRESETS = [
    { name: "Noderyx", dots: ["#7c5cff", "#22d3ee", "#090b14"], theme: {} },
    { name: "Ocean", theme: { primary: "#0ea5e9", accent: "#2dd4bf", background: "#06141f", surface: "#0c2233", text: "#e6f4fb", muted: "#8fb3c7", border: "#1d3a4f" } },
    { name: "Forest", theme: { primary: "#22c55e", accent: "#a3e635", background: "#08120c", surface: "#122019", text: "#ecf5ee", muted: "#93a99a", border: "#22382a" } },
    { name: "Sunset", theme: { primary: "#f97316", accent: "#f43f5e", background: "#160b0a", surface: "#251413", text: "#fbefe9", muted: "#b8988c", border: "#3b2220" } },
    { name: "Paper", theme: { mode: "light", primary: "#4f46e5", accent: "#0891b2", background: "#f7f7f4", surface: "#ffffff", text: "#1a1a1a", muted: "#6b6b6b", border: "#e4e4dd", radius: 12 } }
  ];
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content ?? "";
  const state = { app: null, manifest: null, editable: false, authorized: false, baseline: "", baselineContent: "", draft: null, dirty: false, busy: false, notice: null, draftNote: "", shownRoute: null };
  let token = "";
  try { token = sessionStorage.getItem("noderyx:studio-token") ?? ""; } catch {}

  const api = (path) => "/api/mobile/" + encodeURIComponent(state.app) + path;

  async function call(path, init = {}) {
    const headers = { accept: "application/json", ...(init.headers ?? {}) };
    if (token) headers.authorization = "Bearer " + token;
    const response = await fetch(path, { credentials: "same-origin", ...init, headers });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.message ?? body?.error ?? "Request failed (" + response.status + ")");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function icon(paths) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    for (const d of paths) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  }
  const TRASH = ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"];
  const UNDO = ["M9 14L4 9l5-5", "M4 9h10a6 6 0 0 1 0 12h-3"];

  // ----- Theme fields -----
  const fields = {};
  for (const [name, label] of Object.entries(TOKENS)) {
    const wrap = make("div", "ms-color");
    const swatch = make("label", "ms-swatch");
    const picker = make("input", "", { type: "color" });
    picker.setAttribute("aria-label", label + " colour picker");
    const chip = make("span", "ms-chip");
    swatch.append(picker, chip);
    const body = make("div", "ms-color-body");
    const caption = make("label", "ms-label", { htmlFor: "ms-t-" + name, textContent: label });
    const text = make("input", "ms-hex", { type: "text", id: "ms-t-" + name, autocomplete: "off", spellcheck: false });
    body.append(caption, text);
    const reset = make("button", "ms-icon-btn ms-reset", { type: "button", title: "Use default" });
    reset.setAttribute("aria-label", "Reset " + label + " to default");
    reset.append(icon(UNDO));
    const message = make("p", "ms-msg");
    wrap.append(swatch, body, reset, message);
    picker.addEventListener("input", () => { text.value = picker.value; changed("theme"); });
    text.addEventListener("input", () => changed("theme"));
    reset.addEventListener("click", () => { text.value = ""; changed("theme"); text.focus(); });
    fields[name] = { picker, chip, text, reset, message };
    $("ms-theme").append(wrap);
  }

  const radius = $("ms-radius");
  radius.addEventListener("input", () => { radius.dataset.touched = "1"; changed("theme"); });
  $("ms-radius-reset").addEventListener("click", () => { delete radius.dataset.touched; radius.value = DEFAULT_RADIUS; changed("theme"); });
  const modeValue = () => document.querySelector('input[name="ms-mode"]:checked')?.value ?? "";
  const setMode = (mode) => { for (const input of document.querySelectorAll('input[name="ms-mode"]')) input.checked = input.value === (mode ?? ""); };
  for (const input of document.querySelectorAll('input[name="ms-mode"]')) input.addEventListener("change", () => changed("theme"));

  for (const preset of PRESETS) {
    const button = make("button", "ms-preset", { type: "button" });
    const dots = make("span", "ms-dots");
    for (const color of preset.dots ?? [preset.theme.primary, preset.theme.accent, preset.theme.background]) {
      const dot = make("span");
      dot.style.setProperty("--chip", color);
      dots.append(dot);
    }
    button.append(dots, preset.name);
    button.addEventListener("click", () => {
      for (const name of Object.keys(TOKENS)) fields[name].text.value = preset.theme[name] ?? "";
      setMode(preset.theme.mode);
      if (preset.theme.radius !== undefined) { radius.value = preset.theme.radius; radius.dataset.touched = "1"; }
      else { radius.value = DEFAULT_RADIUS; delete radius.dataset.touched; }
      changed("theme");
    });
    $("ms-presets").append(button);
  }

  // ----- Text and flag rows -----
  function addRow(kind, key = "", value = "", focus = false) {
    const row = make("div", "ms-row ms-row-" + kind);
    const keyCell = make("div", "ms-keycell");
    const name = make("input", "ms-k", { type: "text", value: key, placeholder: kind === "flag" ? "flag_name" : "text_name", autocomplete: "off", spellcheck: false });
    name.setAttribute("aria-label", kind === "flag" ? "Flag name" : "Text name");
    const usage = make("code", "ms-usage");
    keyCell.append(name, usage);
    let input;
    if (kind === "flag") {
      const toggle = make("label", "ms-switch");
      input = make("input", "ms-v", { type: "checkbox", checked: value === true || value === "true" });
      input.setAttribute("aria-label", "Enabled");
      toggle.append(input, make("span", "ms-track"), make("span", "ms-state"));
      row.append(keyCell, toggle);
      input.addEventListener("change", () => changed(kind));
    } else {
      input = make("textarea", "ms-v", { rows: 1, value: String(value), placeholder: "Text shown in the app" });
      input.setAttribute("aria-label", "Text value");
      row.append(keyCell, input);
      input.addEventListener("input", () => changed(kind));
    }
    const remove = make("button", "ms-icon-btn ms-remove", { type: "button", title: "Remove" });
    remove.setAttribute("aria-label", "Remove " + (kind === "flag" ? "flag" : "text"));
    remove.append(icon(TRASH));
    remove.addEventListener("click", () => { row.remove(); changed(kind); });
    name.addEventListener("input", () => changed(kind));
    row.append(remove, make("p", "ms-msg"));
    (kind === "flag" ? $("ms-flags") : $("ms-data")).append(row);
    if (focus) name.focus();
  }
  $("ms-add-data").addEventListener("click", () => { addRow("data", "", "", true); changed("data"); });
  $("ms-add-flag").addEventListener("click", () => { addRow("flag", "", false, true); changed("flag"); });

  const rows = (id) => [...$(id).children].map((row) => ({ row, name: row.querySelector(".ms-k"), value: row.querySelector(".ms-v") }));

  function collect() {
    const theme = {};
    for (const name of Object.keys(TOKENS)) {
      const value = fields[name].text.value.trim();
      if (value) theme[name] = value;
    }
    if (radius.dataset.touched) theme.radius = Number(radius.value);
    if (modeValue()) theme.mode = modeValue();
    const data = {};
    for (const { name, value } of rows("ms-data")) if (name.value.trim()) data[name.value.trim()] = value.value;
    const flags = {};
    for (const { name, value } of rows("ms-flags")) if (name.value.trim()) flags[name.value.trim()] = value.checked;
    return { theme, data, flags };
  }
  const snapshot = () => JSON.stringify(collect());
  const contentKey = () => { const { data, flags } = collect(); return JSON.stringify([data, flags]); };

  // Marks problems next to the field and returns how many there are.
  function validate() {
    let count = 0;
    const mark = (input, message, slot) => {
      input.setAttribute("aria-invalid", message ? "true" : "false");
      if (message && !slot.textContent) slot.textContent = message;
      if (message) count += 1;
    };
    for (const field of Object.values(fields)) {
      field.message.textContent = "";
      const value = field.text.value.trim();
      mark(field.text, value && !COLOR.test(value) ? "Use a colour such as #7c5cff or rgb(124 92 255)" : "", field.message);
    }
    for (const [id, kind] of [["ms-data", "data"], ["ms-flags", "flag"]]) {
      const seen = new Set();
      for (const { row, name, value } of rows(id)) {
        const slot = row.querySelector(".ms-msg");
        slot.textContent = "";
        const key = name.value.trim();
        const filled = kind === "data" ? value.value !== "" : value.checked;
        let problem = "";
        if (!key) problem = filled ? "Give this a name" : "";
        else if (!KEY.test(key)) problem = "Use letters, numbers, and _ only, not starting with a number";
        else if (seen.has(key)) problem = "This name is already used";
        seen.add(key);
        mark(name, problem, slot);
        if (kind === "data") mark(value, value.value.length > MAX_TEXT ? "Keep text under " + MAX_TEXT + " characters" : "", slot);
        row.querySelector(".ms-usage").textContent = "{{" + (kind === "flag" ? "flags." : "") + (key || "name") + "}}";
      }
    }
    return count;
  }

  function fill(settings) {
    const theme = settings.theme ?? {};
    for (const name of Object.keys(TOKENS)) fields[name].text.value = theme[name] ?? "";
    radius.value = theme.radius ?? DEFAULT_RADIUS;
    if (theme.radius !== undefined) radius.dataset.touched = "1";
    else delete radius.dataset.touched;
    setMode(theme.mode);
    $("ms-data").replaceChildren();
    $("ms-flags").replaceChildren();
    for (const [key, value] of Object.entries(settings.data ?? {})) addRow("data", key, value);
    for (const [key, value] of Object.entries(settings.flags ?? {})) addRow("flag", key, value);
    state.baseline = snapshot();
    state.baselineContent = contentKey();
    state.draft = null;
    state.draftNote = "";
    applyTheme();
    updateUi();
  }

  function setStatus(text, tone) {
    $("ms-status").textContent = text;
    $("ms-status").dataset.tone = tone;
  }

  function updateUi() {
    const problems = validate();
    state.dirty = snapshot() !== state.baseline;
    $("ms-save").disabled = state.busy || !state.editable || !state.dirty || problems > 0;
    $("ms-discard").disabled = state.busy || !state.dirty;
    $("ms-data-count").textContent = $("ms-data").children.length;
    $("ms-flags-count").textContent = $("ms-flags").children.length;
    for (const field of Object.values(fields)) field.reset.hidden = !field.text.value;
    $("ms-radius-reset").hidden = !radius.dataset.touched;
    $("ms-radius-out").textContent = radius.value + "px";
    $("ms-lock-btn").hidden = !(state.authorized && token);

    let note = state.draftNote;
    if (!note) {
      if (!state.dirty) note = "Matches what installed apps show.";
      else if (!state.authorized && contentKey() !== state.baselineContent) note = "Theme edits show here. Unlock to preview text and flags too.";
      else note = "Showing your unpublished changes.";
    }
    $("ms-preview-note").textContent = note;

    if (state.busy) return;
    if (state.notice) setStatus(state.notice.text, state.notice.tone);
    else if (!state.app) setStatus("No apps", "muted");
    else if (!state.editable) setStatus("Read-only", "muted");
    else if (problems) setStatus(problems === 1 ? "1 issue to fix" : problems + " issues to fix", "error");
    else if (state.dirty) setStatus("Unsaved changes", "dirty");
    else if (!state.authorized) setStatus("Locked", "muted");
    else setStatus("Up to date", "ok");
  }

  function changed(kind) {
    state.notice = null;
    if (kind === "theme") applyTheme();
    else scheduleDraft();
    updateUi();
  }

  // ----- Preview -----
  // Screens are drawn into a same-origin frame so they get a phone-sized
  // viewport. The frame is sandboxed without scripts; the studio builds the
  // DOM from the compiled page and drops scripts and inline handlers.
  const frame = $("ms-preview");
  let doc = null;
  const decode = (value) => { const area = document.createElement("textarea"); area.innerHTML = value; return area.value; };
  const SKIP = new Set(["script", "link", "meta", "title", "style", "head", "iframe", "frame", "object", "embed", "base"]);
  const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

  function toHex(color) {
    if (!color || !canvas) return null;
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = "#000";
    canvas.fillStyle = color;
    canvas.fillRect(0, 0, 1, 1);
    const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
    return "#" + [r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("");
  }

  function build(node) {
    if (typeof node === "string") return doc.createTextNode(decode(node));
    if (!node?.tag || SKIP.has(node.tag)) return null;
    const element = doc.createElement(node.tag === "body" || node.tag === "html" ? "div" : node.tag);
    for (const [name, value] of Object.entries(node.attrs ?? {})) {
      const text = decode(value);
      if (/^on/i.test(name) || name === "style" || name === "srcdoc" || /^\s*(javascript|data|vbscript):/i.test(text)) continue;
      try { element.setAttribute(name, text); } catch {}
    }
    for (const child of node.children ?? []) {
      const built = build(child);
      if (built) element.append(built);
    }
    return element;
  }

  function find(nodes, tag) {
    for (const node of nodes ?? []) {
      if (typeof node === "string") continue;
      if (node.tag === tag) return node;
      const found = find(node.children, tag);
      if (found) return found;
    }
    return null;
  }

  function renderPage(keepScroll = false) {
    if (!doc || !state.manifest) return;
    const pages = state.draft?.pages ?? state.manifest.pages ?? {};
    const route = $("ms-route").value || state.manifest.entry;
    const source = pages[route];
    let tree = null;
    if (typeof source === "string" && source.startsWith("MNF1\n")) {
      try { tree = JSON.parse(source.slice(5)).document; } catch {}
    }
    const head = find(tree, "head");
    const body = find(tree, "body");

    // Same-origin stylesheets the screen links to, so app styles apply.
    const wanted = ["/public/cool.css"];
    for (const node of head?.children ?? []) {
      if (typeof node === "string" || node.tag !== "link") continue;
      const rel = decode(node.attrs?.rel ?? "").toLowerCase();
      const href = decode(node.attrs?.href ?? "");
      if (rel === "stylesheet" && href.startsWith("/") && !href.startsWith("//") && !wanted.includes(href)) wanted.push(href);
    }
    const current = [...doc.head.querySelectorAll('link[rel="stylesheet"]')];
    if (current.map((link) => link.getAttribute("href")).join("|") !== wanted.join("|")) {
      for (const link of current) link.remove();
      for (const href of wanted) doc.head.append(Object.assign(doc.createElement("link"), { rel: "stylesheet", href }));
    }

    const scroller = doc.scrollingElement ?? doc.documentElement;
    const top = keepScroll && state.shownRoute === route ? scroller.scrollTop : 0;
    if (body) {
      doc.body.replaceChildren(...(body.children ?? []).map(build).filter(Boolean));
      doc.body.className = decode(body.attrs?.class ?? "");
    } else {
      const empty = doc.createElement("p");
      empty.className = "cool-muted";
      empty.textContent = "This screen has no preview.";
      doc.body.replaceChildren(empty);
      doc.body.className = "";
    }
    scroller.scrollTop = top;
    state.shownRoute = route;
    applyTheme();
  }

  function applyTheme() {
    const { theme } = collect();
    if (!doc) return;
    const root = doc.documentElement;
    for (const [name, properties] of Object.entries(VARS)) {
      const value = COLOR.test(theme[name] ?? "") ? theme[name] : "";
      for (const property of properties) {
        if (value) root.style.setProperty(property, value);
        else root.style.removeProperty(property);
      }
    }
    if (theme.radius !== undefined) root.style.setProperty("--cool-radius", theme.radius + "px");
    else root.style.removeProperty("--cool-radius");
    if (theme.mode) root.dataset.theme = theme.mode;
    else root.removeAttribute("data-theme");

    // Swatches show the colour in effect, including Cool.css defaults.
    const computed = doc.defaultView.getComputedStyle(root);
    for (const [name, field] of Object.entries(fields)) {
      const own = field.text.value.trim();
      const effective = own && COLOR.test(own) ? own : computed.getPropertyValue(VARS[name][0]).trim();
      field.chip.style.setProperty("--chip", effective || "transparent");
      if (!own) field.text.placeholder = effective || "default";
      const hex = toHex(effective);
      if (hex) field.picker.value = hex;
    }
    const phone = $("ms-phone");
    phone.style.setProperty("--ms-screen", computed.getPropertyValue("--cool-bg").trim() || "#090b14");
    phone.style.setProperty("--ms-screen-text", computed.getPropertyValue("--cool-text").trim() || "#f4f5fb");
  }

  function attachFrame() {
    const candidate = frame.contentDocument;
    if (!candidate || candidate.readyState !== "complete" || candidate.URL === "about:blank" || candidate === doc) return;
    doc = candidate;
    doc.documentElement.style.setProperty("scrollbar-width", "none");
    // Links switch the previewed screen instead of navigating; forms stay put.
    doc.addEventListener("click", (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute("href");
      if (href.startsWith("#")) { doc.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth" }); return; }
      const route = href.replace(/^\/+|\/+$/g, "").split(/[?#]/)[0] || state.manifest?.entry;
      if (state.manifest?.routes?.includes(route)) { $("ms-route").value = route; renderPage(); }
    });
    doc.addEventListener("submit", (event) => event.preventDefault());
    renderPage();
  }
  frame.addEventListener("load", attachFrame);
  attachFrame();

  $("ms-route").addEventListener("change", () => renderPage());

  const phone = $("ms-phone");
  const setDevice = (width) => {
    phone.style.setProperty("--ms-device", width + "px");
    for (const input of document.querySelectorAll('input[name="ms-device"]')) input.checked = input.value === String(width);
  };
  for (const input of document.querySelectorAll('input[name="ms-device"]')) {
    input.addEventListener("change", () => {
      setDevice(input.value);
      try { localStorage.setItem("noderyx:studio-device", input.value); } catch {}
    });
  }
  try { const saved = localStorage.getItem("noderyx:studio-device"); if (["360", "390", "430"].includes(saved)) setDevice(saved); } catch {}

  // Text and flags are compiled into the screens on the server, so unpublished
  // values are previewed by asking the server to compile them without saving.
  let draftTimer = null;
  let draftSeq = 0;
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(refreshDraft, 350);
  }
  async function refreshDraft() {
    if (!state.manifest) return;
    const seq = ++draftSeq;
    if (contentKey() === state.baselineContent) {
      state.draftNote = "";
      if (state.draft) { state.draft = null; renderPage(true); }
      updateUi();
      return;
    }
    if (!state.authorized || validate() > 0) return;
    try {
      const result = await call(api("/preview"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(collect())
      });
      if (seq !== draftSeq) return;
      state.draft = result;
      state.draftNote = "";
      renderPage(true);
    } catch (error) {
      if (seq !== draftSeq) return;
      state.draftNote = "Preview could not update: " + error.message;
    }
    updateUi();
  }

  // ----- Loading and publishing -----
  function formatTime(value) {
    if (!value) return "Never";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  async function loadManifest() {
    state.manifest = await call(api("/ui"));
    const select = $("ms-route");
    const current = select.value;
    const { entry, routes } = state.manifest;
    const ordered = [entry, ...routes.filter((route) => route !== entry && !route.startsWith("errors/")), ...routes.filter((route) => route !== entry && route.startsWith("errors/"))].filter((route) => routes.includes(route));
    select.replaceChildren(...ordered.map((route) => make("option", "", { value: route, textContent: route === entry ? route + " (start)" : route })));
    select.value = routes.includes(current) ? current : entry;
    $("ms-version").textContent = state.manifest.version;
    $("ms-version").title = state.manifest.version;
    $("ms-updated").textContent = formatTime(state.manifest.updatedAt);
    renderPage(true);
  }

  async function loadApp(name) {
    state.app = name;
    state.manifest = null;
    state.notice = null;
    state.busy = true;
    setStatus("Loading", "busy");
    try {
      let settings = null;
      state.authorized = false;
      if (state.editable) {
        try {
          settings = await call(api("/settings"));
          state.authorized = true;
        } catch (error) {
          if (error.status !== 401) throw error;
        }
      }
      settings ??= await call(api("/ui?target=native"));
      $("ms-lock").hidden = !state.editable || state.authorized;
      $("ms-readonly").hidden = state.editable;
      $("ms-fields").disabled = !state.editable;
      fill(settings);
      await loadManifest();
    } catch (error) {
      state.notice = { text: error.message, tone: "error" };
    } finally {
      state.busy = false;
      updateUi();
    }
  }

  $("ms-unlock").addEventListener("submit", async (event) => {
    event.preventDefault();
    token = $("ms-token").value.trim();
    $("ms-token").value = "";
    state.busy = true;
    setStatus("Checking token", "busy");
    try {
      const settings = await call(api("/settings"));
      try { sessionStorage.setItem("noderyx:studio-token", token); } catch {}
      state.authorized = true;
      $("ms-lock").hidden = true;
      // Keep edits made while locked; otherwise start from the stored settings.
      if (!state.dirty) fill(settings);
      state.notice = { text: "Unlocked", tone: "ok" };
      scheduleDraft();
    } catch (error) {
      token = "";
      state.notice = { text: error.status === 401 ? "That token was not accepted" : error.message, tone: "error" };
      $("ms-token").focus();
    } finally {
      state.busy = false;
      updateUi();
    }
  });

  $("ms-lock-btn").addEventListener("click", () => {
    token = "";
    try { sessionStorage.removeItem("noderyx:studio-token"); } catch {}
    state.authorized = false;
    state.draft = null;
    $("ms-lock").hidden = false;
    renderPage(true);
    updateUi();
  });

  $("ms-discard").addEventListener("click", () => {
    fill(JSON.parse(state.baseline));
    renderPage(true);
  });

  $("ms-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.editable || state.busy || validate() > 0) return updateUi();
    if (!state.authorized) {
      $("ms-lock").hidden = false;
      $("ms-token").focus();
      state.notice = { text: "Unlock to publish", tone: "error" };
      return updateUi();
    }
    state.busy = true;
    setStatus("Publishing", "busy");
    updateUi();
    try {
      const result = await call(api("/settings"), {
        method: "PUT",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(collect())
      });
      fill(result.settings ?? collect());
      await loadManifest();
      state.notice = { text: "Published", tone: "ok" };
    } catch (error) {
      if (error.status === 401) {
        state.authorized = false;
        $("ms-lock").hidden = false;
      }
      state.notice = { text: error.message, tone: "error" };
    } finally {
      state.busy = false;
      updateUi();
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!$("ms-save").disabled) $("ms-form").requestSubmit();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty) event.preventDefault();
  });

  const appSelect = $("ms-app");
  appSelect.addEventListener("change", () => {
    if (state.dirty && !confirm("Discard unpublished changes to " + state.app + "?")) {
      appSelect.value = state.app;
      return;
    }
    loadApp(appSelect.value);
  });

  call("/api/mobile/apps").then(({ apps, editable }) => {
    state.editable = editable;
    appSelect.replaceChildren(...apps.map((app) => make("option", "", { value: app.name, textContent: app.appName + " (" + app.name + ")" })));
    appSelect.disabled = apps.length < 2;
    if (apps.length) loadApp(apps[0].name);
    else updateUi();
  }).catch((error) => setStatus(error.message, "error"));
})();
`;
