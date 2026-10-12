export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, handler) {
    const keys = [];
    const pattern = path
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/:([\w]+)/g, (_, key) => {
        keys.push(key);
        return "([^/]+)";
      });
    this.routes.push({
      method: method.toUpperCase(),
      regex: new RegExp(`^${pattern}/?$`),
      keys,
      handler
    });
    return this;
  }

  get(path, handler) { return this.add("GET", path, handler); }
  post(path, handler) { return this.add("POST", path, handler); }
  put(path, handler) { return this.add("PUT", path, handler); }
  delete(path, handler) { return this.add("DELETE", path, handler); }
  patch(path, handler) { return this.add("PATCH", path, handler); }

  allowedMethods(pathname) {
    const methods = new Set(this.routes.filter((route) => route.regex.test(pathname)).map((route) => route.method));
    if (methods.has("GET")) methods.add("HEAD");
    return [...methods];
  }

  match(method, pathname) {
    const found = this.find(method, pathname);
    // HEAD is GET without a body (RFC 9110). Uptime monitors and domain
    // validators probe with it, so every GET route answers it; send() and
    // Node itself drop the body.
    if (!found && method === "HEAD") return this.find("GET", pathname);
    return found;
  }

  find(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.regex);
      if (match) {
        return {
          handler: route.handler,
          params: Object.fromEntries(route.keys.map((key, index) => [
            key,
            decodeURIComponent(match[index + 1])
          ]))
        };
      }
    }
    return null;
  }
}
