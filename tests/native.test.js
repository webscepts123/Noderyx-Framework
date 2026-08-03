import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseJs } from "@babel/parser";
import { compile, parse } from "../framework/compiler.js";
import { renderHtml } from "../framework/renderers/html.js";
import { renderNative } from "../framework/renderers/native.js";
import { buildNative, initNativeProject, stylesModule, themeModule } from "../framework/native.js";

const SOURCE = `html lang="en"
  head
    title "{{siteName}} â€” Noderyx"
    script src="/public/home.js"
  body
    main.cool-container
      h1 "Hello {{user.name}}"
      p.cool-muted "Welcome back"
      a.cool-btn href="/about" "About"
      button#save type="button" "Save"
      img src="{{avatar}}" alt="Your avatar"
      input type="email" placeholder="Email"
      ul
        li "One"
`;

/** Every generated file must be real, parseable JSX. */
function assertParses(source, label) {
  try {
    parseJs(source, { sourceType: "module", plugins: ["jsx"] });
  } catch (error) {
    assert.fail(`${label} is not valid JSX: ${error.message}\n\n${source}`);
  }
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

test("parse produces a renderer-agnostic tree that keeps placeholders intact", () => {
  const [root] = parse(`main#app.cool-container.cool-stack data-role="page"\n  h1 "Hi {{name}}"`);

  assert.equal(root.type, "element");
  assert.equal(root.tag, "main");
  assert.equal(root.id, "app");
  assert.deepEqual(root.classes, ["cool-container", "cool-stack"]);
  assert.equal(root.attributes["data-role"], "page");
  assert.equal(root.children[0].text, "Hi {{name}}");
  assert.equal(root.children[0].line, 2);
});

test("a parsed tree renders repeatedly with different data", () => {
  const tree = parse(`div\n  p "Hello {{name}}"`);
  assert.match(renderHtml(tree, { name: "Ada" }), /<p>Hello Ada<\/p>/);
  assert.match(renderHtml(tree, { name: "Grace" }), /<p>Hello Grace<\/p>/);
});

test("if / else if / else pick exactly one branch", () => {
  const tree = parse(`div
  if user.name
    p "Hello {{user.name}}"
  else if guest
    p "Guest"
  else
    p "Sign in"`);

  assert.match(renderHtml(tree, { user: { name: "Ada" } }), /Hello Ada/);
  assert.match(renderHtml(tree, { guest: true }), /Guest/);
  assert.match(renderHtml(tree, {}), /Sign in/);

  const chosen = renderHtml(tree, { user: { name: "Ada" }, guest: true });
  assert.doesNotMatch(chosen, /Guest/);
  assert.doesNotMatch(chosen, /Sign in/);
});

test("conditions support negation and comparison", () => {
  const tree = parse(`div
  if !posts
    p "Empty"
  if status == "live"
    p "Live"
  if status != "live"
    p "Draft"`);

  assert.match(renderHtml(tree, { posts: [], status: "live" }), /Empty/);
  assert.match(renderHtml(tree, { posts: [], status: "live" }), /Live/);
  assert.doesNotMatch(renderHtml(tree, { posts: [1], status: "live" }), /Empty/);
  assert.match(renderHtml(tree, { posts: [1], status: "draft" }), /Draft/);
});

test("for repeats its children and can bind the index", () => {
  const tree = parse(`ul\n  for tag, position in tags\n    li "{{position}}: {{tag}}"`);
  const html = renderHtml(tree, { tags: ["node", "mobile"] });

  assert.match(html, /<li>0: node<\/li>/);
  assert.match(html, /<li>1: mobile<\/li>/);
  assert.doesNotMatch(renderHtml(tree, {}), /<li>/, "a missing collection renders nothing");
  assert.doesNotMatch(renderHtml(tree, { tags: "not an array" }), /<li>/);
});

test("components take props and render in the caller's data", () => {
  const tree = parse(`component Card(post)
  article.cool-card
    h3 "{{post.title}}"
    p "{{site}}"

div
  Card post="{{featured}}"`);

  const html = renderHtml(tree, { featured: { title: "First" }, site: "Noderyx" });
  assert.match(html, /<h3>First<\/h3>/);
  assert.match(html, /<p>Noderyx<\/p>/, "outer data stays visible");
  assert.doesNotMatch(html, /component/);
});

test("a component that renders itself is reported instead of hanging", () => {
  const tree = parse(`component Loop(item)
  Loop item="{{item}}"

div
  Loop item="{{x}}"`);
  assert.throws(() => renderHtml(tree, { x: 1 }), /renders itself/);
});

test("malformed control flow is reported with its line", () => {
  assert.throws(() => parse(`div\n  for x of items\n    p "a"`), /Line 2: expected "for item in items"/);
  assert.throws(() => parse(`div\n  else\n    p "a"`), /Line 2: "else" must follow an "if"/);
  assert.throws(() => parse(`div\n  if\n    p "a"`), /Line 2: could not read condition/);
  assert.throws(() => parse(`component lower\n  p "a"`), /expected "component Name/);
});

test("the HTML renderer still rejects unsupported tags and void tags with children", () => {
  assert.throws(() => compile("marquee"), /Unsupported HTML tag: marquee/);
  assert.throws(() => compile(`div\n  input type="text"\n    span "x"`), /cannot contain child elements/);
  assert.equal(renderHtml(parse(`p "Hi"`), {}, { doctype: false }), "<p>Hi</p>");
});

// ---------------------------------------------------------------------------
// Native rendering
// ---------------------------------------------------------------------------

test("native rendering maps every element to a React Native primitive", () => {
  const { source } = renderNative(parse(SOURCE), { route: "home" });
  assertParses(source, "home screen");

  assert.match(source, /<View style=\{s\.mainCoolContainer\}/);
  assert.match(source, /<Text style=\{s\.h1\}/);
  assert.match(source, /<Pressable .*onPress=\{\(\) => navigate\("\/about"\)\}.*accessibilityRole="link"/);
  assert.match(source, /<Pressable .*accessibilityRole="button"/);
  assert.match(source, /<Image .*source=\{\{ uri:/);
  assert.match(source, /<TextInput .*keyboardType="email-address"/);
  assert.match(source, /testID="save"/);
  assert.doesNotMatch(source, /home\.js/, "<script> has no native equivalent");
  assert.doesNotMatch(source, /WebView/i, "nothing renders through a WebView");
});

test("native screens are memoized and take data as props", () => {
  const { source } = renderNative(parse(SOURCE), { route: "home" });
  assert.match(source, /export default React\.memo\(Home\)/);
  assert.match(source, /\{`Hello \$\{value\(data, "user\.name"\)\}`\}/);
  assert.match(source, /export const title = \(data = \{\}\) => `\$\{value\(data, "siteName"\)\} â€” Noderyx`/);
});

test("loop and component variables compile to direct property access", () => {
  const { source } = renderNative(parse(`component Card(post)
  h3 "{{post.title}}"

div
  for item, position in things
    p "{{position}} {{item.label}} {{siteName}}"
  Card post="{{featured}}"`), { route: "feed" });
  assertParses(source, "feed screen");

  // Names bound by the loop become real variables, not dictionary lookups.
  assert.match(source, /str\(item\?\.label\)/);
  assert.match(source, /str\(position\)/);
  assert.match(source, /str\(post\?\.title\)/);
  // Everything else still reads from the screen data.
  assert.match(source, /value\(data, "siteName"\)/);
  assert.match(source, /post=\{read\(data, "featured"\)\}/);
});

test("list renders a virtualized FlatList and drops the outer ScrollView", () => {
  const { source } = renderNative(parse(`div\n  list post in posts\n    p "{{post.title}}"`), { route: "feed" });
  assertParses(source, "list screen");

  assert.match(source, /<FlatList/);
  assert.match(source, /data=\{items\(read\(data, "posts"\)\)\}/);
  assert.match(source, /keyExtractor=\{keyFor\}/);
  assert.match(source, /removeClippedSubviews/);
  // Nesting a FlatList in a ScrollView would mount every row at once.
  assert.doesNotMatch(source, /<ScrollView/);
});

test("for renders inline with a stable key and keeps the ScrollView", () => {
  const { source } = renderNative(parse(`div\n  for post in posts\n    p "{{post.title}}"`), { route: "feed" });
  assertParses(source, "inline loop screen");

  assert.match(source, /\.map\(\(post, _index\) =>/);
  assert.match(source, /<React\.Fragment key=\{keyFor\(post, _index\)\}>/);
  assert.match(source, /<ScrollView/);
});

test("conditions compile to plain JavaScript", () => {
  const { source } = renderNative(parse(`div
  if user.name
    p "a"
  else
    p "b"
  if !posts
    p "c"
  if status == "live"
    p "d"
  if status != "live"
    p "e"`), { route: "home" });
  assertParses(source, "condition screen");

  assert.match(source, /truthy\(read\(data, "user\.name"\)\) \? \(<>/);
  assert.match(source, /!truthy\(read\(data, "posts"\)\)/);
  assert.match(source, /same\(read\(data, "status"\), "live"\)/);
  assert.match(source, /!same\(read\(data, "status"\), "live"\)/);
});

test("components become memoized React components", () => {
  const { source } = renderNative(parse(`component Card(post, tone)
  article.cool-card
    h3 "{{post.title}}"

div
  Card post="{{featured}}" tone="warm"`), { route: "home" });
  assertParses(source, "component screen");

  assert.match(source, /const Card = React\.memo\(function Card\(\{ data = \{\}, post, tone,/);
  assert.match(source, /<Card data=\{data\} post=\{read\(data, "featured"\)\} tone=\{"warm"\}/);
});

test("native screens import the theme relative to their own depth", () => {
  assert.match(renderNative(parse(SOURCE), { route: "home" }).source, /from "\.\/styles"/);
  assert.match(renderNative(parse(SOURCE), { route: "errors/404" }).source, /from "\.\.\/styles"/);
  assert.match(renderNative(parse(SOURCE), { route: "a/b/c" }).source, /from "\.\.\/\.\.\/styles"/);
});

test("only the helpers a screen uses are imported", () => {
  const plain = renderNative(parse(`div\n  p "Static text"`), { route: "home" }).source;
  assert.doesNotMatch(plain, /\bitems\b/);
  assert.doesNotMatch(plain, /\btruthy\b/);

  const dynamic = renderNative(parse(`div\n  list x in xs\n    p "{{x}}"`), { route: "home" }).source;
  assert.match(dynamic, /import \{[^}]*items[^}]*\} from/);
});

test("native rendering escapes template syntax found in view text", () => {
  const plain = renderNative(parse('p "Costs ${100} and `ticks`"'), { route: "home" }).source;
  assertParses(plain, "literal text screen");
  assert.match(plain, /\{"Costs \$\{100\} and `ticks`"\}/);

  const { source } = renderNative(parse('p "Costs ${100} for {{name}} and `ticks`"'), { route: "home" });
  assertParses(source, "interpolated text screen");
  assert.match(source, /\{`Costs \\\$\{100\} for \$\{value\(data, "name"\)\} and \\`ticks\\``\}/);
});

test("native rendering reports elements without a native equivalent", () => {
  const { notes } = renderNative(parse(`div\n  select name="size"\n    option "S"`), { route: "home" });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /<select> has no native primitive/);
});

// ---------------------------------------------------------------------------
// Generated modules
// ---------------------------------------------------------------------------

test("styles are flattened once at load rather than on every render", () => {
  const source = stylesModule(new Map([
    ["screen", ["screen"]],
    ["mainCoolContainer", ["main", "coolContainer"]]
  ]));
  assertParses(source, "styles module");

  assert.match(source, /screen: theme\.screen/, "a single style needs no composition");
  assert.match(source, /mainCoolContainer: flatten\(theme\.main, theme\.coolContainer\)/);
  assert.match(source, /const flatten = \(\.\.\.parts\) => StyleSheet\.flatten\(parts\)/);
});

test("the theme covers the classes in use and stays editable", () => {
  const source = themeModule(["screen", "coolBtn", "somethingCustom"]);
  assertParses(source, "theme module");
  assert.match(source, /coolBtn: \{"alignItems"/);
  assert.match(source, /somethingCustom: \{\}/);

  const evaluated = new Function(`${source.replaceAll("export ", "")}; return { theme, palette };`)();
  assert.equal(evaluated.theme.screen.backgroundColor, "#090B14");
  assert.equal(evaluated.palette.violet, "#7C5CFF");
});

test("the runtime helpers behave as the compiled screens expect", async () => {
  const project = await mkdtemp(join(tmpdir(), "noderyx-runtime-"));
  const previous = process.cwd();
  process.chdir(project);

  try {
    await mkdir(join(project, "views"), { recursive: true });
    await writeFile(join(project, "views/home.noderframe"), `div\n  p "hi"`);
    const { out } = await buildNative({}, {}, () => {});

    const source = (await readFile(join(out, "runtime.js"), "utf8"))
      .replace(/^import .*$/m, "const Linking = { openURL: () => Promise.resolve() };")
      .replaceAll("export ", "");
    const runtime = new Function(`${source}; return { read, value, str, truthy, same, items, keyFor };`)();

    assert.equal(runtime.read({ user: { name: "Ada" } }, "user.name"), "Ada");
    assert.equal(runtime.read({}, "deeply.missing.path"), undefined);
    assert.equal(runtime.value({}, "missing"), "");
    assert.equal(runtime.str(null), "");

    assert.equal(runtime.truthy([]), false, "an empty list is falsy so `if !posts` works");
    assert.equal(runtime.truthy([1]), true);
    assert.equal(runtime.truthy(0), false);
    assert.equal(runtime.same("live", "live"), true);
    assert.equal(runtime.same(5, "5"), true);

    assert.deepEqual(runtime.items(null), []);
    assert.deepEqual(runtime.items("text"), []);
    assert.equal(runtime.keyFor({ id: 7 }, 0), "7");
    assert.equal(runtime.keyFor({ _id: "abc" }, 0), "abc");
    assert.equal(runtime.keyFor("plain", 3), "3");
  } finally {
    process.chdir(previous);
    await rm(project, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function inTemporaryProject(t, build) {
  const project = await mkdtemp(join(tmpdir(), "noderyx-native-"));
  const previous = process.cwd();
  process.chdir(project);
  t.after(async () => {
    process.chdir(previous);
    await rm(project, { recursive: true, force: true });
  });

  await mkdir(join(project, "views/errors"), { recursive: true });
  await writeFile(join(project, "views/home.noderframe"), SOURCE);
  await writeFile(join(project, "views/errors/404.noderframe"), `html\n  body\n    h1 "Not found"\n`);
  return build(project);
}

test("buildNative writes screens plus the modules they depend on", async (t) => {
  const result = await inTemporaryProject(t, () => buildNative({}, {}, () => {}));

  assert.deepEqual(result.screens.map((screen) => screen.route).sort(), ["errors/404", "home"]);
  assert.equal(result.screens.find((screen) => screen.route === "errors/404").name, "Errors404");

  for (const file of ["App.jsx", "Navigator.jsx", "native.js", "runtime.js", "styles.js", "theme.js"]) {
    const source = await readFile(join(result.out, file), "utf8");
    assertParses(source, file);
  }

  const app = await readFile(join(result.out, "App.jsx"), "utf8");
  assert.match(app, /import Home from "\.\/home";/);
  assert.match(app, /import Errors404 from "\.\/errors\/404";/);
  assert.match(app, /<Navigator screens=\{screens\} entry=\{ENTRY\}/);
});

test("every style and helper a generated screen references exists", async (t) => {
  const result = await inTemporaryProject(t, () => buildNative({}, {}, () => {}));

  const styles = await readFile(join(result.out, "styles.js"), "utf8");
  const runtime = await readFile(join(result.out, "runtime.js"), "utf8");
  const defined = new Set([...styles.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]));
  const exported = new Set([...runtime.matchAll(/export function (\w+)/g)].map((match) => match[1]));

  for (const route of ["home", "errors/404"]) {
    const screen = await readFile(join(result.out, `${route}.jsx`), "utf8");
    for (const [, key] of screen.matchAll(/\bs\.(\w+)/g)) {
      assert.ok(defined.has(key), `${route} uses undefined style s.${key}`);
    }
    const imported = screen.match(/import \{ ([^}]+) \} from "[^"]*runtime"/);
    for (const name of imported[1].split(",").map((part) => part.trim())) {
      assert.ok(exported.has(name), `${route} imports missing helper ${name}`);
    }
  }
});

test("the navigator resolves web-style links to screens", async (t) => {
  const result = await inTemporaryProject(t, () => buildNative({}, {}, () => {}));
  const source = await readFile(join(result.out, "Navigator.jsx"), "utf8");

  const routeFor = new Function(`${source.slice(source.indexOf("export function routeFor")).replace("export ", "").split("\nexport default")[0]}; return routeFor;`)();
  const screens = { home: true, about: true };

  assert.equal(routeFor("/", screens, "home"), "home");
  assert.equal(routeFor("/about", screens, "home"), "about");
  assert.equal(routeFor("/about.html", screens, "home"), "about");
  assert.equal(routeFor("/about#team", screens, "home"), "about");
  assert.equal(routeFor("/missing", screens, "home"), null);
});

test("initNativeProject produces a runnable app and never overwrites the theme", async (t) => {
  const result = await inTemporaryProject(t, async () => {
    const first = await initNativeProject({}, { appId: "com.example.demo", appName: "Demo" }, () => {});
    await writeFile(join(first.root, "theme.js"), "// customised by the designer\nexport const theme = {};\n");
    await writeFile(join(first.root, "package.json"), '{"name":"customised"}');
    return initNativeProject({}, { appId: "com.example.demo", appName: "Demo" }, () => {});
  });

  const manifest = JSON.parse(await readFile(join(result.root, "app.json"), "utf8"));
  assert.equal(manifest.expo.name, "Demo");
  assert.equal(manifest.expo.android.package, "com.example.demo");
  assert.equal(manifest.expo.ios.bundleIdentifier, "com.example.demo");
  assert.equal(manifest.expo.splash.backgroundColor, "#090B14");

  assert.match(await readFile(join(result.root, "index.js"), "utf8"), /registerRootComponent/);
  assert.ok((await readFile(join(result.root, "assets/icon.png"))).length > 0);

  // Project files the developer may have edited are left alone.
  assert.equal(JSON.parse(await readFile(join(result.root, "package.json"), "utf8")).name, "customised");
  // Generated code is always refreshed.
  assert.doesNotMatch(await readFile(join(result.root, "theme.js"), "utf8"), /customised by the designer/);
});

test("buildNative refuses to emit an app without its entry screen", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "noderyx-native-"));
  const previous = process.cwd();
  process.chdir(project);
  t.after(async () => {
    process.chdir(previous);
    await rm(project, { recursive: true, force: true });
  });

  await mkdir(join(project, "views"), { recursive: true });
  await writeFile(join(project, "views/landing.noderframe"), `html\n  body\n    h1 "Hi"\n`);

  await assert.rejects(() => buildNative({}, {}, () => {}), /Entry view not found: home/);
});
