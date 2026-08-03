import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

async function files(directory) {
  if (!existsSync(directory)) return [];
  return (await readdir(directory))
    .filter((name) => /^\d+_.+\.js$/.test(name))
    .sort();
}

async function ensureStore(db) {
  if (db.kind === "mongo") {
    await db.collection("_untitled_migrations").createIndex({ name: 1 }, { unique: true });
    return;
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS untitled_migrations (
      name VARCHAR(255) PRIMARY KEY,
      batch INTEGER NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function appliedRows(db) {
  await ensureStore(db);
  if (db.kind === "mongo") {
    return db.collection("_untitled_migrations").find({}).sort({ batch: 1, name: 1 }).toArray();
  }
  return db.query("SELECT name, batch FROM untitled_migrations ORDER BY batch, name");
}

async function loadMigration(directory, name) {
  const migration = await import(`${pathToFileURL(join(directory, name)).href}?t=${Date.now()}`);
  if (typeof migration.up !== "function" || typeof migration.down !== "function") {
    throw new Error(`${name} must export async up(db) and down(db) functions`);
  }
  return migration;
}

async function record(db, name, batch) {
  if (db.kind === "mongo") {
    await db.collection("_untitled_migrations").insertOne({ name, batch, appliedAt: new Date() });
  } else if (db.kind === "postgres") {
    await db.query("INSERT INTO untitled_migrations (name, batch) VALUES ($1, $2)", [name, batch]);
  } else {
    await db.query("INSERT INTO untitled_migrations (name, batch) VALUES (?, ?)", [name, batch]);
  }
}

async function forget(db, name) {
  if (db.kind === "mongo") {
    await db.collection("_untitled_migrations").deleteOne({ name });
  } else if (db.kind === "postgres") {
    await db.query("DELETE FROM untitled_migrations WHERE name = $1", [name]);
  } else {
    await db.query("DELETE FROM untitled_migrations WHERE name = ?", [name]);
  }
}

export async function migrationStatus(db, directory) {
  const available = await files(directory);
  const applied = new Set((await appliedRows(db)).map((item) => item.name));
  return available.map((name) => ({ name, applied: applied.has(name) }));
}

export async function migrate(db, directory) {
  const available = await files(directory);
  const rows = await appliedRows(db);
  const completed = new Set(rows.map((item) => item.name));
  const batch = Math.max(0, ...rows.map((item) => Number(item.batch))) + 1;
  const applied = [];

  for (const name of available) {
    if (completed.has(name)) continue;
    const migration = await loadMigration(directory, name);
    await migration.up(db);
    await record(db, name, batch);
    applied.push(name);
  }
  return applied;
}

export async function rollback(db, directory, steps = 1) {
  const rows = await appliedRows(db);
  const batches = [...new Set(rows.map((item) => Number(item.batch)))]
    .sort((a, b) => b - a)
    .slice(0, Math.max(1, steps));
  const selected = rows
    .filter((item) => batches.includes(Number(item.batch)))
    .reverse();
  const reverted = [];

  for (const item of selected) {
    const migration = await loadMigration(directory, item.name);
    await migration.down(db);
    await forget(db, item.name);
    reverted.push(item.name);
  }
  return reverted;
}
