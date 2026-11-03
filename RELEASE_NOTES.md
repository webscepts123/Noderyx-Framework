# Release 0.9.0

- Require Node.js 26 or newer; align Docker images, publishing, and generated desktop workflows with Node.js 26.
- Refresh stale CSRF cookies when sessions expire and add hidden CSRF fields to local POST forms in Noderyx views.
- Give form fields white backgrounds and readable text, and keep checkboxes compact on mobile.
- Add a trading security profile with production HTTPS enforcement, bounded sessions, and stricter request limits.
- Preserve security profile session and rate-limit settings in application configuration.
- Reject expired API credentials and malformed sessions; preserve active rate limits when storage reaches capacity.

## Migration

Node.js 26 or newer is required. Existing projects can select SECURITY_PROFILE=trading and remove old environment overrides to adopt its defaults. Configure HTTPS and secure production cookies. See docs/SECURITY.md for migration details and remaining application-level responsibilities.

## Validation

167 tests passed. Framework QA: zero errors; one warning because the checkout has no local .env file.
