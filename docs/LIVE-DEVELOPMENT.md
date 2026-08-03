# Live development and custom ports

Noderyx can watch application files, restart Node.js, and refresh an open
browser after the server becomes available again.

## Start live development

```bash
npm run live
```

The default address is:

```text
http://localhost:3000
```

`npm run dev` remains supported and also enables watching.

## Choose a custom port

Pass the port after `--` when using an npm script:

```bash
npm run live -- 8080
```

The direct CLI forms are:

```bash
npx noderyx live 8080
npx noderyx live --port=8080
```

Noderyx prints the selected URL before starting the application.

## Select a free port automatically

```bash
npm run live -- auto
```

Automatic selection starts at port 3000 and checks subsequent ports until it
finds one that can be used.

When a numeric port is already occupied, live mode also selects the next free
port by default and reports the change:

```text
Live development: http://localhost:3001
Requested port was unavailable; selected 3001.
Watching: enabled
```

## Require an exact port

Use `--strict-port` when another port must not be selected:

```bash
npm run live -- 8080 --strict-port
```

The command stops with an error if port 8080 is unavailable. This is useful for
OAuth callbacks, external webhooks, CORS allowlists, and mobile API URLs that
expect an exact address.

## Check a port

Check without starting the application:

```bash
npx noderyx port:check 3000
npx noderyx port:check --port=8080
```

Example output:

```text
Port 3000 on 0.0.0.0 is available.
```

The command returns a failing exit code when the port is occupied, so it can be
used in scripts and deployment checks.

## Configure the default with `.env`

```dotenv
HOST=0.0.0.0
PORT=8080
```

Then run:

```bash
npm run live
```

Command-line options override `.env` values.

## Choose a host

Listen only on the current computer:

```bash
npx noderyx live 3000 --host=127.0.0.1
```

Listen on all network interfaces:

```bash
npx noderyx live 3000 --host=0.0.0.0
```

`0.0.0.0` allows other devices on the local network to connect when the
firewall permits it. Noderyx displays `localhost` for the local browser URL.
Do not expose a debug server directly to the public internet.

## How live refresh works

In development, Noderyx automatically adds its small reload client to rendered
HTML pages. The client opens a same-origin event connection. When file watching
restarts Node.js, the browser waits for `/health` and reloads after the server
is ready.

New projects include `public/untitled-live.js`. It is excluded from packaged
mobile builds and is not injected when `NODE_ENV=production`.

The watcher monitors:

- `.env` and `noderyx.config.js`
- `server.js`
- `app/`
- `routes` through the server module dependency graph
- `resources/`
- `packages/`
- `database/` and migrations
- `public/`
- local framework files when developing the framework itself

## Common examples

```bash
# Normal live development
npm run live

# Custom port
npm run live -- 5000

# Automatically find a free port
npm run live -- auto

# Exact port on localhost only
npm run live -- 5000 --host=127.0.0.1 --strict-port

# Check before another tool starts
npx noderyx port:check 5000
```

## Troubleshooting

If the browser does not reload:

1. Confirm `Watching: enabled` appears in the terminal.
2. Check that `public/untitled-live.js` exists.
3. Verify `/health` returns a successful response.
4. Check the browser console for blocked event connections.
5. Disable a proxy cache for local development.

If another process owns the port, choose a different port, use `auto`, or stop
that process. Noderyx does not terminate other applications to reclaim ports.
