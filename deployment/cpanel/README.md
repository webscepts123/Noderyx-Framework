# Deploy Noderyx Framework on cPanel

Your cPanel account must provide **Setup Node.js App** (CloudLinux Node.js
Selector or an equivalent feature). If that option is absent, ask the hosting
provider to enable Node.js applications; ordinary PHP-only hosting cannot run
the backend.

## Upload and start

1. Create a ZIP of this project, excluding `.git`, `.env`, and `node_modules`.
2. In cPanel File Manager, create an application folder such as `cool-app`,
   upload the ZIP there, and extract it.
3. Open **Setup Node.js App** and select **Create Application**.
4. Select production mode and Node.js 20 or newer.
5. Set the application root to `cool-app`.
6. Select the domain or subdomain URL.
7. Set the startup file to `server.js`.
8. Add `NODE_ENV=production` and `SITE_NAME=Your Site` under environment
   variables. Do not add `PORT`; cPanel supplies it.
9. Click **Run NPM Install**, then **Restart**.
10. Visit `/health`. A successful deployment returns JSON containing
    `"status":"ok"`.

## Database settings

For cPanel MySQL, create the database and user in **MySQL Databases**, grant the
user privileges, and add `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` to
the Node.js application's environment variables.

PostgreSQL is usable only when the hosting plan offers it. Remote MongoDB
(including MongoDB Atlas) requires outbound network access from the host.

Never upload a real `.env` file into a public web directory. Use cPanel's
environment-variable fields.

## Updating

Upload the changed files, run **NPM Install** only if `package.json` changed,
and click **Restart Application**. The public URL should point to the Node.js
application through cPanel; do not expose the internal application port.
