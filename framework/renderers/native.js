import { componentsOf } from "../components.js";

/**
 * Native renderer: turns a parsed Noderyx tree into React Native components.
 *
 * Screens draw real Android and iOS widgets. There is no WebView and no HTML.
 * Everything is resolved at build time — element mapping, styles, and the scope
 * of every `{{placeholder}}` — so nothing is parsed or looked up while the app
 * is running.
 */

const CONTAINERS = new Set([
  "html", "body", "main", "section", "article", "header", "footer", "nav",
  "div", "form", "ul", "ol", "select"
]);

const TEXTS = new Set(["h1", "h2", "h3", "p", "span", "strong", "code", "title", "option"]);

// Rendered as text when they hold only words, and as a container otherwise.
const FLEXIBLE = new Set(["li", "label"]);

const SKIPPED = new Set(["head", "meta", "link", "script"]);

export const NATIVE_COMPONENTS = {
  container: "View",
  text: "Text",
  pressable: "Pressable",
  image: "Image",
  input: "TextInput",
  scroll: "ScrollView",
  list: "FlatList"
};

const KEYBOARD_TYPES = {
  email: "email-address",
  number: "numeric",
  tel: "phone-pad",
  url: "url",
  search: "default"
};

function camel(value) {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part, index) => (index === 0
      ? part[0].toLowerCase() + part.slice(1)
      : part[0].toUpperCase() + part.slice(1)))
    .join("");
}

function pascal(value) {
  const name = value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  return /^[A-Za-z]/.test(name) ? name : `Screen${name}`;
}

function quote(value) {
  return JSON.stringify(String(value));
}

/**
 * Compile a dotted path to JavaScript. Names bound by a loop or a component
 * become direct property access; everything else reads from the screen data.
 */
function pathExpression(path, scope, { raw = false } = {}) {
  const [head, ...rest] = path.split(".");
  if (scope.has(head)) {
    const access = rest.length ? `${head}?.${rest.join("?.")}` : head;
    return raw ? access : `str(${access})`;
  }
  return raw ? `read(data, ${quote(path)})` : `value(data, ${quote(path)})`;
}

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * A JS expression for a template string. Literal text stays literal, and
 * placeholders become the value they refer to in the current scope.
 */
function expression(text, scope) {
  if (!text) return null;
  PLACEHOLDER.lastIndex = 0;
  if (!PLACEHOLDER.test(text)) return quote(text);

  PLACEHOLDER.lastIndex = 0;
  const parts = text
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("${", "\\${")
    .replace(PLACEHOLDER, (_, path) => `\${${pathExpression(path, scope)}}`);
  return `\`${parts}\``;
}

/** A whole-value prop such as `post="{{featured}}"` passes the object itself. */
function propExpression(value, scope) {
  const whole = value.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
  if (whole) return pathExpression(whole[1], scope, { raw: true });
  return expression(value, scope) ?? quote("");
}

function conditionExpression(test, scope) {
  const target = pathExpression(test.path, scope, { raw: true });
  const check = test.operator === "==" || test.operator === "!="
    ? `same(${target}, ${quote(test.value)})`
    : `truthy(${target})`;

  const negatedByOperator = test.operator === "!=";
  return test.negated !== negatedByOperator ? `!${check}` : check;
}

function componentFor(node) {
  if (SKIPPED.has(node.tag)) return null;
  if (node.tag === "img") return NATIVE_COMPONENTS.image;
  if (node.tag === "input" || node.tag === "textarea") return NATIVE_COMPONENTS.input;
  if (node.tag === "a" || node.tag === "button") return NATIVE_COMPONENTS.pressable;
  if (TEXTS.has(node.tag)) return NATIVE_COMPONENTS.text;
  if (CONTAINERS.has(node.tag)) return NATIVE_COMPONENTS.container;
  if (FLEXIBLE.has(node.tag)) {
    return node.children.length ? NATIVE_COMPONENTS.container : NATIVE_COMPONENTS.text;
  }
  return null;
}

