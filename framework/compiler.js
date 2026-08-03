import { readFile, stat } from "node:fs/promises";
import { renderHtml } from "./renderers/html.js";

/**
 * The Noderyx compiler is split in two: `parse` turns `.noderframe` source into
 * a renderer-agnostic tree, and a renderer turns that tree into output.
 *
 * The tree carries elements, control flow, and components. Nothing in it knows
 * about HTML, which is what lets the same view compile to a web page and to
 * native Android and iOS widgets.
 */

function tokenize(value) {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

function parseAttributes(tokens) {
  const attributes = {};
  const text = [];

  for (const token of tokens) {
    const attribute = token.match(/^([\w:-]+)=(?:"([^"]*)"|(.+))$/);
    if (attribute) attributes[attribute[1]] = attribute[2] ?? attribute[3];
    else text.push(token.replace(/^"|"$/g, ""));
  }
  return { attributes, text: text.join(" ") };
}

/**
 * A condition: a dotted path, optionally negated, optionally compared to a
 * literal. Deliberately small — views decide what to show, not what to compute.
 *
 *   if user.isAdmin
 *   if !cart.isEmpty
 *   if status == "published"
 *   if count != 0
 */
function parseCondition(source, line) {
  const comparison = source.match(/^(!?)([\w.]+)\s*(==|!=)\s*(.+)$/);
  if (comparison) {
    const [, negated, path, operator, rawValue] = comparison;
    const literal = rawValue.trim().replace(/^"|"$/g, "");
    return {
      path,
      operator,
      value: /^-?\d+(\.\d+)?$/.test(literal) ? Number(literal)
        : literal === "true" ? true
          : literal === "false" ? false
            : literal,
      negated: negated === "!"
    };
  }

  const truthy = source.match(/^(!?)([\w.]+)$/);
  if (!truthy) throw new SyntaxError(`Line ${line}: could not read condition: ${source}`);
  return { path: truthy[2], operator: null, value: null, negated: truthy[1] === "!" };
}

/**
 * `for item in items` or `for item, index in items`.
 */
function parseIteration(source, line, type) {
  const match = source.match(/^([A-Za-z_]\w*)(?:\s*,\s*([A-Za-z_]\w*))?\s+in\s+([\w.]+)$/);
  if (!match) {
    throw new SyntaxError(`Line ${line}: expected "${type} item in items", found: ${type} ${source}`);
  }
  return { item: match[1], index: match[2] ?? null, source: match[3] };
}

function parseStatement(source, line) {
  const keyword = source.match(/^(if|else if|else|for|list|component)\b\s*(.*)$/);

  if (keyword) {
    const [, name, rest] = keyword;

    if (name === "if" || name === "else if") {
      return {
        type: name === "if" ? "if" : "elseif",
        test: parseCondition(rest.trim(), line),
        children: [],
        alternate: null,
        line
      };
    }
    if (name === "else") {
      if (rest.trim()) throw new SyntaxError(`Line ${line}: "else" takes no condition`);
      return { type: "else", children: [], line };
    }
    if (name === "for" || name === "list") {
      // `list` renders a virtualized list on native; `for` renders inline.
      return { type: name === "list" ? "list" : "each", ...parseIteration(rest.trim(), line, name), children: [], line };
    }
    if (name === "component") {
      const definition = rest.trim().match(/^([A-Z]\w*)\s*(?:\(([^)]*)\))?$/);
      if (!definition) {
        throw new SyntaxError(`Line ${line}: expected "component Name(prop, prop)", found: component ${rest}`);
      }
      return {
        type: "component",
        name: definition[1],
        params: (definition[2] ?? "").split(",").map((part) => part.trim()).filter(Boolean),
        children: [],
        line
      };
    }
  }

  const [descriptor = "", ...tokens] = tokenize(source);
  const match = descriptor.match(/^([A-Za-z][\w-]*)?((?:[.#][\w-]+)*)$/);
  if (!match) throw new SyntaxError(`Line ${line}: invalid element: ${descriptor}`);

  const name = match[1] || "div";
  const suffix = match[2] ?? "";
  const { attributes, text } = parseAttributes(tokens);

  // A capitalised name is a component the view defined or imported.
  if (/^[A-Z]/.test(name)) {
    return { type: "use", name, props: attributes, text, children: [], line };
  }

  return {
    type: "element",
    tag: name,
    id: suffix.match(/#([\w-]+)/)?.[1] ?? null,
    classes: [...suffix.matchAll(/\.([\w-]+)/g)].map((item) => item[1]),
    attributes,
    text,
    children: [],
    line
  };
}

/**
 * Attach `else if` / `else` to the `if` they follow, so renderers walk a single
 * chain instead of tracking sibling order.
 */
function append(siblings, node) {
  if (node.type === "elseif" || node.type === "else") {
    let previous = siblings[siblings.length - 1];
    if (!previous || (previous.type !== "if" && previous.type !== "elseif")) {
      throw new SyntaxError(`Line ${node.line}: "${node.type === "else" ? "else" : "else if"}" must follow an "if"`);
    }
    while (previous.alternate) previous = previous.alternate;
    previous.alternate = node;
    return;
  }
  siblings.push(node);
}

/**
 * Parse `.noderframe` source into a tree. Values keep their `{{placeholders}}`,
 * so a parsed template can be rendered many times, with different data, by
 * different renderers.
 */
export function parse(source) {
  const lines = source.replaceAll("\t", "  ").split(/\r?\n/);
  const roots = [];
  const open = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trimStart().startsWith("//")) continue;

    const spaces = raw.match(/^ */)[0].length;
    if (spaces % 2 !== 0) {
      throw new SyntaxError(`Line ${index + 1}: indentation must use two spaces`);
    }
    const depth = spaces / 2;
    if (depth > open.length) {
      throw new SyntaxError(`Line ${index + 1}: indentation jumped more than one level`);
    }

    open.length = depth;
    const node = parseStatement(raw.trim(), index + 1);
    append(depth === 0 ? roots : open[depth - 1].children, node);
    open.push(node);
  }

  return roots;
}

/** Collect `component` definitions, and return the tree with them removed. */
export function extractComponents(nodes, into = new Map()) {
  const remaining = [];
  for (const node of nodes) {
    if (node.type === "component") {
      into.set(node.name, node);
      extractComponents(node.children, into);
      continue;
    }
    if (node.children?.length) node.children = extractComponents(node.children, into);
    if (node.alternate) extractComponents([node.alternate], into);
    remaining.push(node);
  }
  return remaining;
}

export function compile(source, data = {}) {
  return renderHtml(parse(source), data);
}

// Parsing is the expensive part of rendering and does not depend on request
// data. Production templates are immutable for the process lifetime; in
// development an mtime check preserves instant edits without reparsing steady
// traffic. The cap protects tiny servers from unbounded memory use.
const fileCache = new Map();
const FILE_CACHE_LIMIT = 256;

export async function compileFile(file, data = {}) {
  const production = process.env.NODE_ENV === "production";
  let cached = fileCache.get(file);
  if (!cached || (!production && cached.mtimeMs !== (await stat(file)).mtimeMs)) {
    const info = production ? null : await stat(file);
    cached = { tree: parse(await readFile(file, "utf8")), mtimeMs: info?.mtimeMs };
    if (fileCache.size >= FILE_CACHE_LIMIT) fileCache.delete(fileCache.keys().next().value);
    fileCache.set(file, cached);
  }
  return renderHtml(cached.tree, data);
}

export function clearCompilerCache() {
  fileCache.clear();
}

export { interpolate, resolvePath } from "./interpolate.js";
export { renderHtml } from "./renderers/html.js";
export { renderNative, NATIVE_COMPONENTS } from "./renderers/native.js";
