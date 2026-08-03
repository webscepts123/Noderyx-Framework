export class Controller {
  static handle(action) {
    return async (context) => {
      const controller = new this(context);
      if (typeof controller[action] !== "function") {
        throw new Error(`${this.name}.${action} is not a controller action`);
      }
      return controller[action]();
    };
  }

  constructor(context) {
    this.context = context;
  }

  get request() { return this.context.request; }
  get params() { return this.context.params; }
  get query() { return this.context.query; }
  get body() { return this.context.body; }
  service(name) { return this.context.service(name); }

  json(data, status = 200) {
    return this.context.json(data, status);
  }

  text(value, status = 200, contentType) {
    return this.context.text(value, status, contentType);
  }

  render(view, data = {}, status = 200) {
    return this.context.render(view, data, status);
  }

  abort(status, message) {
    return this.context.abort(status, message);
  }
}
