# Controllers, models, migrations, and seeders

## Generate backend classes

```powershell
npm.cmd run noderyx -- make:controller UserController
npm.cmd run noderyx -- make:model User --table=users
npm.cmd run noderyx -- make:migration create_users
npm.cmd run noderyx -- make:seeder UserSeeder
```

Generated application code is placed in:

```text
app/
  Controllers/
  Models/
database/
  seeders/
migrations/
```

## Controllers

Controllers receive the route context:

```js
import { UserController } from "./app/Controllers/UserController.js";

app.get("/users", UserController.handle("index"));
app.get("/users/:id", UserController.handle("show"));
app.post("/users", UserController.handle("store"));
```

Controller methods can access `this.params`, `this.query`, and `this.body`, then
return `this.json()`, `this.text()`, or `this.render()`.

## Models

Models support MySQL, PostgreSQL, and MongoDB:

```js
import { connect } from "./framework/index.js";
import config from "./untitled.config.js";
import { User } from "./app/Models/User.js";

const db = await connect(config.database);
User.use(db);

const users = await User.all();
const user = await User.find(1);
const created = await User.create({ name: "Ada", email: "ada@example.com" });
await User.update(created.id, { name: "Ada Lovelace" });
await User.delete(created.id);
```

Only fields listed in a model's `fillable` array can be written. This protects
against accidental mass assignment.

## Migrations and seeders

Set database credentials in `.env`, then run:

```powershell
npm.cmd run noderyx -- migrate
npm.cmd run noderyx -- migrate:status
npm.cmd run noderyx -- db:seed
npm.cmd run noderyx -- db:seed --class=UserSeeder
npm.cmd run noderyx -- migrate:rollback
```

Seeders export `async function run(db)`. They receive the same database adapter
used by models and migrations. Seed only development/test databases unless
production seed data is intentional and repeat-safe.
