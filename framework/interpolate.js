export function resolvePath(data, path) {
  return path.split(".").reduce((value, key) => value?.[key], data);
}

/**
 * Replace `{{placeholders}}` in a template value. `escape` is supplied by the
 * renderer, because HTML and native output need different escaping rules.
 */
export function interpolate(text, data, escape = String) {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const value = resolvePath(data, path);
    return value == null ? "" : escape(value);
  });
}
