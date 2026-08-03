# Lightweight QA checks

Noderyx includes a dependency-free source check for developers, testers, and
CI. It does not start a browser, database, emulator, or application server.

```powershell
npm run qa
node framework/cli.js qa --strict
node framework/cli.js qa --json
```

The report checks required project files, template syntax, responsive viewport
metadata, page titles, image alternative text, accessible control names,
internal links, separate native screen discovery, and elements unsupported by
the native renderer. Every finding includes its file, line, and suggested fix.

Normal mode exits unsuccessfully for errors. `--strict` also treats warnings as
a failing result. `--json` produces stable machine-readable output suitable for
CI annotations and QA dashboards.
