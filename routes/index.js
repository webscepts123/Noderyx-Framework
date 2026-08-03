import { registerWebRoutes } from "./web.js";
import { registerApiRoutes } from "./api.js";
import { registerSystemRoutes } from "./system.js";

/**
 * The application's route map. Keep user journeys first, APIs second, and
 * framework/infrastructure endpoints last so the structure stays predictable.
 */
export function registerRoutes(app) {
  registerWebRoutes(app);
  registerApiRoutes(app);
  registerSystemRoutes(app);
  return app;
}