/**
 * Register the style this element needs. Combinations are composed once when
 * the module loads, never on a render, so a re-render allocates nothing.
 */
function styleReference(node, styles) {
  const parts = [node.tag, ...node.classes]
    .map((name) => camel(name))
    .filter((name) => name && name !== "html" && name !== "body");
  if (!parts.length) return null;

  const key = parts.length === 1 ? parts[0] : camel(parts.join("-"));
  if (!styles.has(key)) styles.set(key, parts);
  return `s.${key}`;
}

function propsFor(node, component, scope, notes) {
  const props = [];
  const attributes = node.attributes;

  if (node.id) props.push(`testID=${quote(node.id)}`);
  if (attributes["aria-label"]) props.push(`accessibilityLabel={${expression(attributes["aria-label"], scope)}}`);
  if (attributes.alt) props.push(`accessibilityLabel={${expression(attributes.alt, scope)}}`);
  if (attributes["aria-current"]) props.push("accessibilityState={{ selected: true }}");

  if (component === NATIVE_COMPONENTS.image) {
    props.push(`source={{ uri: ${attributes.src ? expression(attributes.src, scope) : quote("")} }}`);
    props.push('resizeMode="cover"');
  }

  if (component === NATIVE_COMPONENTS.input) {
    const type = attributes.type ?? "text";
    if (attributes.placeholder) props.push(`placeholder={${expression(attributes.placeholder, scope)}}`);
    if (attributes.value) props.push(`defaultValue={${expression(attributes.value, scope)}}`);
    if (attributes.name) {
      props.push(`accessibilityLabel={${quote(attributes.name)}}`);
      props.push(`onChangeText={(text) => onChange?.(${quote(attributes.name)}, text)}`);
    }
    if (type === "password") props.push("secureTextEntry");
    if (KEYBOARD_TYPES[type]) props.push(`keyboardType=${quote(KEYBOARD_TYPES[type])}`);
    if (type === "email") props.push('autoCapitalize="none"');
    if (node.tag === "textarea") props.push("multiline");
    if ("disabled" in attributes) props.push("editable={false}");
    props.push("placeholderTextColor={theme.placeholder.color}");
  }

  if (component === NATIVE_COMPONENTS.pressable) {
    if (node.tag === "a" && attributes.href) {
      props.push(`onPress={() => navigate(${expression(attributes.href, scope)})}`);
      props.push('accessibilityRole="link"');
    } else {
      const name = attributes.name ?? node.id ?? node.tag;
      if (attributes.onclick) {
        notes.push(`Line ${node.line}: onclick="${attributes.onclick}" became actions[${quote(name)}]`);
      }
      props.push(`onPress={actions[${quote(name)}] ?? onPress}`);
      props.push('accessibilityRole="button"');
    }
    if ("disabled" in attributes) props.push("disabled");
    props.push("android_ripple={ripple}");
  }

  if (node.tag === "select") {
    notes.push(`Line ${node.line}: <select> has no native primitive; the options render as a list.`);
  }

  return props;
}

function renderChildren(nodes, context, scope, depth, lines) {
  for (const node of nodes) renderNode(node, context, scope, depth, lines);
}

function renderBranch(node, context, scope, depth, lines) {
  const indent = "  ".repeat(depth);
  const body = [];
  renderChildren(node.children, context, scope, depth + 1, body);

  lines.push(`${indent}{${conditionExpression(node.test, scope)} ? (<>`);
  lines.push(...body);
  if (!node.alternate) {
    lines.push(`${indent}</>) : null}`);
    return;
  }

  let alternate = node.alternate;
  while (alternate) {
    const alternateBody = [];
    renderChildren(alternate.children, context, scope, depth + 1, alternateBody);

    if (alternate.type === "else") {
      lines.push(`${indent}</>) : (<>`);
      lines.push(...alternateBody);
      lines.push(`${indent}</>)}`);
      return;
    }
    lines.push(`${indent}</>) : ${conditionExpression(alternate.test, scope)} ? (<>`);
    lines.push(...alternateBody);
    alternate = alternate.alternate;
  }
  lines.push(`${indent}</>) : null}`);
}

