const DATABASE_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND",
  "PROTOCOL_CONNECTION_LOST", "ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR",
  "28P01", "3D000", "57P01"
]);

export class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message, options);
    this.name = "HttpError";
    this.status = status;
    this.expose = options.expose ?? status < 500;
  }
}

export function errorStatus(error) {
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) {
    return error.status;
  }
  const databaseError = DATABASE_CODES.has(error?.code)
    || /database|mysql|postgres|mongo|connection pool/i.test(error?.name ?? "")
    || /database|ECONNREFUSED|connection (?:failed|lost|closed)/i.test(error?.message ?? "");
  return databaseError ? 502 : 500;
}

export const ERROR_COPY = {
  400: { title: "Bad request", message: "The request could not be understood." },
  401: { title: "Sign in required", message: "You need to sign in to continue." },
  403: { title: "Access denied", message: "You do not have permission to view this page." },
  404: { title: "Page not found", message: "The page you requested could not be found." },
  413: { title: "Request too large", message: "The data you sent exceeds the size this server accepts." },
  419: { title: "Page expired", message: "The form expired. Refresh the page and try again." },
  422: { title: "Check your details", message: "Some of the information provided is not valid." },
  429: { title: "Too many requests", message: "Please slow down and try again in a moment." },
  500: { title: "Something went wrong", message: "The application encountered an unexpected error." },
  502: { title: "Service unavailable", message: "Noderyx could not complete a connection to a required service." }
};
