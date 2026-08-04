import { fileURLToPath } from "node:url";
import { ai, loadEnvironment, loadPackages, noderyx } from "./framework/index.js";
import { registerRoutes } from "./routes/index.js";

loadEnvironment();
const { default: config } = await import("./noderyx.config.js");

const app = noderyx({
  requireAppKey: true,
  name: config.app.name,
  environment: config.app.environment,
  debug: config.app.debug,
  cache: config.cache,
  security: {
    ...config.security,
    cors: config.security.cors.length
      ? { origins: config.security.cors, credentials: true }
      : null
  },
  views: fileURLToPath(new URL("./resources/views", import.meta.url)),
  public: fileURLToPath(new URL("./public", import.meta.url))
});

app.provide("ai", ai(config.ai));

registerRoutes(app);
await loadPackages(app, config.packages, { config });

// Phusion Passenger (cPanel) may hand the application a unix socket path in
// PORT instead of a number, so only treat a numeric value as a TCP port.
const requestedPort = String(process.env.PORT ?? 3000);
const socketPath = /^\d+$/.test(requestedPort) ? null : requestedPort;
const host = process.env.HOST ?? "0.0.0.0";
let activePort = Number(requestedPort);
let portAttempts = 0;
const server = socketPath ? app.listen(socketPath) : app.listen(activePort, host);

server.on("listening", () => {
  if (socketPath) {
    console.log(`Noderyx Framework listening on ${socketPath}`);
    return;
  }
  const address = server.address();
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`Noderyx Framework running at http://${displayHost}:${address.port}`);
});

server.on("error", (error) => {
  const retryable = !socketPath && (error.code === "EADDRINUSE" || error.code === "EACCES");
  if (process.env.NODE_ENV !== "production" && retryable && portAttempts < 10) {
    portAttempts += 1;
    activePort += 1;
    console.log(`Port unavailable; trying http://localhost:${activePort}`);
    server.listen(activePort, host);
    return;
  }
  console.error(`Noderyx server error: ${error.message}`);
  process.exitCode = 1;
});

function shutdown(signal) {
  console.log(`${signal} received; closing server`);
  server.close((error) => process.exit(error ? 1 : 0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
