# Updating and upgrading Noderyx

Noderyx applications can update the framework without replacing application
code. The updater changes only the `noderyx-framework` dependency in
`package.json` and `package-lock.json`.

It does not modify:

- `app/` controllers, models, middleware, observers, or commands
- `resources/views/`
- `routes/`
- `database/`
- `public/`
- `.env` or `noderyx.config.js`

## Update to the latest stable release

Run this command from the application directory:

```bash
npm run framework:update
```

The equivalent direct command is:

```bash
npx noderyx update
```

## Upgrade to a specific version

Provide a version after `update`:

```bash
npx noderyx update 0.2.1
```

An npm release tag can also be used:

```bash
npx noderyx update next
```

Use an exact version in production when you need repeatable deployments.

## Preview an update

Use `--dry-run` to see what would happen without changing dependencies:

```bash
npx noderyx update --dry-run
npx noderyx update 0.2.1 --dry-run
```

## Safety checks

The updater follows this sequence:

1. Read the current framework dependency.
2. Run the existing project test script, when one is defined.
3. Back up `package.json` and `package-lock.json`.
4. Install the requested framework release.
5. Verify that `noderyx-framework` imports successfully.
6. Run the project tests against the updated framework.
7. Keep the update only when verification succeeds.

If installation, import verification, or the post-update tests fail, Noderyx
restores the previous manifest and lockfile and reinstalls the previous
dependency state.

Backups are stored in:

```text
.noderyx/update-backups/<date-and-time>/
```

They are ignored by Git in newly generated projects.

## Projects without tests

If the project has no `test` script, the framework import check still runs. It
is strongly recommended to add tests for important routes and application
behavior before performing a major-version upgrade.

Tests can be skipped explicitly when required:

```bash
npx noderyx update --no-test
```

Skipping tests removes an important compatibility check. The framework import
check and automatic dependency rollback remain enabled.

## Updating a locally linked framework

Projects created with `noderyx new --local` use a `file:` dependency. Running
the normal update command refreshes that local dependency while retaining its
configured path:

```bash
npm run framework:update
```

Use this after fixing the framework locally so the application receives the
new framework files and runs its compatibility checks.

## Recommended release workflow

Before updating a production application:

1. Commit or back up the application.
2. Run `npx noderyx update --dry-run`.
3. Update in a development branch or staging environment.
4. Run the application's complete test suite.
5. Start the application and check its critical routes.
6. Build mobile and native targets if the application ships them.
7. Deploy only after verification succeeds.

Useful verification commands include:

```bash
npm test
npm run build
npm run build:mobile
npm run build:native
```

## Recovering manually

Automatic rollback normally restores the previous dependency. If a process is
interrupted during an update, copy `package.json` and `package-lock.json` from
the newest `.noderyx/update-backups/` directory back to the project root, then
run:

```bash
npm install --ignore-scripts
```

Application source files do not need to be restored because the updater never
changes them.

## Major-version upgrades

Major releases may intentionally change framework APIs. Read the release notes
and migration instructions before selecting a new major version. The updater
protects dependency state and detects failing tests, but it cannot prove that
untested application behavior is compatible.

Prefer upgrading one major version at a time and add tests for important user
flows before starting the upgrade.
