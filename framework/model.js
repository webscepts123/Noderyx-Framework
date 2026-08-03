function identifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe database identifier: ${value}`);
  }
  return value;
}

export class Model {
  static database = null;
  static table = null;
  static primaryKey = "id";
  static fillable = [];
  static observers = [];

  static observe(observer) {
    if (!Object.hasOwn(this, "observers")) this.observers = [...this.observers];
    this.observers.push(typeof observer === "function" ? new observer() : observer);
    return this;
  }

  static async notify(event, payload) {
    for (const observer of this.observers) {
      if (typeof observer[event] === "function") await observer[event](payload);
    }
  }

  static use(database) {
    this.database = database;
    return this;
  }

  static get db() {
    if (!this.database) {
      throw new Error(`${this.name} has no database. Call ${this.name}.use(db) first.`);
    }
    return this.database;
  }

  static get tableName() {
    return identifier(this.table ?? `${this.name.toLowerCase()}s`);
  }

  static clean(values) {
    const allowed = new Set(this.fillable);
    return Object.fromEntries(
      Object.entries(values).filter(([key]) => allowed.has(key))
    );
  }

  static async all() {
    if (this.db.kind === "mongo") {
      return this.db.collection(this.tableName).find({}).toArray();
    }
    return this.db.query(`SELECT * FROM ${this.tableName}`);
  }

  static async find(id) {
    const key = identifier(this.primaryKey);
    if (this.db.kind === "mongo") {
      return this.db.collection(this.tableName).findOne({ [key]: id });
    }
    const marker = this.db.kind === "postgres" ? "$1" : "?";
    const rows = await this.db.query(
      `SELECT * FROM ${this.tableName} WHERE ${key} = ${marker} LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  }

  static async create(values) {
    const data = this.clean(values);
    await this.notify("creating", data);
    const entries = Object.entries(data);
    if (!entries.length) throw new Error(`${this.name}.create received no fillable fields`);
    if (this.db.kind === "mongo") {
      const result = await this.db.collection(this.tableName).insertOne(data);
      const model = { ...data, _id: result.insertedId };
      await this.notify("created", model);
      return model;
    }

    const columns = entries.map(([key]) => identifier(key));
    const markers = entries.map((_, index) => this.db.kind === "postgres" ? `$${index + 1}` : "?");
    const returning = this.db.kind === "postgres" ? " RETURNING *" : "";
    const result = await this.db.query(
      `INSERT INTO ${this.tableName} (${columns.join(", ")}) VALUES (${markers.join(", ")})${returning}`,
      entries.map(([, value]) => value)
    );
    const model = this.db.kind === "postgres"
      ? result[0]
      : { ...data, [this.primaryKey]: result.insertId };
    await this.notify("created", model);
    return model;
  }

  static async update(id, values) {
    const data = this.clean(values);
    await this.notify("updating", { id, values: data });
    const entries = Object.entries(data);
    if (!entries.length) return this.find(id);
    const key = identifier(this.primaryKey);
    if (this.db.kind === "mongo") {
      await this.db.collection(this.tableName).updateOne({ [key]: id }, { $set: data });
      const model = await this.find(id);
      await this.notify("updated", model);
      return model;
    }

    const assignments = entries.map(([column], index) => {
      const marker = this.db.kind === "postgres" ? `$${index + 1}` : "?";
      return `${identifier(column)} = ${marker}`;
    });
    const idMarker = this.db.kind === "postgres" ? `$${entries.length + 1}` : "?";
    const returning = this.db.kind === "postgres" ? " RETURNING *" : "";
    const result = await this.db.query(
      `UPDATE ${this.tableName} SET ${assignments.join(", ")} WHERE ${key} = ${idMarker}${returning}`,
      [...entries.map(([, value]) => value), id]
    );
    const model = this.db.kind === "postgres" ? result[0] ?? null : await this.find(id);
    await this.notify("updated", model);
    return model;
  }

  static async delete(id) {
    await this.notify("deleting", id);
    const key = identifier(this.primaryKey);
    if (this.db.kind === "mongo") {
      const deleted = (await this.db.collection(this.tableName).deleteOne({ [key]: id })).deletedCount > 0;
      if (deleted) await this.notify("deleted", id);
      return deleted;
    }
    const marker = this.db.kind === "postgres" ? "$1" : "?";
    const returning = this.db.kind === "postgres" ? ` RETURNING ${key}` : "";
    const result = await this.db.query(
      `DELETE FROM ${this.tableName} WHERE ${key} = ${marker}${returning}`,
      [id]
    );
    const deleted = this.db.kind === "postgres" ? result.length > 0 : result.affectedRows > 0;
    if (deleted) await this.notify("deleted", id);
    return deleted;
  }
}
