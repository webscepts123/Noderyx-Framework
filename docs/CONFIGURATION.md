# Configuring a Noderyx application

Noderyx separates secrets and deployment-specific values from JavaScript
configuration:

- `.env` contains values that change between computers and environments.
- `noderyx.config.js` converts those values into typed configuration.
- `.env.example` documents required variables without containing real secrets.

Never commit `.env`. Commit `.env.example` and `noderyx.config.js`.

## Initial setup

Create a local environment file:

```powershell
Copy-Item .env.example .env
```

On macOS or Linux:

```bash
cp .env.example .env
```

Generate the signing key used by sessions and CSRF protection:

```bash
npx noderyx spark:key
```

`npm start` and `npm run dev` load `.env` before importing
`noderyx.config.js`. Variables supplied by the operating system or hosting
platform take priority over values in `.env`.

## Environment file syntax

Use one `NAME=value` pair per line:

```dotenv
APP_NAME="My Application"
APP_DEBUG=true
PORT=3000
```

Quote values containing spaces. Empty values are allowed. Do not add JavaScript
expressions to `.env`; conversions happen in `noderyx.config.js`.

## Application configuration

```dotenv
NODE_ENV=development
APP_DEBUG=true
APP_KEY=
APP_NAME="My Application"
APP_URL=http://localhost:3000
APP_TIMEZONE=UTC
APP_LOCALE=en
LOG_LEVEL=debug
HOST=0.0.0.0
PORT=3000
```

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` |
| `APP_DEBUG` | Includes internal error details when true |
| `APP_KEY` | Signs sessions, cookies, and CSRF tokens |
| `APP_NAME` | Application display name |
| `APP_URL` | Canonical application URL |
| `APP_TIMEZONE` | Application timezone identifier |
| `APP_LOCALE` | Default locale |
| `LOG_LEVEL` | Intended logging threshold for the app and packages |
| `HOST` | Network interface used by the HTTP server |
| `PORT` | HTTP port |

See [Live development and custom ports](LIVE-DEVELOPMENT.md) for automatic port
selection, strict ports, availability checks, and browser refresh behavior.

`APP_DEBUG` must be false in production. Debug output can expose stack traces,
paths, queries, and other internal information.

## Site metadata

```dotenv
SITE_NAME="My Application"
SITE_URL=https://example.com
SITE_DESCRIPTION="A short public description."
```

These values are available to the starter controller, page metadata, PWA, and
mobile builds. `APP_NAME` describes the application itself; `SITE_NAME` allows
a public-facing site label to differ.

## AI configuration

AI is optional and disabled by default. Credentials stay in `.env` and requests
are made only by the server:

```dotenv
AI_ENABLED=true
AI_PROVIDER=openai
OPENAI_API_KEY=your_server_key
OPENAI_MODEL=gpt-5.6-sol
```

Set `AI_PROVIDER=anthropic` to use Claude instead. It reads its own credential
block, and thinking tokens count toward the output budget:

```dotenv
AI_ENABLED=true
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_server_key
ANTHROPIC_MODEL=claude-opus-5
AI_MAX_OUTPUT_TOKENS=4000
```

See [AI in Noderyx](AI.md) for all variables, route examples, model choices,
provider differences, conversation continuation, and the production safety
checklist.

## Database configuration

Choose one database driver:

```dotenv
DB_TYPE=mysql
```

### MySQL

```dotenv
DB_TYPE=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=app_user
DB_PASSWORD=use-a-secret-value
DB_NAME=app_database
DB_POOL_MAX=10
```

### PostgreSQL

```dotenv
DB_TYPE=postgres
DATABASE_URL=postgresql://app_user:password@127.0.0.1:5432/app_database
DB_POOL_MIN=0
DB_POOL_MAX=10
```

Percent-encode special characters in connection URLs. Prefer a secret manager
or hosting-platform environment variable for production credentials.

### MongoDB

```dotenv
DB_TYPE=mongo
MONGODB_URL=mongodb://127.0.0.1:27017
DB_NAME=app_database
```

Installations use only the driver selected by `DB_TYPE`. Test the connection
and migration state before deployment:

```bash
npm run migrate:status
npm run migrate
```

## Cache configuration

```dotenv
CACHE_DRIVER=memory
CACHE_PREFIX=myapp
CACHE_TTL=3600
CACHE_MAX_ITEMS=512
CACHE_STATIC_MAX_AGE=86400
CACHE_STALE_WHILE_REVALIDATE=604800
```

| Variable | Unit | Purpose |
| --- | --- | --- |
| `CACHE_DRIVER` | — | `memory` enables caching; `none` disables it |
| `CACHE_PREFIX` | — | Namespace available to cache packages |
| `CACHE_TTL` | seconds | Default lifetime available to cache packages |
| `CACHE_MAX_ITEMS` | items | Maximum in-memory static asset entries |
| `CACHE_STATIC_MAX_AGE` | seconds | Browser freshness for production assets |
| `CACHE_STALE_WHILE_REVALIDATE` | seconds | Browser stale-while-revalidate period |

Development detects changed views and assets. Production uses in-memory view
and static-asset caching. Set `CACHE_DRIVER=none` when debugging cache-related
behavior or when an external layer owns all caching.

## Email configuration

```dotenv
MAIL_DRIVER=log
MAIL_HOST=127.0.0.1
MAIL_PORT=1025
MAIL_SECURE=false
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_FROM_ADDRESS=hello@example.com
MAIL_FROM_NAME="My Application"
```

The core exposes a transport-neutral `config.mail` object for application and
package use. It does not pretend to deliver SMTP mail without a transport.
Install or create a Noderyx email package that consumes `config.mail`.

Recommended environments:

- Development: `MAIL_DRIVER=log` or a local mail catcher on port 1025.
- Production: an SMTP/API package, real credentials, and a verified sender.

Common secure SMTP settings use port 465 with `MAIL_SECURE=true`. STARTTLS
commonly uses port 587 with `MAIL_SECURE=false`; follow the mail provider's
instructions.

Never commit `MAIL_PASSWORD`.

## Security and session configuration

```dotenv
TRUST_PROXY=false
CORS_ORIGINS=https://app.example.com,capacitor://localhost
REQUEST_BODY_LIMIT=1048576
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=300
SESSION_COOKIE=noderyx_session
SESSION_MAX_AGE=604800
SESSION_SAME_SITE=Lax
SESSION_SECURE=false
```

- Enable `TRUST_PROXY` only behind a trusted reverse proxy or load balancer.
- `CORS_ORIGINS` is a comma-separated allowlist; leave it empty to disable
  cross-origin API access.
- `REQUEST_BODY_LIMIT` is measured in bytes.
- `RATE_LIMIT_WINDOW_MS` is measured in milliseconds.
- `SESSION_MAX_AGE` is measured in seconds.
- Use `SESSION_SECURE=true` when production is served over HTTPS.
- `SESSION_SAME_SITE=Lax` is the recommended default for ordinary web apps.

See [Security](SECURITY.md) for the complete security model.

## Mobile and native configuration

```dotenv
MOBILE_APP_ID=com.example.myapp
MOBILE_APP_NAME="My Application"
MOBILE_API_URL=https://api.example.com
```

`MOBILE_APP_ID` must use reverse-domain format. A packaged or native app has no
embedded Node.js server, so set `MOBILE_API_URL` to the deployed Noderyx API.

See [Mobile](MOBILE.md) and [Native](NATIVE.md) for platform setup.

## Typed environment helpers

`noderyx.config.js` uses helpers exported by the framework:

```js
import { envBoolean, envList, envNumber } from "noderyx-framework";

