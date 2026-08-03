import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function definePackage(provider) {
  if (!provider || typeof provider !== "object") throw new TypeError("A Noderyx package must be an object");
  if (!provider.name || typeof provider.name !== "string") throw new TypeError("A Noderyx package requires a name");
  if (provider.register && typeof provider.register !== "function") {
    throw new TypeError(`Package ${provider.name} register must be a function`);
  }
  if (provider.boot && typeof provider.boot !== "function") {
    throw new TypeError(`Package ${provider.name} boot must be a function`);
  }
  return provider;
}

async function localPackages(directory) {
  const root = resolve(directory);
  if (!existsSync(root)) return [];
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageFile = join(root, entry.name, "package.json");
    if (!existsSync(packageFile)) continue;
    const manifest = JSON.parse((await readFile(packageFile, "utf8")).replace(/^\uFEFF/, ""));
    found.push({
      package: join(root, entry.name, manifest.main ?? "src/index.js"),
      options: {}
    });
  }
  return found;
}

function declaration(value) {
  if (typeof value === "string") return { package: value, options: {} };
  if (value?.name && !value.package && !value.provider) return { provider: value, options: {} };
  if (value && typeof value === "object" && (value.package || value.provider)) {
    return { ...value, options: value.options ?? {} };
  }
  throw new TypeError("Package entries must be package names, paths, or provider objects");
}

async function importProvider(specifier, root) {
  const target = isAbsolute(specifier)
    ? pathToFileURL(specifier).href
    : specifier.startsWith(".")
      ? pathToFileURL(resolve(root, specifier)).href
      : specifier;
  const module = await import(target);
  return module.default ?? module.noderyxPackage ?? module;
}

/** Register package routes and middleware, then run package boot hooks. */
export async function loadPackages(app, configured = [], options = {}) {
  if (!app || typeof app.get !== "function") throw new TypeError("loadPackages requires a Noderyx application");
  const root = resolve(options.root ?? process.cwd());
  const discovered = options.discover === false
    ? []
    : await localPackages(resolve(root, options.directory ?? "packages"));
  const requested = [...discovered, ...(configured ?? []).map(declaration)]
    .filter((item) => item.enabled !== false);
  const loaded = [];
  const names = new Set();

  for (const item of requested) {
    const provider = definePackage(item.provider ?? await importProvider(item.package, root));
    if (names.has(provider.name)) throw new Error(`Noderyx package loaded twice: ${provider.name}`);
    names.add(provider.name);
    const context = {
      app,
      name: provider.name,
      options: item.options ?? {},
      config: options.config ?? {},
      root
    };
    await provider.register?.(context);
    loaded.push({ provider, context });
  }

  for (const item of loaded) await item.provider.boot?.(item.context);
  return loaded.map(({ provider }) => provider);
}
