import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildCpanel,
  cpanelOptions,
  deployPhp,
  doctorPhp,
  installerPhp,
  passengerHtaccess,
  phpBridge,
  proxyHtaccess,
  startScript,
  staticHtaccess
} from "../framework/cpanel.js";

async function workspace() {
  return mkdtemp(join(tmpdir(), "noderyx-cpanel-"));
}

test("cPanel options reject unknown modes and invalid ports", () => {
  assert.throws(() => cpanelOptions({ mode: "docker" }), /Unknown cPanel mode/);
  assert.throws(() => cpanelOptions({ port: 0 }), /Invalid port/);
  assert.throws(() => cpanelOptions({ port: 70000 }), /Invalid port/);
});

test("cPanel options build the application root from the account name", () => {
  assert.equal(cpanelOptions({ user: "webscept" }).appRoot, "/home/webscept/public_html");
  assert.equal(cpanelOptions({ user: "webscept", directory: "/public_html/shop/" }).appRoot,
    "/home/webscept/public_html/shop");
  assert.equal(cpanelOptions({}).appRoot, "/home/CPANEL_USERNAME/public_html");
  assert.equal(cpanelOptions({ appRoot: "/home/a/apps/site" }).appRoot, "/home/a/apps/site");
});

test("Passenger .htaccess starts the app from public_html with no Setup Node.js App step", () => {
  const htaccess = passengerHtaccess({ user: "webscept", nodeBinary: "/opt/alt/alt-nodejs20/root/usr/bin/node" });
  assert.match(htaccess, /PassengerAppRoot "\/home\/webscept\/public_html"/);
  assert.match(htaccess, /PassengerAppType node/);
  assert.match(htaccess, /PassengerStartupFile app\.js/);
  assert.match(htaccess, /PassengerNodejs "\/opt\/alt\/alt-nodejs20\/root\/usr\/bin\/node"/);
  assert.match(htaccess, /PassengerAppEnv production/);
  // A root-level application must not declare a sub-URI.
  assert.doesNotMatch(htaccess, /PassengerBaseURI/);
});

