import { HomeController } from "../app/Controllers/HomeController.js";

/** Operational routes that are not part of the user navigation. */
export function registerSystemRoutes(app) {
  app.get("/robots.txt", ({ text }) => text(
    `User-agent: *\nAllow: /\nSitemap: ${process.env.SITE_URL ?? "http://localhost:3000"}/sitemap.xml`,
    200
  ));

  app.get("/sitemap.xml", ({ text }) => text(
    `<?xml version="1.0" encoding="UTF-8"?>\n`
      + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`
      + `<url><loc>${process.env.SITE_URL ?? "http://localhost:3000"}/</loc></url>`
      + `</urlset>`,
    200,
    "application/xml; charset=utf-8"
  ));

  app.get("/health", HomeController.handle("health"));
}
