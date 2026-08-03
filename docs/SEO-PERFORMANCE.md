# SEO, mobile, and performance

## Lightspeed production mode

Always run the public server with `NODE_ENV=production`. Noderyx then caches
view discovery, parsed `.noderframe` trees, static file reads, hashes, and both
Gzip/Brotli asset variants. Cache sizes are bounded for low-memory servers.
Dynamic HTML uses low-CPU Gzip, while static CSS and JavaScript use cached
Brotli when the browser supports it.

The framework targets Google's current Core Web Vitals priorities: quick main
content rendering, responsive interactions, and stable layout. Application
authors still need to provide image `width` and `height`, avoid oversized hero
media, keep above-the-fold content small, and test the production HTTPS URL in
PageSpeed Insights because real-user results depend on each page's content and
hosting.

Noderyx Framework compiles `.noderframe` templates into server-side HTML, which allows search engines to
read page content without waiting for client-side JavaScript.

## Required production variables

Set these on cPanel or AWS:

```env
SITE_NAME=Your Brand
SITE_URL=https://www.example.com
SITE_DESCRIPTION=A concise description of the website.
NODE_ENV=production
```

`SITE_URL` must be the final HTTPS origin without a trailing slash. It is used
for canonical URLs, `robots.txt`, and `sitemap.xml`.

## Page checklist

- Give every page one descriptive `h1` and a unique `title`.
- Give every indexable page a unique meta description.
- Use semantic tags such as `main`, `nav`, `article`, and `footer`.
- Give meaningful images an `alt` attribute plus explicit `width` and `height`.
- Use `loading="lazy"` on below-the-fold images, but not the main hero image.
- Keep link text descriptive and ensure controls work with a keyboard.
- Add every public route to the sitemap when new pages are created.

## Built-in performance behavior

- Brotli or gzip compression for HTML, CSS-compatible text, JSON, JS, and XML.
- ETags and `304 Not Modified` responses for generated responses.
- Production caching for files under `/public/`.
- Mobile viewport metadata and responsive Cool.css components.
- Reduced-motion accessibility support.
- Deferred development live-reload JavaScript.

Use hashed asset filenames before setting year-long immutable caching. The
current one-day cache avoids stale deployments while still improving repeat
visits.

## Measure before launch

Run Chrome Lighthouse against the production HTTPS URL in mobile mode. Also
check Google Search Console after ownership verification. Aim for good Core Web
Vitals, but diagnose the individual LCP, INP, and CLS findings instead of
optimizing only for a numeric score.