function renderLoop(node, context, scope, depth, lines) {
  const indent = "  ".repeat(depth);
  const inner = new Set([...scope, node.item, ...(node.index ? [node.index] : [])]);
  const source = pathExpression(node.source, scope, { raw: true });
  const body = [];
  renderChildren(node.children, context, inner, depth + 2, body);

  if (node.type === "list") {
    // Virtualized: only the rows on screen are mounted, whatever the data size.
    context.used.add(NATIVE_COMPONENTS.list);
    const index = node.index ?? "index";
    lines.push(`${indent}<FlatList`);
    lines.push(`${indent}  data={items(${source})}`);
    lines.push(`${indent}  keyExtractor={keyFor}`);
    lines.push(`${indent}  removeClippedSubviews`);
    lines.push(`${indent}  initialNumToRender={8}`);
    lines.push(`${indent}  windowSize={7}`);
    lines.push(`${indent}  renderItem={({ item: ${node.item}, index: ${index} }) => (<>`);
    lines.push(...body);
    lines.push(`${indent}  </>)}`);
    lines.push(`${indent}/>`);
    return;
  }

  const index = node.index ?? "_index";
  lines.push(`${indent}{items(${source}).map((${node.item}, ${index}) => (`);
  lines.push(`${indent}  <React.Fragment key={keyFor(${node.item}, ${index})}>`);
  lines.push(...body);
  lines.push(`${indent}  </React.Fragment>`);
  lines.push(`${indent}))}`);
}

function renderUse(node, context, scope, depth, lines) {
  const definition = context.components.get(node.name);
  if (!definition) throw new SyntaxError(`Line ${node.line}: unknown component: ${node.name}`);

  context.rendered.add(node.name);
  const indent = "  ".repeat(depth);
  const props = Object.entries(node.props)
    .map(([name, value]) => `${camel(name)}={${propExpression(value, scope)}}`);

  lines.push(`${indent}<${node.name} ${["data={data}", ...props, "navigate={navigate}", "actions={actions}", "onPress={onPress}"].join(" ")} />`);
}

function renderNode(node, context, scope, depth, lines) {
  if (node.type === "if") return renderBranch(node, context, scope, depth, lines);
  if (node.type === "each" || node.type === "list") return renderLoop(node, context, scope, depth, lines);
  if (node.type === "use") return renderUse(node, context, scope, depth, lines);
  if (node.type === "component") return undefined;

  const { styles, notes } = context;
  const indent = "  ".repeat(depth);

  if (SKIPPED.has(node.tag)) {
    if (node.tag === "head") {
      const title = node.children.find((child) => child.tag === "title");
      if (title) context.title = title.text;
    }
    return undefined;
  }

  const component = componentFor(node);
  if (!component) {
    notes.push(`Line ${node.line}: <${node.tag}> has no native equivalent and was skipped.`);
    return undefined;
  }
  context.used.add(component);

  const style = styleReference(node, styles);
  const props = propsFor(node, component, scope, notes);
  const attributes = [...(style ? [`style={${style}}`] : []), ...props].join(" ");
  const open = `<${component}${attributes ? ` ${attributes}` : ""}`;
  const content = expression(node.text, scope);
  const isText = component === NATIVE_COMPONENTS.text;

  // React Native only draws strings inside <Text>.
  const labelStyle = component === NATIVE_COMPONENTS.pressable
    ? (node.tag === "a" ? "linkText" : "buttonText")
    : "text";
  const label = (value) => {
    styles.set(labelStyle, [labelStyle]);
    context.used.add(NATIVE_COMPONENTS.text);
    return `<Text style={s.${labelStyle}}>{${value}}</Text>`;
  };

  if (component === NATIVE_COMPONENTS.image || component === NATIVE_COMPONENTS.input) {
    lines.push(`${indent}${open} />`);
    return undefined;
  }

  if (!node.children.length) {
    if (!content) {
      lines.push(`${indent}${open} />`);
      return undefined;
    }
    lines.push(`${indent}${open}>${isText ? `{${content}}` : label(content)}</${component}>`);
    return undefined;
  }

  lines.push(`${indent}${open}>`);
  if (content) lines.push(`${indent}  ${isText ? `{${content}}` : label(content)}`);
  renderChildren(node.children, context, scope, depth + 1, lines);
  lines.push(`${indent}</${component}>`);
  return undefined;
}

