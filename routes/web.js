import { HomeController } from "../app/Controllers/HomeController.js";

/**
 * Routes people visit in a browser or mobile app.
 * A URL never includes the view extension: home.noderframe is simply `/`.
 */
export function registerWebRoutes(app) {
  app.get("/", HomeController.handle("index"));
}
