# Routes

This is the single home for application URLs.

- `web.js` â€” pages people navigate to on web and mobile.
- `api.js` â€” JSON endpoints for apps and integrations.
- `system.js` â€” health, robots, sitemap, and operational endpoints.
- `index.js` â€” the ordered route map imported by `server.js`.

## Add a page

Create `resources/views/about.noderframe`, add a controller action, then register:

```js
app.get("/about", AboutController.handle("index"));
```

Link to it with `a href="/about" "About"`. Never include `.html` or
`.noderframe` in a URL.
