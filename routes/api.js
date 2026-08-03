import { AIError } from "../framework/index.js";

/** Machine-readable endpoints used by web, mobile, and external clients. */
export function registerApiRoutes(app) {
  app.get("/api/status", ({ json }) => json({
    framework: "Noderyx Framework",
    version: "0.1.0",
    environment: process.env.NODE_ENV ?? "development",
    databases: ["MySQL", "PostgreSQL", "MongoDB"]
  }));

  app.get("/api/hello/:name", ({ params, json }) => json({ hello: params.name }));

  app.post("/api/ai/ideas", async ({ body, service, json }) => {
    try {
      const result = await service("ai").generate(body?.prompt, {
        previousResponseId: body?.previousResponseId || undefined,
        instructions: "You are the Noderyx idea partner. Help a developer turn a rough product idea into one clear, original first feature. Respond with a short concept, the first user moment, and three practical build steps. Do not pretend the framework has capabilities it does not have."
      });
      return json({ answer: result.text, responseId: result.id, model: result.model });
    } catch (error) {
      if (error instanceof AIError) return json({ error: error.message, code: error.code }, error.status);
      throw error;
    }
  });
}