const debug = envBoolean("APP_DEBUG", false);
const port = envNumber("PORT", 3000);
const origins = envList("CORS_ORIGINS");
```

Invalid booleans and numbers fail during startup rather than silently using a
dangerous value. Accepted boolean values are `true`, `false`, `1`, `0`, `yes`,
`no`, `on`, and `off`.

## Reading configuration in packages

Package lifecycle hooks receive the complete configuration:

```js
export default definePackage({
  name: "mailer",
  register({ config }) {
    console.log(config.mail.driver);
  }
});
```

Do not read another package's secrets or log credentials.

## Production checklist

Use settings similar to:

```dotenv
NODE_ENV=production
APP_DEBUG=false
APP_URL=https://example.com
LOG_LEVEL=warn
SESSION_SECURE=true
TRUST_PROXY=true
CACHE_DRIVER=memory
```

Before deployment:

1. Generate a unique `APP_KEY`; never reuse the example value.
2. Keep database and mail credentials in the host's secret manager.
3. Use HTTPS and secure session cookies.
4. Set only trusted CORS origins.
5. Confirm proxy settings match the hosting topology.
6. Run tests, migrations, and builds.
7. Verify `APP_DEBUG=false` by checking an error response.

```bash
npm test
npm run migrate:status
npm run build
```

Changing environment variables requires an application restart. Rebuild mobile
or native output when variables used during compilation change.
