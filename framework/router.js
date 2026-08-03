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
    return [...new Set(this.routes.filter((route) => route.regex.test(pathname)).map((route) => route.method))];
  }

  match(method, pathname) {
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
