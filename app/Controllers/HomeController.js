import { Controller } from "../../framework/index.js";

export class HomeController extends Controller {
  async index() {
    return this.render("home", {
      name: process.env.SITE_NAME ?? "developer",
      siteName: process.env.SITE_NAME ?? "Noderyx Framework",
      siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
      aiEnabled: process.env.AI_ENABLED === "true",
      description: process.env.SITE_DESCRIPTION
        ?? "Build fast, responsive web applications with Noderyx Framework."
    });
  }

  async health() {
    return this.json({
      status: "ok",
      framework: "Noderyx Framework",
      runtime: "Node.js",
      uptime: Math.round(process.uptime())
    });
  }
}
