import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function envBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`${name} must be true or false`);
}

export function envNumber(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number`);
  return number;
}

export function envList(name, fallback = []) {
  const value = process.env[name];
  return value == null || value.trim() === ""
    ? fallback
    : value.split(",").map((item) => item.trim()).filter(Boolean);
}

/** Load a local .env file once, without overwriting existing host variables. */
export function loadEnvironment(file = ".env") {
  const target = resolve(file);
  if (!existsSync(target)) return false;
  if (typeof process.loadEnvFile !== "function") {
    throw new Error("Loading .env requires Node.js 20.12 or newer");
  }
  process.loadEnvFile(target);
  return true;
}
