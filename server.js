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
const port = Number(requestedPort);
let bindAttempts = 0;
let closing = false;
const server = socketPath ? app.listen(socketPath) : app.listen(port, host);

server.on("listening", () => {
  bindAttempts = 0;
  if (socketPath) {
    console.log(`Noderyx Framework listening on ${socketPath}`);
    return;
  }
  const address = server.address();
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`Noderyx Framework running at http://${displayHost}:${address.port}`);
});

server.on("error", (error) => {
  // A watch restart can fire before the previous process has released the
  // socket. Retry the *same* port for a few seconds rather than drifting to a
  // different one, which would strand the browser tab already open on this URL.
  if (!closing && !socketPath && error.code === "EADDRINUSE" && bindAttempts < 20) {
    bindAttempts += 1;
    setTimeout(() => server.listen(port, host), 250).unref();
    return;
  }
  console.error(`Noderyx server error: ${error.message}`);
  process.exit(1);
});

function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`${signal} received; closing server`);
  server.close(() => process.exit(0));
  // The live-reload stream is a long-lived connection that keeps server.close
  // from ever completing, so force idle and open sockets shut.
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
