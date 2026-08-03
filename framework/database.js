function assertConfig(config, fields) {
  for (const field of fields) {
    if (!config[field]) throw new Error(`Missing database configuration: ${field}`);
  }
}

export async function mysql(config) {
  assertConfig(config, ["host", "user", "database"]);
  const { createPool } = await import("mysql2/promise");
  const pool = createPool(config);
  return {
    kind: "mysql",
    query: async (sql, values = []) => {
      const [rows] = await pool.execute(sql, values);
      return rows;
    },
    transaction: async (work) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    close: () => pool.end()
  };
}

export async function postgres(config) {
  assertConfig(config, ["connectionString"]);
  const { Pool } = await import("pg");
  const pool = new Pool(config);
  return {
    kind: "postgres",
    query: async (sql, values = []) => (await pool.query(sql, values)).rows,
    transaction: async (work) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };
}

export async function mongo(config) {
  assertConfig(config, ["url", "database"]);
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(config.url, config.options);
  await client.connect();
  const database = client.db(config.database);
  return {
    kind: "mongo",
    collection: (name) => database.collection(name),
    close: () => client.close()
  };
}

export async function connect(config) {
  if (config.type === "mysql") return mysql(config);
  if (config.type === "postgres" || config.type === "postgresql") return postgres(config);
  if (config.type === "mongo" || config.type === "mongodb") return mongo(config);
  throw new Error(`Unsupported database type: ${config.type}`);
}
