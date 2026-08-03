import { interpolate, resolvePath } from "../interpolate.js";
import { componentsOf, conditionHolds } from "../components.js";

const TAGS = new Set([
  "html", "head", "body", "title", "meta", "link", "main", "section", "article",
  "header", "footer", "nav", "div", "span", "h1", "h2", "h3", "p", "a",
  "button", "form", "label", "input", "textarea", "select", "option", "ul",
  "ol", "li", "img", "script", "code", "strong"
]);

const VOID_TAGS = new Set(["meta", "link", "input", "img"]);

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderElement(node, context, data, depth, output) {
  if (!TAGS.has(node.tag)) {
    throw new SyntaxError(`Unsupported HTML tag: ${node.tag}`);
  }

  const attributes = {};
  for (const [name, value] of Object.entries(node.attributes)) {
    attributes[name] = interpolate(value, data, escapeHtml);
  }
  if (node.id) attributes.id = node.id;
  if (node.classes.length) attributes.class = node.classes.join(" ");

  const rendered = Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join("");

  const indent = "  ".repeat(depth);
  const open = `<${node.tag}${rendered}>`;
  const content = interpolate(node.text, data, escapeHtml);
  const close = VOID_TAGS.has(node.tag) ? "" : `</${node.tag}>`;

  if (!node.children.length) {
    output.push(`${indent}${open}${content}${close}`);
    return;
  }
  if (!close) {
    throw new SyntaxError(`Line ${node.line}: <${node.tag}> cannot contain child elements`);
  }

  output.push(`${indent}${open}${content}`);
  renderAll(node.children, context, data, depth + 1, output);
  output.push(`${indent}${close}`);
}

function renderBranch(node, context, data, depth, output) {
  if (node.type === "else" || conditionHolds(node.test, resolvePath(data, node.test.path))) {
    renderAll(node.children, context, data, depth, output);
    return;
  }
  if (node.alternate) renderBranch(node.alternate, context, data, depth, output);
}

function renderLoop(node, context, data, depth, output) {
  const items = resolvePath(data, node.source);
  if (!Array.isArray(items)) return;

  for (const [position, item] of items.entries()) {
    const scope = { ...data, [node.item]: item };
    if (node.index) scope[node.index] = position;
    renderAll(node.children, context, scope, depth, output);
  }
}

function renderUse(node, context, data, depth, output) {
  const definition = context.components.get(node.name);
  if (!definition) {
    throw new SyntaxError(`Line ${node.line}: unknown component: ${node.name}`);
  }
  if (context.stack.includes(node.name)) {
    throw new SyntaxError(`Line ${node.line}: component ${node.name} renders itself`);
  }

  // Props are resolved in the caller's scope. A prop that is exactly one
  // placeholder passes the value itself, so objects and arrays survive.
  const scope = {};
  for (const parameter of definition.params) scope[parameter] = undefined;
  for (const [name, value] of Object.entries(node.props)) {
    const whole = value.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    scope[name] = whole ? resolvePath(data, whole[1]) : interpolate(value, data);
  }
  if (node.text) scope.children = interpolate(node.text, data);

  const nested = { ...context, stack: [...context.stack, node.name] };
  renderAll(definition.children, nested, { ...data, ...scope }, depth, output);
}

function renderAll(nodes, context, data, depth, output) {
  for (const node of nodes) {
    if (node.type === "if") renderBranch(node, context, data, depth, output);
    else if (node.type === "each" || node.type === "list") renderLoop(node, context, data, depth, output);
    else if (node.type === "use") renderUse(node, context, data, depth, output);
    else if (node.type === "component") continue;
    else renderElement(node, context, data, depth, output);
  }
}

/**
 * Render a parsed Noderyx tree as HTML.
 */
export function renderHtml(nodes, data = {}, { doctype = true } = {}) {
  const { roots, registry } = componentsOf(nodes);
  const output = doctype ? ["<!doctype html>"] : [];
  renderAll(roots, { components: registry, stack: [] }, data, 0, output);
  return output.join("\n");
}

export { TAGS as HTML_TAGS, VOID_TAGS };