test("Passenger .htaccess comments out the Node path when it is unknown", () => {
  const htaccess = passengerHtaccess({ user: "webscept" });
  assert.doesNotMatch(htaccess, /^\s*PassengerNodejs/m);
  assert.match(htaccess, /# {3}\/opt\/alt\/alt-nodejs20\/root\/usr\/bin\/node/);
  assert.match(htaccess, /noderyx-check\.php/);
});

test("Generated .htaccess keeps application source unreadable inside public_html", () => {
  for (const htaccess of [passengerHtaccess({ user: "a" }), proxyHtaccess({ user: "a" })]) {
    assert.match(htaccess, /RewriteRule \^\(app\|database\|framework\|node_modules\|packages\|resources\|routes\|tests\|tmp\)/);
    assert.match(htaccess, /RewriteRule \(\^\|\/\)\\\.\(env\|git\|npmrc\|htpasswd\) - \[F,L\]/);
    // Only paths that exist on disk are refused, so /app/dashboard still routes.
    assert.match(htaccess, /RewriteCond %\{REQUEST_FILENAME\} -f \[OR\]\n\s*RewriteCond %\{REQUEST_FILENAME\} -d/);
    // Both Apache 2.2 and 2.4 syntaxes are present so neither version 500s.
    assert.match(htaccess, /Require all denied/);
    assert.match(htaccess, /Deny from all/);
  }
});

test("Proxy .htaccess serves real files and forwards the rest to the bridge", () => {
  const htaccess = proxyHtaccess({ port: 4200 });
  assert.match(htaccess, /RewriteCond %\{REQUEST_FILENAME\} -f\n\s*RewriteCond %\{REQUEST_URI\} !\^\/\(index\|noderyx-\(check\|install\|deploy\)\)/);
  assert.match(htaccess, /RewriteRule \^ index\.php \[QSA,L\]/);
  assert.match(htaccess, /127\.0\.0\.1:4200/);
});

test("Static .htaccess resolves extensionless URLs without a Node process", () => {
  const htaccess = staticHtaccess({ mode: "static" });
  assert.match(htaccess, /DirectoryIndex index\.html home\.html/);
  assert.match(htaccess, /RewriteCond %\{REQUEST_FILENAME\}\.html -f/);
  assert.doesNotMatch(htaccess, /Passenger/);
});

test("PHP bridge forwards the request and drops hop-by-hop headers", () => {
  const bridge = phpBridge({ port: 5100, host: "127.0.0.1" });
  assert.match(bridge, /const NODERYX_UPSTREAM = 'http:\/\/127\.0\.0\.1:5100'/);
  assert.match(bridge, /X-Forwarded-For/);
  assert.match(bridge, /X-Forwarded-Proto/);
  assert.match(bridge, /CURLOPT_CUSTOMREQUEST/);
  // Set-Cookie must append rather than replace, so several cookies survive.
  assert.match(bridge, /header\(\$header, \$name !== 'set-cookie'\)/);
  for (const header of ["'connection'", "'content-length'", "'transfer-encoding'"]) {
    assert.ok(bridge.includes(header), `bridge should skip ${header}`);
  }
});

test("Start script is a no-op while the process is alive and searches known Node paths", () => {
  const script = startScript({ port: 5100, directory: "public_html/shop" });
  assert.match(script, /\$HOME\/public_html\/shop\/noderyx-start\.sh/);
  assert.match(script, /kill -0 "\$\(cat "\$PID_FILE" 2>\/dev\/null\)" 2>\/dev\/null; then\n  exit 0/);
  assert.match(script, /\/opt\/alt\/alt-nodejs20\/root\/usr\/bin\/node/);
  assert.match(script, /PORT="\$\{PORT:-5100\}"/);
  assert.doesNotMatch(script, /\r/);
});

test("Diagnostics page stays hidden without the generated key", () => {
  const php = doctorPhp({ token: "abc123", port: 5100 });
  assert.match(php, /const NODERYX_KEY = 'abc123'/);
  assert.match(php, /hash_equals\(NODERYX_KEY/);
  assert.match(php, /http_response_code\(404\)/);
  assert.match(php, /DELETE THIS FILE/);
  // The page reports only; it must never write to the account.
  assert.doesNotMatch(php, /file_put_contents|unlink|fopen\(/);
});

test("Installer forges APP_KEY in the format the framework accepts", () => {
  const php = installerPhp({ token: "tok123" });
  // generateKey() is randomBytes(32).toString("base64url"); appKey() rejects < 32 chars.
  assert.match(php, /random_bytes\(32\)/);
  assert.match(php, /rtrim\(strtr\(base64_encode\(random_bytes\(32\)\), '\+\/', '-_'\), '='\)/);
});

test("Installer writes .env and .htaccess with the account's real absolute path", () => {
  const php = installerPhp({ token: "tok123", user: "acct" });
  assert.match(php, /str_replace\(\s*\['__APP_ROOT__', '__NODE_BINARY__'\],\s*\[__DIR__, \$node\]/);
  assert.match(php, /file_put_contents\(__DIR__ \. '\/\.env'/);
  assert.match(php, /chmod\(__DIR__ \. '\/\.env', 0600\)/);
  assert.match(php, /file_put_contents\(__DIR__ \. '\/\.htaccess'/);
  // Proxy mode must trust the bridge, or every client looks like localhost.
  assert.match(php, /'TRUST_PROXY' => \$mode === 'proxy' \? 'true' : 'false'/);
});

test("Installer refuses without the key and can remove itself", () => {
  const php = installerPhp({ token: "tok123" });
  assert.match(php, /hash_equals\(NODERYX_KEY, \(string\) \(\$_REQUEST\['key'\] \?\? ''\)\)/);
  assert.match(php, /http_response_code\(404\)/);
  assert.match(php, /unlink\(__DIR__ \. '\/' \. \$file\)/);
});

test("Installer keeps the .env.example documentation while overriding values", () => {
  const php = installerPhp({ token: "tok123" });
  assert.match(php, /preg_match\('\/\^\(\[A-Z0-9_\]\+\)=\/', \$line, \$match\)/);
  assert.match(php, /Added by the Noderyx installer/);
});

test("Deploy panel verifies the GitHub webhook signature before doing anything", () => {
  const php = deployPhp({ token: "tok123", webhookSecret: "s3cret", repository: "owner/repo" });
  assert.match(php, /'sha256=' \. hash_hmac\('sha256', \$payload, NODERYX_WEBHOOK_SECRET\)/);
  assert.match(php, /hash_equals\(\$expected, \$signature\)/);
  assert.match(php, /http_response_code\(401\)/);
  // Only the configured repository and branch may trigger a deploy.
  assert.match(php, /\$repository !== noderyx_repository\(\)/);
  assert.match(php, /'refs\/heads\/' \. \$branch/);
});

test("Deploy panel preserves server-owned files and validates the repository name", () => {
  const php = deployPhp({ token: "tok123" });
  for (const kept of ["'.env'", "'.htaccess'", "'tmp'", "'node_modules'"]) {
    assert.ok(php.includes(kept), `deploy should preserve ${kept}`);
  }
  assert.match(php, /\^\[\\w\.-\]\+\/\[\\w\.-\]\+\$/);
  assert.match(php, /codeload\.github\.com/);
  assert.match(php, /NODERYX_MAX_ARCHIVE/);
});

test("Proxy .htaccess lets the browser tools run as PHP instead of bridging them", () => {
  const htaccess = proxyHtaccess({ port: 3000 });
  assert.match(htaccess, /!\^\/\(index\|noderyx-\(check\|install\|deploy\)\)/);
});

test("Bundling node_modules makes the upload complete with no terminal", async (t) => {
  const out = await workspace();
  t.after(() => rm(out, { recursive: true, force: true }));

  const result = await buildCpanel({ out, user: "acct", withModules: true });

  assert.ok(existsSync(join(out, "node_modules")), "npm is absent on these accounts");
  assert.ok(existsSync(join(out, "node_modules", ".htaccess")), "dependencies stay unreadable");
  assert.ok(result.files.includes("node_modules/"));
  assert.ok(!result.notes.some((note) => note.includes("not bundled")));
});

test("Bundles ship the browser installer and deploy panel", async (t) => {
  const out = await workspace();
  t.after(() => rm(out, { recursive: true, force: true }));

  const result = await buildCpanel({ out, user: "acct", repository: "owner/repo" });

  assert.ok(existsSync(join(out, "noderyx-install.php")));
  assert.ok(existsSync(join(out, "noderyx-deploy.php")));
  const deploy = await readFile(join(out, "noderyx-deploy.php"), "utf8");
  assert.match(deploy, /const NODERYX_REPOSITORY = 'owner\/repo'/);
  assert.match(deploy, new RegExp(`const NODERYX_WEBHOOK_SECRET = '${result.webhookSecret}'`));
  assert.ok(result.notes.some((note) => note.includes("noderyx-install.php")));

  // The README must not tell users to run npm scripts that a generated
  // project does not define; npm is not even on the PATH on these accounts.
  const readme = await readFile(join(out, "README-CPANEL.md"), "utf8");
  assert.doesNotMatch(readme, /npm run noderyx -- spark:key/);
  assert.match(readme, /noderyx-install\.php\?key=/);
});

test("Passenger bundle carries the app, a startup shim, and per-directory guards", async (t) => {
  const out = await workspace();
  t.after(() => rm(out, { recursive: true, force: true }));

  const result = await buildCpanel({ out, user: "webscept", nodeBinary: "/usr/bin/node" });

  assert.equal(result.mode, "passenger");
  assert.equal(result.appRoot, "/home/webscept/public_html");
  assert.ok(existsSync(join(out, "server.js")));
  assert.ok(existsSync(join(out, "framework", "app.js")));
  assert.ok(existsSync(join(out, "public", "cool.css")));
  assert.ok(!existsSync(join(out, "node_modules")), "vendored packages are uploaded separately");
  assert.ok(!existsSync(join(out, ".git")));

  const shim = await readFile(join(out, "app.js"), "utf8");
  assert.match(shim, /import "\.\/server\.js"/);

  for (const directory of ["framework", "app", "routes", "resources", "database", "tmp"]) {
    const guard = await readFile(join(out, directory, ".htaccess"), "utf8");
    assert.match(guard, /Require all denied/);
  }
  assert.ok(existsSync(join(out, "tmp", "restart.txt")), "Passenger restarts on tmp/restart.txt");
  assert.ok(!existsSync(join(out, "public", ".htaccess")), "public assets stay reachable");

  const readme = await readFile(join(out, "README-CPANEL.md"), "utf8");
  assert.match(readme, /Setup Node\.js App/);
  assert.match(readme, new RegExp(result.token));
});

test("Proxy bundle adds the bridge, the cron scripts, and matching notes", async (t) => {
  const out = await workspace();
  t.after(() => rm(out, { recursive: true, force: true }));

  const result = await buildCpanel({ out, mode: "proxy", user: "webscept", port: 4321 });

  assert.ok(existsSync(join(out, "index.php")));
  assert.ok(existsSync(join(out, "noderyx-start.sh")));
  assert.ok(existsSync(join(out, "noderyx-stop.sh")));
  assert.ok(existsSync(join(out, "server.js")));
  assert.match(await readFile(join(out, "index.php"), "utf8"), /127\.0\.0\.1:4321/);
  assert.ok(result.notes.some((note) => note.includes("TRUST_PROXY")));
  assert.ok(result.notes.some((note) => note.includes("127.0.0.1:4321")));
});

test("Static bundle compiles views and keeps the /public asset prefix", async (t) => {
  const out = await workspace();
  t.after(() => rm(out, { recursive: true, force: true }));

  const result = await buildCpanel({ out, mode: "static" });

  const page = await readFile(join(out, "home.html"), "utf8");
  assert.match(page, /^<!doctype html>/i);
  assert.match(page, /href="\/public\/cool\.css"/);
  assert.ok(existsSync(join(out, "public", "cool.css")), "views reference /public/<file>");
  assert.ok(!existsSync(join(out, "server.js")), "a static upload has no backend");
  assert.ok(!existsSync(join(out, "framework")));
  assert.ok(result.notes.some((note) => note.includes("no backend")));
});

test("Rebuilding replaces the previous bundle instead of merging into it", async (t) => {
  const out = await workspace();
  t.after(() => rm(out, { recursive: true, force: true }));

  await buildCpanel({ out, mode: "proxy", user: "webscept" });
  await buildCpanel({ out, mode: "static" });

  assert.ok(!existsSync(join(out, "index.php")));
  assert.ok(!existsSync(join(out, "noderyx-start.sh")));
  assert.ok(existsSync(join(out, ".htaccess")));
});