function componentSource(definition, context) {
  const scope = new Set(definition.params);
  const lines = [];
  renderChildren(definition.children, context, scope, 3, lines);

  const parameters = ["data = {}", ...definition.params.map(camel), "navigate", "actions = {}", "onPress", "onChange"];
  return `const ${definition.name} = React.memo(function ${definition.name}({ ${parameters.join(", ")} }) {
  return (
    <>
${lines.join("\n")}
    </>
  );
});
`;
}

/**
 * Render a parsed Noderyx tree as a React Native screen.
 */
export function renderNative(nodes, { route = "screen", scroll = true, stylesPath, runtimePath } = {}) {
  const { roots, registry } = componentsOf(nodes);
  const depth = route.split("/").length - 1;
  const up = depth ? "../".repeat(depth) : "./";

  const context = {
    styles: new Map([["screen", ["screen"]], ["text", ["text"]]]),
    components: registry,
    rendered: new Set(),
    used: new Set(["View", "Text"]),
    notes: [],
    title: null
  };

  // `html` and `body` are page scaffolding; render what is inside them.
  const body = roots.flatMap((node) => (node.type === "element" && node.tag === "html" ? node.children : [node]));
  const lines = [];
  renderChildren(body, context, new Set(), 3, lines);

  // A virtualized list scrolls itself. Nesting one inside a ScrollView renders
  // every row at once, which is exactly what `list` exists to avoid.
  const virtualized = lines.some((line) => line.includes("<FlatList"));
  const wrapper = scroll && !virtualized
    ? NATIVE_COMPONENTS.scroll
    : NATIVE_COMPONENTS.container;
  context.used.add(wrapper);

  const definitions = [...context.rendered]
    .map((name) => componentSource(registry.get(name), context))
    .join("\n");

  const name = pascal(route);
  const imports = [...context.used].sort();
  const emitted = [...lines, definitions].join("\n");
  const helpers = ["value", "read", "str", "items", "keyFor", "truthy", "same", "link"]
    .filter((helper) => helper === "link" || new RegExp(`\\b${helper}\\(`).test(emitted));
  const styleImports = ["s", ...(emitted.includes("theme.") ? ["theme"] : []),
    ...(emitted.includes("ripple") ? ["ripple"] : [])];
  const wrapperProps = wrapper === NATIVE_COMPONENTS.scroll
    ? " style={s.screen} contentInsetAdjustmentBehavior=\"automatic\" keyboardShouldPersistTaps=\"handled\""
    : " style={s.screen}";

  const source = `// Generated by Noderyx from ${route}.noderframe — do not edit by hand.
// Rebuild with: noderyx build:native
import React from "react";
import { ${imports.join(", ")} } from "react-native";
import { ${styleImports.join(", ")} } from "${stylesPath ?? `${up}styles`}";
import { ${helpers.join(", ")} } from "${runtimePath ?? `${up}runtime`}";

export const title = (data = {}) => ${expression(context.title, new Set()) ?? JSON.stringify(name)};

${definitions}function ${name}({ data = {}, actions = {}, onPress, onChange, navigate = link }) {
  return (
    <${wrapper}${wrapperProps}>
${lines.join("\n")}
    </${wrapper}>
  );
}

export default React.memo(${name});
`;

  return { name, source, styles: context.styles, notes: context.notes, title: context.title };
}
