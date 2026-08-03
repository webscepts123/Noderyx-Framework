/**
 * Component extraction, shared by every renderer.
 *
 * A `component` definition is a declaration, not output, so it is lifted out of
 * the tree before rendering. The result is cached per parsed tree, which keeps
 * "parse once, render many" true and leaves the tree itself untouched.
 */

const cache = new WeakMap();

function extract(nodes, registry) {
  const remaining = [];
  let changed = false;

  for (const node of nodes) {
    if (node.type === "component") {
      registry.set(node.name, {
        ...node,
        children: extract(node.children, registry)
      });
      changed = true;
      continue;
    }

    let replacement = node;
    if (node.children?.length) {
      const children = extract(node.children, registry);
      if (children !== node.children) replacement = { ...replacement, children };
    }
    if (node.alternate) {
      const [alternate] = extract([node.alternate], registry);
      if (alternate !== node.alternate) replacement = { ...replacement, alternate };
    }
    if (replacement !== node) changed = true;
    remaining.push(replacement);
  }

  return changed ? remaining : nodes;
}

/**
 * Split a parsed tree into the nodes that render and the components they may
 * use. Safe to call repeatedly with the same tree.
 */
export function componentsOf(nodes) {
  const cached = cache.get(nodes);
  if (cached) return cached;

  const registry = new Map();
  const roots = extract(nodes, registry);
  const result = { roots, registry };
  cache.set(nodes, result);
  return result;
}

/** Compare a value against a parsed condition. */
export function conditionHolds(test, value) {
  let result;
  if (test.operator === "==") result = String(value ?? "") === String(test.value);
  else if (test.operator === "!=") result = String(value ?? "") !== String(test.value);
  else if (Array.isArray(value)) result = value.length > 0;
  else result = Boolean(value);
  return test.negated ? !result : result;
}
