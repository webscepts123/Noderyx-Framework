import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function runSeeders(database, directory, selectedName) {
  if (!existsSync(directory)) return [];
  const available = (await readdir(directory))
    .filter((name) => name.endsWith(".js"))
    .sort();
  const files = selectedName
    ? available.filter((name) => name === selectedName || name === `${selectedName}.js`)
    : available;

  if (selectedName && !files.length) {
    throw new Error(`Seeder not found: ${selectedName}`);
  }

  const completed = [];
  for (const name of files) {
    const module = await import(`${pathToFileURL(join(directory, name)).href}?t=${Date.now()}`);
    if (typeof module.run !== "function") {
      throw new Error(`${name} must export an async run(db) function`);
    }
    await module.run(database);
    completed.push(name);
  }
  return completed;
}
